import type Decimal from "decimal.js"
import type { Position } from "../parser/ast.ts"
import type { Quantity } from "../units/quantity.ts"
import type { RangeValue } from "./collection.ts"
import { EvalError } from "./errors.ts"
import type { PlotValue } from "./plot.ts"

/**
 * A percentage. Internally a fraction (0.20 for 20%). Distinct Value variant
 * so `+`/`-` against a quantity can apply the Soulver "relative to left" rule
 * and `*`/`of` can preserve percent-ness through pure-scalar arithmetic.
 * Coerced to a dimensionless `Quantity { value: fraction, unit: null }` when
 * used in any context that doesn't have a percent-aware rule.
 */
export type Percent = {
  readonly kind: "percent"
  readonly value: Decimal
}

/**
 * The result of evaluating an expression:
 *   - Quantity: object with `value` and `unit` (no `kind`).
 *   - RangeValue: object with `kind: "range"`.
 *   - Percent: object with `kind: "percent"`.
 *   - PlotValue: object with `kind: "plot"`.
 *   - boolean: primitive.
 * Series values are NOT first-class — a bare series identifier is an error
 * because there's no useful arithmetic to do with it.
 */
export type Value = Quantity | boolean | RangeValue | Percent | PlotValue

export function isBoolean(v: Value): v is boolean {
  return typeof v === "boolean"
}

export function isRange(v: Value): v is RangeValue {
  return typeof v === "object" && "kind" in v && v.kind === "range"
}

export function isPercent(v: Value): v is Percent {
  return typeof v === "object" && "kind" in v && v.kind === "percent"
}

export function isPlotValue(v: Value): v is PlotValue {
  return typeof v === "object" && "kind" in v && v.kind === "plot"
}

export function isQuantity(v: Value): v is Quantity {
  return typeof v === "object" && !("kind" in v)
}

/**
 * Coerce a Value into a Quantity for ops that don't have a percent-aware
 * rule. A Percent collapses into a dimensionless Quantity carrying its
 * fraction; range and boolean still error.
 */
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
  if (isPlotValue(v)) {
    throw new EvalError(
      `expected a quantity here, got a plot`,
      pos,
      `arithmetic and conversion operators don't apply to plots`,
    )
  }
  if (isPercent(v)) {
    return { value: v.value, unit: null }
  }
  return v
}

export function asBoolean(v: Value, pos: Position): boolean {
  if (!isBoolean(v)) {
    const kind = isRange(v) ? "range" : isPlotValue(v) ? "plot" : "quantity"
    throw new EvalError(
      `expected a boolean here, got a ${kind}`,
      pos,
      `'and', 'or', 'not', and the condition of if/then/else need a boolean`,
    )
  }
  return v
}
