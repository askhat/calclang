import type { Position } from "../parser/ast.ts"
import type { Quantity } from "../units/quantity.ts"
import { EvalError } from "./errors.ts"

/**
 * The result of evaluating an expression. Quantity is an object, boolean is
 * a primitive, so the two cases are unambiguously distinguished by typeof.
 */
export type Value = Quantity | boolean

export function isBoolean(v: Value): v is boolean {
  return typeof v === "boolean"
}

export function isQuantity(v: Value): v is Quantity {
  return typeof v === "object"
}

export function asQuantity(v: Value, pos: Position): Quantity {
  if (isBoolean(v)) {
    throw new EvalError(
      `expected a quantity here, got a boolean`,
      pos,
      `arithmetic and conversion operators don't apply to booleans`,
    )
  }
  return v
}

export function asBoolean(v: Value, pos: Position): boolean {
  if (!isBoolean(v)) {
    throw new EvalError(
      `expected a boolean here, got a quantity`,
      pos,
      `'and', 'or', 'not', and the condition of if/then/else need a boolean`,
    )
  }
  return v
}
