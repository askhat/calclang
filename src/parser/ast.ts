import type Decimal from "decimal.js"

export type Position = { line: number; col: number }

export type Expr =
  | NumberLit
  | Identifier
  | UnaryExpr
  | BinaryExpr
  | IfExpr

export type NumberLit = {
  type: "number"
  value: Decimal
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

/** S-expression pretty-print, used by tests and the --ast CLI flag. */
export function showExpr(e: Expr): string {
  switch (e.type) {
    case "number":
      return e.value.toString()
    case "ident":
      return e.name
    case "unary":
      return `(${e.op} ${showExpr(e.operand)})`
    case "binary":
      return `(${e.op} ${showExpr(e.left)} ${showExpr(e.right)})`
    case "if":
      return `(if ${showExpr(e.cond)} ${showExpr(e.then)} ${showExpr(e.else)})`
  }
}
