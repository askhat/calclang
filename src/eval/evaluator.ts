import Decimal from "decimal.js"
import { type Diagnostic } from "../errors/diagnostic.ts"
import type {
  BinaryOp,
  Expr,
  ExprAssignment,
  Position,
  Program,
  Statement,
  UnitDecl,
  UnitExpr,
  VariableDecl,
} from "../parser/ast.ts"
import * as Q from "../units/quantity.ts"
import type { Quantity } from "../units/quantity.ts"
import { UnitRegistry } from "../units/registry.ts"
import type { Unit } from "../units/unit.ts"
import { EvalError } from "./errors.ts"
import { asBoolean, asQuantity, type Value } from "./value.ts"

// 40 significant digits — generous headroom over decimal.js's default 20.
// A future `# precision N` directive can raise this further.
Decimal.set({ precision: 40 })

type VarBinding =
  | { state: "pending"; decl: VariableDecl | ExprAssignment }
  | { state: "resolving" }
  | { state: "ready"; value: Value }

export type RunResult = {
  stmt: Statement
  value: Value | null
  error: Diagnostic | null
}

export type EvalResult = {
  results: RunResult[]
  diagnostics: Diagnostic[]
  registry: UnitRegistry
}

type BinaryHandler = (l: Quantity, r: Quantity) => Value

const BINARY: Partial<Record<BinaryOp, BinaryHandler>> = {
  add: Q.add,
  sub: Q.sub,
  mul: Q.mul,
  div: Q.div,
  pow: Q.pow,
  eq: Q.eq,
  neq: Q.neq,
  lt: Q.lt,
  gt: Q.gt,
  lte: Q.lte,
  gte: Q.gte,
}

export class Evaluator {
  readonly registry = new UnitRegistry()
  readonly diagnostics: Diagnostic[] = []
  private readonly varEnv = new Map<string, VarBinding>()
  private readonly pendingUnits = new Map<string, UnitDecl>()
  private readonly resolvingStack: string[] = []

  /**
   * Feeds a (possibly partial) program: collects new declarations into
   * pending pools and runs each statement in source order. The internal
   * state accumulates across calls, so the REPL can call this once per
   * input line and the file driver calls it once with the whole program.
   */
  feed(program: Program): RunResult[] {
    this.collect(program)
    return program.statements.map((s) => this.runStatement(s))
  }

  /** Ready variable bindings, for REPL inspection. */
  *readyVariables(): IterableIterator<[string, Value]> {
    for (const [name, b] of this.varEnv) {
      if (b.state === "ready") yield [name, b.value]
    }
  }

  /** All known unit names (registered + pending) — for parser seeding in the REPL. */
  unitNames(): Set<string> {
    const names = new Set<string>()
    for (const u of this.registry.all()) names.add(u.name)
    for (const name of this.pendingUnits.keys()) names.add(name)
    return names
  }

  // -- Pass 1: collect declarations into pending pools; report conflicts --

  private collect(program: Program): void {
    for (const stmt of program.statements) {
      switch (stmt.type) {
        case "unitDecl":
          if (this.pendingUnits.has(stmt.name) || this.registry.has(stmt.name)) {
            this.report(
              `unit '${stmt.name}' is already declared`,
              stmt.pos,
              "each unit may be declared only once",
            )
            continue
          }
          if (this.varEnv.has(stmt.name)) {
            this.report(
              `name '${stmt.name}' is already declared as a variable`,
              stmt.pos,
            )
            continue
          }
          this.pendingUnits.set(stmt.name, stmt)
          break
        case "variableDecl":
        case "exprAssignment":
          if (this.varEnv.has(stmt.name)) {
            this.report(
              `variable '${stmt.name}' is already declared`,
              stmt.pos,
              "each variable may be declared only once",
            )
            continue
          }
          if (this.pendingUnits.has(stmt.name)) {
            this.report(
              `name '${stmt.name}' is already declared as a unit`,
              stmt.pos,
            )
            continue
          }
          this.varEnv.set(stmt.name, { state: "pending", decl: stmt })
          break
        case "exprStatement":
          break
      }
    }
  }

  // -- Pass 2: drive each statement in source order --

  private runStatement(stmt: Statement): RunResult {
    try {
      switch (stmt.type) {
        case "unitDecl": {
          // Skip declarations that lost a name collision in pass 1.
          if (!this.pendingUnits.has(stmt.name) && !this.registry.has(stmt.name)) {
            return { stmt, value: null, error: null }
          }
          this.resolveUnit(stmt.name, stmt.pos)
          return { stmt, value: null, error: null }
        }
        case "variableDecl":
        case "exprAssignment": {
          if (!this.varEnv.has(stmt.name)) {
            // collision in pass 1
            return { stmt, value: null, error: null }
          }
          const value = this.resolveVar(stmt.name, stmt.pos)
          return { stmt, value, error: null }
        }
        case "exprStatement": {
          const value = this.evalExpr(stmt.expr)
          return { stmt, value, error: null }
        }
      }
    } catch (err) {
      const evalErr = EvalError.from(err, stmt.pos)
      const diag = evalErr.toDiagnostic()
      this.diagnostics.push(diag)
      return { stmt, value: null, error: diag }
    }
  }

  // -- Name resolution --

  private resolveUnit(name: string, refPos: Position): Unit {
    const existing = this.registry.get(name)
    if (existing) return existing

    if (this.resolvingStack.includes(name)) {
      throw new EvalError(
        `cyclic dependency: ${this.cycleTrail(name)}`,
        refPos,
      )
    }

    const decl = this.pendingUnits.get(name)
    if (!decl) {
      throw new EvalError(`undefined unit '${name}'`, refPos)
    }

    this.resolvingStack.push(name)
    try {
      let registered: Unit
      switch (decl.def.kind) {
        case "base":
          registered = this.registry.registerBase(name, decl.def.dimension)
          break
        case "alias":
          registered = this.registry.registerAlias(name, decl.def.dimension)
          break
        case "composite": {
          const body = this.evalExpr(decl.def.expr)
          const q = asQuantity(body, decl.def.expr.pos)
          if (!q.unit) {
            throw new EvalError(
              `composite definition of '${name}' must yield a quantity, not a dimensionless number`,
              decl.def.expr.pos,
              `reference at least one already-declared unit in the body`,
            )
          }
          registered = this.registry.registerDerived(name, q)
          break
        }
      }
      this.pendingUnits.delete(name)
      return registered
    } finally {
      this.resolvingStack.pop()
    }
  }

  private resolveVar(name: string, refPos: Position): Value {
    const binding = this.varEnv.get(name)
    if (!binding) {
      throw new EvalError(`undefined variable '${name}'`, refPos)
    }
    if (binding.state === "ready") return binding.value
    if (binding.state === "resolving") {
      throw new EvalError(
        `cyclic dependency: ${this.cycleTrail(name)}`,
        refPos,
      )
    }

    // state === "pending"
    const original = binding
    this.varEnv.set(name, { state: "resolving" })
    this.resolvingStack.push(name)
    try {
      const decl = original.decl
      let value: Value
      if (decl.type === "variableDecl") {
        if (decl.unit) {
          const unit = this.evalUnitExpr(decl.unit)
          value = { value: decl.value, unit }
        } else {
          value = { value: decl.value, unit: null }
        }
      } else {
        value = this.evalExpr(decl.expr)
      }
      this.varEnv.set(name, { state: "ready", value })
      return value
    } catch (err) {
      // Restore pending state so callers that re-reference this name get a
      // fresh evaluation attempt (and the same error) rather than getting
      // stuck in "resolving" forever.
      this.varEnv.set(name, original)
      throw err
    } finally {
      this.resolvingStack.pop()
    }
  }

  private cycleTrail(name: string): string {
    const start = this.resolvingStack.indexOf(name)
    const trail = start >= 0 ? this.resolvingStack.slice(start) : this.resolvingStack
    return [...trail, name].join(" → ")
  }

  // -- Expression evaluation --

  evalExpr(expr: Expr): Value {
    switch (expr.type) {
      case "number": {
        if (expr.unit) {
          const unit = this.evalUnitExpr(expr.unit)
          return { value: expr.value, unit }
        }
        return { value: expr.value, unit: null }
      }
      case "ident": {
        // Units take precedence over variables — name conflicts are caught
        // at collection time, so this is only a question of namespace order
        // when there's no conflict.
        if (this.registry.has(expr.name) || this.pendingUnits.has(expr.name)) {
          const unit = this.resolveUnit(expr.name, expr.pos)
          return { value: new Decimal(1), unit }
        }
        if (this.varEnv.has(expr.name)) {
          return this.resolveVar(expr.name, expr.pos)
        }
        throw new EvalError(`undefined name '${expr.name}'`, expr.pos)
      }
      case "unary": {
        if (expr.op === "not") {
          return !asBoolean(this.evalExpr(expr.operand), expr.operand.pos)
        }
        const operand = asQuantity(
          this.evalExpr(expr.operand),
          expr.operand.pos,
        )
        return expr.op === "neg" ? Q.neg(operand) : operand
      }
      case "binary": {
        if (expr.op === "and") {
          const l = asBoolean(this.evalExpr(expr.left), expr.left.pos)
          if (!l) return false
          return asBoolean(this.evalExpr(expr.right), expr.right.pos)
        }
        if (expr.op === "or") {
          const l = asBoolean(this.evalExpr(expr.left), expr.left.pos)
          if (l) return true
          return asBoolean(this.evalExpr(expr.right), expr.right.pos)
        }
        const handler = BINARY[expr.op]
        if (!handler) {
          throw new EvalError(`unhandled binary op '${expr.op}'`, expr.pos)
        }
        const left = asQuantity(this.evalExpr(expr.left), expr.left.pos)
        const right = asQuantity(this.evalExpr(expr.right), expr.right.pos)
        try {
          return handler(left, right)
        } catch (err) {
          throw EvalError.from(err, expr.pos)
        }
      }
      case "if": {
        const cond = asBoolean(this.evalExpr(expr.cond), expr.cond.pos)
        return this.evalExpr(cond ? expr.then : expr.else)
      }
      case "conversion": {
        const inner = asQuantity(this.evalExpr(expr.expr), expr.expr.pos)
        const target = this.evalUnitExpr(expr.unit)
        try {
          return Q.convert(inner, target)
        } catch (err) {
          throw EvalError.from(err, expr.pos)
        }
      }
    }
  }

  // -- Unit expression evaluation --

  evalUnitExpr(u: UnitExpr): Unit {
    switch (u.type) {
      case "unitRef":
        return this.resolveUnit(u.name, u.pos)
      case "unitBinary": {
        const left = this.evalUnitExpr(u.left)
        const right = this.evalUnitExpr(u.right)
        const a: Quantity = { value: new Decimal(1), unit: left }
        const b: Quantity = { value: new Decimal(1), unit: right }
        const composed = u.op === "mul" ? Q.mul(a, b) : Q.div(a, b)
        if (!composed.unit) {
          throw new EvalError(
            `unit expression cancels to dimensionless`,
            u.pos,
          )
        }
        return composed.unit
      }
      case "unitPow": {
        const base = this.evalUnitExpr(u.base)
        const baseQ: Quantity = { value: new Decimal(1), unit: base }
        const expQ: Quantity = { value: new Decimal(u.exp), unit: null }
        const result = Q.pow(baseQ, expQ)
        if (!result.unit) {
          throw new EvalError(
            `unit raised to 0 is dimensionless`,
            u.pos,
          )
        }
        return result.unit
      }
    }
  }

  // -- Diagnostic helper --

  private report(message: string, pos: Position, hint?: string): void {
    this.diagnostics.push(new EvalError(message, pos, hint).toDiagnostic())
  }
}

export function evaluateProgram(program: Program): EvalResult {
  const ev = new Evaluator()
  const results = ev.feed(program)
  return { results, diagnostics: ev.diagnostics, registry: ev.registry }
}
