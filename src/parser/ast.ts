import type Decimal from "decimal.js"

export type Position = { line: number; col: number }

// -- Unit expressions --

export type UnitExpr = UnitRef | UnitBinary | UnitPow

export type UnitRef = {
  type: "unitRef"
  name: string
  pos: Position
}

export type UnitBinary = {
  type: "unitBinary"
  op: "mul" | "div"
  left: UnitExpr
  right: UnitExpr
  pos: Position
}

export type UnitPow = {
  type: "unitPow"
  base: UnitExpr
  exp: number // integer
  pos: Position
}

// -- Expressions --

export type Expr =
  | NumberLit
  | Identifier
  | UnaryExpr
  | BinaryExpr
  | IfExpr
  | ConversionExpr
  | PropertyAccess

export type NumberLit = {
  type: "number"
  value: Decimal
  /** Optional unit suffix: present iff the source had `NUMBER unit_expr`. */
  unit?: UnitExpr
  pos: Position
}

export type Identifier = {
  type: "ident"
  name: string
  pos: Position
}

export type UnaryOp = "neg" | "pos" | "not"

export type UnaryExpr = {
  type: "unary"
  op: UnaryOp
  operand: Expr
  pos: Position
}

export type BinaryOp =
  | "or"
  | "and"
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "pow"

export type BinaryExpr = {
  type: "binary"
  op: BinaryOp
  left: Expr
  right: Expr
  pos: Position
}

export type IfExpr = {
  type: "if"
  cond: Expr
  then: Expr
  else: Expr
  pos: Position
}

export type ConversionExpr = {
  type: "conversion"
  expr: Expr
  unit: UnitExpr
  pos: Position
}

/**
 * `target.property` — used to access aggregate values on a series, e.g.
 * `prices.sum`. In MVP `target` is expected to be an Identifier referring
 * to a series; other shapes produce an eval-time error.
 */
export type PropertyAccess = {
  type: "property"
  target: Expr
  property: string
  pos: Position
}

// -- Statements --

/**
 * A unit declaration. Two source-level forms produce the same AST shape:
 *
 *   UNIT <Dimension> <name>                    → { dimension }
 *   UNIT <Dimension> <name> (expr)             → { dimension, expr }   (dim-checked)
 *   UNIT (expr) <name>                         → { expr }              (dim inferred from body)
 *
 * `dimension` is undefined only in the inferred-dim form, in which case
 * `expr` is guaranteed present. The parser enforces this invariant.
 */
export type UnitDef = {
  dimension?: string
  expr?: Expr
}

export type UnitDecl = {
  type: "unitDecl"
  name: string
  def: UnitDef
  pos: Position
}

export type VariableDecl = {
  type: "variableDecl"
  name: string
  value: Decimal
  /** Optional unit; absent means dimensionless. */
  unit?: UnitExpr
  pos: Position
}

export type ExprAssignment = {
  type: "exprAssignment"
  expr: Expr
  name: string
  pos: Position
}

export type ExprStatement = {
  type: "exprStatement"
  expr: Expr
  pos: Position
}

/**
 * `SERIES <name>` followed by member-expression lines on subsequent lines.
 * Terminated by a blank line, EOF, or another top-level keyword. Members
 * must share a dimension at evaluation time.
 */
export type SeriesDecl = {
  type: "seriesDecl"
  name: string
  members: Expr[]
  pos: Position
}

export type Statement =
  | UnitDecl
  | VariableDecl
  | ExprAssignment
  | ExprStatement
  | SeriesDecl

export type Program = {
  statements: Statement[]
}

// -- S-expression pretty-printers (debug / tests / --ast) --

export function showExpr(e: Expr): string {
  switch (e.type) {
    case "number":
      return e.unit
        ? `(qty ${e.value.toString()} ${showUnitExpr(e.unit)})`
        : e.value.toString()
    case "ident":
      return e.name
    case "unary":
      return `(${e.op} ${showExpr(e.operand)})`
    case "binary":
      return `(${e.op} ${showExpr(e.left)} ${showExpr(e.right)})`
    case "if":
      return `(if ${showExpr(e.cond)} ${showExpr(e.then)} ${showExpr(e.else)})`
    case "conversion":
      return `(as ${showExpr(e.expr)} ${showUnitExpr(e.unit)})`
    case "property":
      return `(prop ${showExpr(e.target)} ${e.property})`
  }
}

export function showUnitExpr(u: UnitExpr): string {
  switch (u.type) {
    case "unitRef":
      return u.name
    case "unitBinary":
      return `(${u.op} ${showUnitExpr(u.left)} ${showUnitExpr(u.right)})`
    case "unitPow":
      return `(pow ${showUnitExpr(u.base)} ${u.exp})`
  }
}

export function showStatement(s: Statement): string {
  switch (s.type) {
    case "unitDecl":
      return `(unit ${s.name} ${showUnitDef(s.def)})`
    case "variableDecl": {
      const u = s.unit ? ` ${showUnitExpr(s.unit)}` : ""
      return `(var ${s.name} ${s.value.toString()}${u})`
    }
    case "exprAssignment":
      return `(= ${s.name} ${showExpr(s.expr)})`
    case "exprStatement":
      return showExpr(s.expr)
    case "seriesDecl": {
      const ms = s.members.map(showExpr).join(" ")
      return `(series ${s.name}${ms ? " " + ms : ""})`
    }
  }
}

function showUnitDef(d: UnitDef): string {
  if (d.dimension && d.expr) return `${d.dimension} ${showExpr(d.expr)}`
  if (d.dimension) return d.dimension
  if (d.expr) return `(${showExpr(d.expr)})`
  return "<empty>"
}

export function showProgram(p: Program): string {
  return p.statements.map(showStatement).join("\n")
}
