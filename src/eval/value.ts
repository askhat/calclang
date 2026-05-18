import type { Position } from "../parser/ast.ts"
import type { Quantity } from "../units/quantity.ts"
import type { RangeValue } from "./collection.ts"
import { EvalError } from "./errors.ts"

/**
 * The result of evaluating an expression. Three shapes:
 *   - Quantity: object with `value` and `unit` (no `kind`).
 *   - RangeValue: object with `kind: "range"`.
 *   - boolean: primitive.
 * Series values are NOT first-class — a bare series identifier is an error
 * because there's no useful arithmetic to do with it.
 */
export type Value = Quantity | boolean | RangeValue

export function isBoolean(v: Value): v is boolean {
  return typeof v === "boolean"
}

export function isRange(v: Value): v is RangeValue {
  return typeof v === "object" && "kind" in v && v.kind === "range"
}

export function isQuantity(v: Value): v is Quantity {
  return typeof v === "object" && !("kind" in v)
}

export function asQuantity(v: Value, pos: Position): Quantity {
  if (isBoolean(v)) {
    throw new EvalError(
      `expected a quantity here, got a boolean`,
      pos,
      `arithmetic and conversion operators don't apply to booleans`,
    )
  }
  if (isRange(v)) {
    throw new EvalError(
      `expected a quantity here, got a range`,
      pos,
      `arithmetic and conversion operators don't apply to ranges; use '.sum', '.avg', etc.`,
    )
  }
  return v
}

export function asBoolean(v: Value, pos: Position): boolean {
  if (!isBoolean(v)) {
    throw new EvalError(
      `expected a boolean here, got a ${isRange(v) ? "range" : "quantity"}`,
      pos,
      `'and', 'or', 'not', and the condition of if/then/else need a boolean`,
    )
  }
  return v
}
