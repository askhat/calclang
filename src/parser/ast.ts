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

// -- Statements --

export type UnitDef =
  | { kind: "base"; dimension: string }
  | { kind: "composite"; expr: Expr }
  | { kind: "alias"; dimension: string }

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

export type Statement = UnitDecl | VariableDecl | ExprAssignment | ExprStatement

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
      return `(declare ${s.name} ${showUnitDef(s.def)})`
    case "variableDecl": {
      const u = s.unit ? ` ${showUnitExpr(s.unit)}` : ""
      return `(var ${s.name} ${s.value.toString()}${u})`
    }
    case "exprAssignment":
      return `(= ${s.name} ${showExpr(s.expr)})`
    case "exprStatement":
      return showExpr(s.expr)
  }
}

function showUnitDef(d: UnitDef): string {
  switch (d.kind) {
    case "base":
      return `(base ${d.dimension})`
    case "composite":
      return `(composite ${showExpr(d.expr)})`
    case "alias":
      return `(alias ${d.dimension})`
  }
}

export function showProgram(p: Program): string {
  return p.statements.map(showStatement).join("\n")
}
