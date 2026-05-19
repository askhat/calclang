import Decimal from "decimal.js"
import { type Diagnostic } from "../errors/diagnostic.ts"
import type {
  BinaryOp,
  Expr,
  ExprAssignment,
  FunctionDecl,
  PlotDecl,
  Position,
  Program,
  RangeDecl,
  SeriesDecl,
  SeriesMember,
  Statement,
  UnitDecl,
  UnitExpr,
  VariableDecl,
} from "../parser/ast.ts"
import * as Dim from "../units/dimension.ts"
import type { DimensionVector } from "../units/dimension.ts"
import * as Q from "../units/quantity.ts"
import type { Quantity } from "../units/quantity.ts"
import { UnitRegistry } from "../units/registry.ts"
import type { Unit } from "../units/unit.ts"
import { suggest } from "../util/levenshtein.ts"
import {
  AGGREGATE_METHODS,
  computeAggregate,
  materializeRange,
  type RangeValue,
  type SeriesValue,
} from "./collection.ts"
import { EvalError } from "./errors.ts"
import {
  additiveWithPercent,
  multiplicativeWithPercent,
  negatePercent,
  percentFromDisplay,
} from "./percent.ts"
import {
  compilePlot,
  dataPlotFromMembers,
  mergePlots,
  SERIES_PALETTE,
  type PlotValue,
} from "./plot.ts"
import {
  asBoolean,
  asQuantity,
  isPercent,
  isRange,
  type Value,
} from "./value.ts"

// Re-exports for backward compatibility with frontend/calc-engine.ts and any
// out-of-tree consumers that imported these directly from evaluator.
export { computeAggregate } from "./collection.ts"
export type { RangeValue, SeriesValue } from "./collection.ts"

// 40 significant digits — generous headroom over decimal.js's default 20.
// A future `# precision N` directive can raise this further.
Decimal.set({ precision: 40 })

type VarBinding =
  | { state: "pending"; decl: VariableDecl | ExprAssignment }
  | { state: "resolving" }
  | { state: "ready"; value: Value }

type SeriesBinding =
  | { state: "pending"; decl: SeriesDecl }
  | { state: "resolving" }
  | { state: "ready"; value: SeriesValue }

type RangeBinding =
  | { state: "pending"; decl: RangeDecl }
  | { state: "resolving" }
  | { state: "ready"; value: RangeValue }

type PlotBinding =
  | { state: "pending"; decl: PlotDecl }
  | { state: "resolving" }
  | { state: "ready"; value: PlotValue }

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
  // `of` is multiplication semantically; reading aid for percentages.
  of: Q.mul,
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
  private readonly seriesEnv = new Map<string, SeriesBinding>()
  private readonly rangeEnv = new Map<string, RangeBinding>()
  private readonly plotEnv = new Map<string, PlotBinding>()
  private readonly functionEnv = new Map<string, FunctionDecl>()
  /** Stack of local scopes pushed by active function calls. */
  private readonly localScopes: Array<Map<string, Value>> = []
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
    const out: RunResult[] = []
    for (const stmt of program.statements) {
      out.push(this.runStatement(stmt))
      if (stmt.type === "seriesDecl") {
        const binding = this.seriesEnv.get(stmt.name)
        if (binding?.state === "ready") {
          // Publish each member's value as a synthetic expr-statement result
          // so the editor can render `= value` next to each member line.
          for (let i = 0; i < stmt.members.length; i++) {
            const member = stmt.members[i]!
            out.push({
              stmt: {
                type: "exprStatement",
                expr: member.expr,
                pos: member.expr.pos,
              },
              value: binding.value.members[i]!,
              error: null,
            })
          }
        }
      }
    }
    return out
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
        case "seriesDecl": {
          if (this.seriesEnv.has(stmt.name)) {
            this.report(
              `series '${stmt.name}' is already declared`,
              stmt.pos,
              "each series may be declared only once",
            )
            continue
          }
          if (
            this.varEnv.has(stmt.name) ||
            this.pendingUnits.has(stmt.name) ||
            this.rangeEnv.has(stmt.name) ||
            this.plotEnv.has(stmt.name)
          ) {
            this.report(
              `name '${stmt.name}' is already declared`,
              stmt.pos,
              "the name must be unique across units, variables, series, ranges, functions, and plots",
            )
            continue
          }
          // Validate member names eagerly so the declaration is rejected
          // before any reference attempts to resolve it.
          const seen = new Set<string>()
          let memberError = false
          for (const m of stmt.members) {
            if (!m.name) continue
            const where = m.namePos ?? m.expr.pos
            if (AGGREGATE_METHODS.has(m.name)) {
              this.report(
                `member name '${m.name}' clashes with the built-in series method '.${m.name}'`,
                where,
                "rename the member; '.sum', '.avg', '.count', '.min', '.max' are reserved",
              )
              memberError = true
            }
            if (seen.has(m.name)) {
              this.report(
                `series '${stmt.name}' has duplicate member name '${m.name}'`,
                where,
                "each member's name must be unique within its series",
              )
              memberError = true
            }
            seen.add(m.name)
          }
          if (memberError) continue
          this.seriesEnv.set(stmt.name, { state: "pending", decl: stmt })
          break
        }
        case "functionDecl":
          if (this.functionEnv.has(stmt.name)) {
            this.report(
              `function '${stmt.name}' is already declared`,
              stmt.pos,
              "each function may be declared only once",
            )
            continue
          }
          if (
            this.varEnv.has(stmt.name) ||
            this.pendingUnits.has(stmt.name) ||
            this.seriesEnv.has(stmt.name) ||
            this.rangeEnv.has(stmt.name) ||
            this.plotEnv.has(stmt.name)
          ) {
            this.report(
              `name '${stmt.name}' is already declared`,
              stmt.pos,
              "the name must be unique across units, variables, series, ranges, functions, and plots",
            )
            continue
          }
          this.functionEnv.set(stmt.name, stmt)
          break
        case "rangeDecl":
          if (this.rangeEnv.has(stmt.name)) {
            this.report(
              `range '${stmt.name}' is already declared`,
              stmt.pos,
              "each range may be declared only once",
            )
            continue
          }
          if (
            this.varEnv.has(stmt.name) ||
            this.pendingUnits.has(stmt.name) ||
            this.seriesEnv.has(stmt.name) ||
            this.functionEnv.has(stmt.name) ||
            this.plotEnv.has(stmt.name)
          ) {
            this.report(
              `name '${stmt.name}' is already declared`,
              stmt.pos,
              "the name must be unique across units, variables, series, ranges, functions, and plots",
            )
            continue
          }
          this.rangeEnv.set(stmt.name, { state: "pending", decl: stmt })
          break
        case "plotDecl":
          if (this.plotEnv.has(stmt.name)) {
            this.report(
              `plot '${stmt.name}' is already declared`,
              stmt.pos,
              "each plot may be declared only once",
            )
            continue
          }
          if (
            this.varEnv.has(stmt.name) ||
            this.pendingUnits.has(stmt.name) ||
            this.seriesEnv.has(stmt.name) ||
            this.rangeEnv.has(stmt.name) ||
            this.functionEnv.has(stmt.name)
          ) {
            this.report(
              `name '${stmt.name}' is already declared`,
              stmt.pos,
              "the name must be unique across units, variables, series, ranges, functions, and plots",
            )
            continue
          }
          this.plotEnv.set(stmt.name, { state: "pending", decl: stmt })
          break
      }
    }
  }

  /** Declared functions, for sidebar / debug introspection. */
  *functions(): IterableIterator<FunctionDecl> {
    yield* this.functionEnv.values()
  }

  /** Ready series, for sidebar / debug introspection. */
  *readySeries(): IterableIterator<[string, SeriesValue]> {
    for (const [name, b] of this.seriesEnv) {
      if (b.state === "ready") yield [name, b.value]
    }
  }

  /** Ready ranges, for sidebar / debug introspection. */
  *readyRanges(): IterableIterator<[string, RangeValue]> {
    for (const [name, b] of this.rangeEnv) {
      if (b.state === "ready") yield [name, b.value]
    }
  }

  /** Ready plots, for sidebar / frontend rendering. */
  *readyPlots(): IterableIterator<[string, PlotValue]> {
    for (const [name, b] of this.plotEnv) {
      if (b.state === "ready") yield [name, b.value]
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
        case "seriesDecl": {
          if (!this.seriesEnv.has(stmt.name)) {
            return { stmt, value: null, error: null }
          }
          this.resolveSeries(stmt.name, stmt.pos)
          return { stmt, value: null, error: null }
        }
        case "functionDecl":
          // Function definitions are registered in pass 1; nothing to
          // compute at "run" time — they're templates evaluated per call.
          return { stmt, value: null, error: null }
        case "rangeDecl": {
          if (!this.rangeEnv.has(stmt.name)) {
            return { stmt, value: null, error: null }
          }
          this.resolveRange(stmt.name, stmt.pos)
          return { stmt, value: null, error: null }
        }
        case "plotDecl": {
          if (!this.plotEnv.has(stmt.name)) {
            return { stmt, value: null, error: null }
          }
          const value = this.resolvePlot(stmt.name, stmt.pos)
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
      throw new EvalError(
        `undefined unit '${name}'`,
        refPos,
        this.didYouMean(name, this.allUnitNames()),
      )
    }

    this.resolvingStack.push(name)
    try {
      let registered: Unit
      if (decl.def.expr) {
        // Composite form. Evaluate the body and (if a dimension is also
        // declared) verify the body's dimension matches.
        const body = this.evalExpr(decl.def.expr)
        const q = asQuantity(body, decl.def.expr.pos)
        if (!q.unit) {
          throw new EvalError(
            `composite definition of '${name}' must yield a quantity, not a dimensionless number`,
            decl.def.expr.pos,
            `reference at least one already-declared unit in the body`,
          )
        }
        if (decl.def.dimension) {
          const expected: DimensionVector = { [decl.def.dimension]: 1 }
          if (!Dim.equals(q.unit.dimension, expected)) {
            throw new EvalError(
              `unit '${name}' was declared as ${decl.def.dimension} but its body evaluates to ${Dim.format(q.unit.dimension)}`,
              decl.def.expr.pos,
              `the body's resulting dimension must match the declared dimension`,
            )
          }
        }
        registered = this.registry.registerDerived(name, q)
      } else if (decl.def.dimension) {
        // UNIT <Dim> <name> — factor 1 in <Dim>. First declaration in a
        // dimension creates it; subsequent ones are placeholders for
        // future dynamic rates.
        registered = this.registry.registerSimple(name, decl.def.dimension)
      } else {
        // Should not happen — parser enforces presence of dim or expr.
        throw new EvalError(
          `unit '${name}' has neither a dimension nor a body`,
          decl.pos,
        )
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
      throw new EvalError(
        `undefined variable '${name}'`,
        refPos,
        this.didYouMean(name, this.varEnv.keys()),
      )
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
      case "string":
        throw new EvalError(
          `string literals have no value outside PLOT TEXT`,
          expr.pos,
          'use a string only as the last arg of `TEXT x y "..."`',
        )
      case "ident": {
        // Local scopes (function parameters) win over globals so a function
        // body's `m` refers to the param, not the `m` unit.
        for (let i = this.localScopes.length - 1; i >= 0; i--) {
          const scope = this.localScopes[i]!
          if (scope.has(expr.name)) return scope.get(expr.name)!
        }
        if (this.registry.has(expr.name) || this.pendingUnits.has(expr.name)) {
          const unit = this.resolveUnit(expr.name, expr.pos)
          return { value: new Decimal(1), unit }
        }
        if (this.varEnv.has(expr.name)) {
          return this.resolveVar(expr.name, expr.pos)
        }
        if (this.rangeEnv.has(expr.name)) {
          // Ranges ARE first-class values — bare reference returns the
          // RangeValue so `.sum` etc. can dispatch off it.
          return this.resolveRange(expr.name, expr.pos)
        }
        if (this.plotEnv.has(expr.name)) {
          return this.resolvePlot(expr.name, expr.pos)
        }
        if (this.seriesEnv.has(expr.name)) {
          throw new EvalError(
            `'${expr.name}' is a series — use it via a method like '${expr.name}.sum' or '${expr.name}.avg'`,
            expr.pos,
            "available methods: sum, avg, count, min, max",
          )
        }
        if (this.functionEnv.has(expr.name)) {
          throw new EvalError(
            `'${expr.name}' is a function — call it with arguments, e.g. '${expr.name}(…)'`,
            expr.pos,
          )
        }
        const allNames = new Set<string>(this.allUnitNames())
        for (const n of this.varEnv.keys()) allNames.add(n)
        for (const n of this.seriesEnv.keys()) allNames.add(n)
        for (const n of this.rangeEnv.keys()) allNames.add(n)
        for (const n of this.functionEnv.keys()) allNames.add(n)
        for (const n of this.plotEnv.keys()) allNames.add(n)
        throw new EvalError(
          `undefined name '${expr.name}'`,
          expr.pos,
          this.didYouMean(expr.name, allNames),
        )
      }
      case "unary": {
        if (expr.op === "not") {
          return !asBoolean(this.evalExpr(expr.operand), expr.operand.pos)
        }
        const raw = this.evalExpr(expr.operand)
        // Preserve percent-ness through unary +/-: -20% should stay a percent.
        if (isPercent(raw)) {
          return expr.op === "neg" ? negatePercent(raw) : raw
        }
        const operand = asQuantity(raw, expr.operand.pos)
        return expr.op === "neg" ? Q.neg(operand) : operand
      }
      case "percent": {
        // The `expr%` postfix: inner is the displayed percentage (20 for 20%).
        // Internally we store the fraction (0,20). Inner must be a plain
        // dimensionless number — a unit-bearing quantity or a chained percent
        // is nonsense and rejected.
        const innerVal = this.evalExpr(expr.expr)
        if (isPercent(innerVal)) {
          throw new EvalError(
            `'%' applied to a value that is already a percent`,
            expr.pos,
            "drop one '%' — `5%%` is not meaningful",
          )
        }
        const inner = asQuantity(innerVal, expr.expr.pos)
        if (inner.unit) {
          throw new EvalError(
            `'%' requires a dimensionless number, got ${inner.unit.name}`,
            expr.pos,
            "percent is just a fraction; '5 rub%' has no sensible meaning",
          )
        }
        return percentFromDisplay(inner.value)
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
        // Percent-aware fast paths for additive and multiplicative ops.
        const leftRaw = this.evalExpr(expr.left)
        const rightRaw = this.evalExpr(expr.right)
        if (expr.op === "add" || expr.op === "sub") {
          const pct = additiveWithPercent(leftRaw, rightRaw, expr.op)
          if (pct !== null) return pct
        }
        if (expr.op === "mul" || expr.op === "div" || expr.op === "of") {
          const pct = multiplicativeWithPercent(leftRaw, rightRaw, expr.op)
          if (pct !== null) return pct
        }
        const left = asQuantity(leftRaw, expr.left.pos)
        const right = asQuantity(rightRaw, expr.right.pos)
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
      case "property": {
        // Dispatch on the target. Series and ranges are the property-bearing
        // values; quantities and booleans don't have properties.
        if (expr.target.type === "ident") {
          const name = expr.target.name
          if (this.seriesEnv.has(name)) {
            const series = this.resolveSeries(name, expr.target.pos)
            // Named member wins over aggregate methods. Name collisions are
            // rejected in pass 1, so this is a clean dispatch.
            const named = series.byName.get(expr.property)
            if (named) return named
            if (!AGGREGATE_METHODS.has(expr.property)) {
              const methods = [...AGGREGATE_METHODS].sort().join(", ")
              const memberNames = [...series.byName.keys()]
              const hint = memberNames.length
                ? `available methods: ${methods}; members of '${name}': ${memberNames.join(", ")}`
                : `available methods: ${methods}`
              throw new EvalError(
                `series '${name}' has no '.${expr.property}'`,
                expr.pos,
                hint,
              )
            }
            return computeAggregate(series, expr.property, expr.pos)
          }
          if (this.rangeEnv.has(name)) {
            const range = this.resolveRange(name, expr.target.pos)
            if (!AGGREGATE_METHODS.has(expr.property)) {
              const methods = [...AGGREGATE_METHODS].sort().join(", ")
              throw new EvalError(
                `range '${name}' has no '.${expr.property}'`,
                expr.pos,
                `available methods: ${methods}`,
              )
            }
            return computeAggregate(range, expr.property, expr.pos)
          }
          // Ident exists but is not a series/range — fall through to evaluate.
        }
        // Inline / parenthesized targets: evaluate and dispatch on the value.
        const targetVal = this.evalExpr(expr.target)
        if (isRange(targetVal)) {
          if (!AGGREGATE_METHODS.has(expr.property)) {
            throw new EvalError(
              `range has no '.${expr.property}'`,
              expr.pos,
              "available methods: sum, avg, count, min, max",
            )
          }
          return computeAggregate(targetVal, expr.property, expr.pos)
        }
        throw new EvalError(
          "property access is only supported on series and ranges",
          expr.pos,
        )
      }
      case "call": {
        const fn = this.functionEnv.get(expr.callee)
        if (!fn) {
          // Better hints than "undefined": surface units/vars/series too.
          if (this.varEnv.has(expr.callee)) {
            throw new EvalError(
              `'${expr.callee}' is a variable, not a function`,
              expr.pos,
            )
          }
          if (this.seriesEnv.has(expr.callee)) {
            throw new EvalError(
              `'${expr.callee}' is a series — use '${expr.callee}.sum' / '${expr.callee}.avg' (not call syntax)`,
              expr.pos,
            )
          }
          if (this.registry.has(expr.callee) || this.pendingUnits.has(expr.callee)) {
            throw new EvalError(
              `'${expr.callee}' is a unit, not a function`,
              expr.pos,
            )
          }
          throw new EvalError(
            `undefined function '${expr.callee}'`,
            expr.pos,
            this.didYouMean(expr.callee, this.functionEnv.keys()),
          )
        }
        if (expr.args.length !== fn.params.length) {
          throw new EvalError(
            `function '${fn.name}' expects ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"}, got ${expr.args.length}`,
            expr.pos,
          )
        }
        // Evaluate args in caller's scope, then push a local scope binding
        // params to those values.
        const argValues = expr.args.map((a) => this.evalExpr(a))
        const scope = new Map<string, Value>()
        for (let i = 0; i < fn.params.length; i++) {
          scope.set(fn.params[i]!, argValues[i]!)
        }
        this.localScopes.push(scope)
        try {
          return this.evalExpr(fn.body)
        } finally {
          this.localScopes.pop()
        }
      }
      case "range": {
        const startQ = asQuantity(this.evalExpr(expr.start), expr.start.pos)
        const endQ = asQuantity(this.evalExpr(expr.end), expr.end.pos)
        const stepQ = expr.step
          ? asQuantity(this.evalExpr(expr.step), expr.step.pos)
          : null
        return materializeRange(startQ, endQ, stepQ, expr.inclusive, expr.pos)
      }
    }
  }

  private resolveSeries(name: string, refPos: Position): SeriesValue {
    const binding = this.seriesEnv.get(name)
    if (!binding) {
      throw new EvalError(
        `undefined series '${name}'`,
        refPos,
        this.didYouMean(name, this.seriesEnv.keys()),
      )
    }
    if (binding.state === "ready") return binding.value
    if (binding.state === "resolving") {
      throw new EvalError(
        `cyclic dependency: ${this.cycleTrail(name)}`,
        refPos,
      )
    }

    const original = binding
    this.seriesEnv.set(name, { state: "resolving" })
    this.resolvingStack.push(name)
    try {
      // Phase 1: evaluate every member to a raw quantity.
      const evaluated: { q: Quantity; member: SeriesMember }[] = []
      for (const member of original.decl.members) {
        const v = this.evalExpr(member.expr)
        const q = asQuantity(v, member.expr.pos)
        evaluated.push({ q, member })
      }

      // Phase 2: series unit = unit of the last member that brought one.
      let unit: Unit | null = null
      for (let i = evaluated.length - 1; i >= 0; i--) {
        const u = evaluated[i]!.q.unit
        if (u) {
          unit = u
          break
        }
      }

      // Phase 3: promote dimensionless members into the series unit, check
      // dimension consistency, and index named members.
      const members: Quantity[] = []
      const byName = new Map<string, Quantity>()
      const expectedDim = unit?.dimension ?? {}
      for (const { q, member } of evaluated) {
        let promoted = q
        if (!q.unit && unit) {
          promoted = { value: q.value, unit }
        }
        const promotedDim = promoted.unit?.dimension ?? {}
        if (!Dim.equals(expectedDim, promotedDim)) {
          throw new EvalError(
            `series '${name}' mixes dimensions: ${Dim.format(expectedDim)} and ${Dim.format(promotedDim)}`,
            member.expr.pos,
            "all members of a series must share a dimension",
          )
        }
        members.push(promoted)
        if (member.name) byName.set(member.name, promoted)
      }

      const value: SeriesValue = {
        kind: "series",
        members,
        dimension: expectedDim,
        unit,
        byName,
      }
      this.seriesEnv.set(name, { state: "ready", value })
      return value
    } catch (err) {
      this.seriesEnv.set(name, original)
      throw err
    } finally {
      this.resolvingStack.pop()
    }
  }

  private resolvePlot(name: string, refPos: Position): PlotValue {
    const binding = this.plotEnv.get(name)
    if (!binding) {
      throw new EvalError(
        `undefined plot '${name}'`,
        refPos,
        this.didYouMean(name, this.plotEnv.keys()),
      )
    }
    if (binding.state === "ready") return binding.value
    if (binding.state === "resolving") {
      throw new EvalError(
        `cyclic dependency: ${this.cycleTrail(name)}`,
        refPos,
      )
    }

    const original = binding
    this.plotEnv.set(name, { state: "resolving" })
    this.resolvingStack.push(name)
    try {
      let value: PlotValue
      if (original.decl.dataRefs.length > 0) {
        const parts: PlotValue[] = []
        for (let i = 0; i < original.decl.dataRefs.length; i++) {
          const ref = original.decl.dataRefs[i]!
          // Single-ref: no palette color (renderer uses currentColor).
          // Multi-ref: cycle through SERIES_PALETTE so each layer is distinct.
          const color =
            original.decl.dataRefs.length === 1
              ? undefined
              : SERIES_PALETTE[i % SERIES_PALETTE.length]
          parts.push(this.expandPlotDataRef(ref.name, ref.pos, color))
        }
        value = mergePlots(parts)
      } else {
        value = compilePlot(original.decl.instructions, (arg) => {
          // Each PLOT argument must reduce to a plain dimensionless number.
          const v = asQuantity(this.evalExpr(arg), arg.pos)
          if (v.unit) {
            throw new EvalError(
              `plot arguments must be dimensionless, got ${v.unit.name}`,
              arg.pos,
              "PLOT coordinates and lengths are plain numbers",
            )
          }
          return v.value
        })
      }
      this.plotEnv.set(name, { state: "ready", value })
      return value
    } catch (err) {
      this.plotEnv.set(name, original)
      throw err
    } finally {
      this.resolvingStack.pop()
    }
  }

  private expandPlotDataRef(
    refName: string,
    refPos: Position,
    color?: string,
  ): PlotValue {
    if (this.seriesEnv.has(refName)) {
      const s = this.resolveSeries(refName, refPos)
      return dataPlotFromMembers(s.members, color)
    }
    if (this.rangeEnv.has(refName)) {
      const r = this.resolveRange(refName, refPos)
      return dataPlotFromMembers(r.members, color)
    }
    // Concrete diagnostics instead of "undefined name": if the name resolves
    // to a different kind, tell the user PLOT wants a series or range here.
    if (this.varEnv.has(refName)) {
      throw new EvalError(
        `'${refName}' is a variable — PLOT <name> <ref> expects a series or range`,
        refPos,
        "use the block form (PLOT name\\n  LINE …) for ad-hoc shapes",
      )
    }
    if (this.plotEnv.has(refName)) {
      throw new EvalError(
        `'${refName}' is a plot, not a series or range`,
        refPos,
      )
    }
    if (this.registry.has(refName) || this.pendingUnits.has(refName)) {
      throw new EvalError(
        `'${refName}' is a unit — PLOT <name> <ref> expects a series or range`,
        refPos,
      )
    }
    const candidates = new Set<string>()
    for (const n of this.seriesEnv.keys()) candidates.add(n)
    for (const n of this.rangeEnv.keys()) candidates.add(n)
    throw new EvalError(
      `undefined series or range '${refName}'`,
      refPos,
      this.didYouMean(refName, candidates),
    )
  }

  private resolveRange(name: string, refPos: Position): RangeValue {
    const binding = this.rangeEnv.get(name)
    if (!binding) {
      throw new EvalError(
        `undefined range '${name}'`,
        refPos,
        this.didYouMean(name, this.rangeEnv.keys()),
      )
    }
    if (binding.state === "ready") return binding.value
    if (binding.state === "resolving") {
      throw new EvalError(
        `cyclic dependency: ${this.cycleTrail(name)}`,
        refPos,
      )
    }

    const original = binding
    this.rangeEnv.set(name, { state: "resolving" })
    this.resolvingStack.push(name)
    try {
      const r = original.decl.range
      const startQ = asQuantity(this.evalExpr(r.start), r.start.pos)
      const endQ = asQuantity(this.evalExpr(r.end), r.end.pos)
      const stepQ = r.step
        ? asQuantity(this.evalExpr(r.step), r.step.pos)
        : null
      const value = materializeRange(startQ, endQ, stepQ, r.inclusive, r.pos)
      this.rangeEnv.set(name, { state: "ready", value })
      return value
    } catch (err) {
      this.rangeEnv.set(name, original)
      throw err
    } finally {
      this.resolvingStack.pop()
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

  private *allUnitNames(): IterableIterator<string> {
    for (const u of this.registry.all()) yield u.name
    for (const name of this.pendingUnits.keys()) yield name
  }

  private didYouMean(
    query: string,
    candidates: Iterable<string>,
  ): string | undefined {
    const match = suggest(query, candidates)
    return match ? `did you mean '${match}'?` : undefined
  }
}

export function evaluateProgram(program: Program): EvalResult {
  const ev = new Evaluator()
  const results = ev.feed(program)
  return { results, diagnostics: ev.diagnostics, registry: ev.registry }
}
