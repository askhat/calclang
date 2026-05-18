import Decimal from "decimal.js"
import { isPercent, isQuantity, type Percent, type Value } from "./value.ts"

/**
 * Percent-aware arithmetic. Two design rules drive everything here:
 *
 *   1) Soulver convention: `<Quantity> ± <Percent>` reads "scale the
 *      quantity by 1±p", so `100 + 20%` = 120 and `1000 - 13%` = 870.
 *      The percent is interpreted *relative to the left operand*.
 *
 *   2) Percent-ness is preserved through pure-scalar arithmetic so chains
 *      read naturally: `2 * 20%` = 40%, `20% of 50%` = 10%, `20% / 4` = 5%.
 *      The moment a unit-bearing quantity enters, percent collapses into
 *      its dimensionless fraction (`20% * 100 rub` = 20 rub).
 *
 * Helpers below return `null` when no percent-aware rule applies; the
 * evaluator then falls back to the standard quantity path (via `asQuantity`,
 * which coerces percent → dimensionless quantity).
 */

export function percentValue(fraction: Decimal | number | string): Percent {
  return { kind: "percent", value: new Decimal(fraction) }
}

/**
 * Build a Percent from a "display number" (e.g. 20 for 20%). Used by the
 * evaluator when it processes the `expr%` postfix: the inner expression's
 * value is the displayed percentage, the stored fraction is value/100.
 */
export function percentFromDisplay(display: Decimal): Percent {
  return { kind: "percent", value: display.div(100) }
}

/** Quantity ± Percent (Soulver scaling) and Percent ± Percent. */
export function additiveWithPercent(
  left: Value,
  right: Value,
  op: "add" | "sub",
): Value | null {
  if (isPercent(left) && isPercent(right)) {
    return {
      kind: "percent",
      value:
        op === "add"
          ? left.value.plus(right.value)
          : left.value.minus(right.value),
    }
  }
  if (isQuantity(left) && isPercent(right)) {
    const one = new Decimal(1)
    const factor = op === "add" ? one.plus(right.value) : one.minus(right.value)
    return { value: left.value.times(factor), unit: left.unit }
  }
  return null
}

/**
 * `*`, `/`, and `of` against percents. `of` is a multiplication synonym
 * that reads naturally for percentages (`20% of 1000`). Rules:
 *
 *   - Both sides Percent (`mul`/`of`) → Percent (fractions multiply, e.g.
 *     `20% of 50%` = 10%).
 *   - Anything else with a percent → caller coerces the percent into its
 *     dimensionless fraction and runs the standard arithmetic. So:
 *       `20% of 1000`      = 200   (plain)
 *       `20% * 1000 rub`   = 200 rub
 *       `2 * 20%`          = 0,4   (plain)
 *       `20% / 4`          = 0,05  (plain)
 *
 * The "scale a percent by a scalar" reading (`2 * 20% = 40%`) is tempting
 * but inconsistent with `20% of 1000 = 200` — we can't tell the magnitude
 * of "1000" from "2". Returning percent only when *both* operands are
 * percent keeps the rule predictable.
 */
export function multiplicativeWithPercent(
  left: Value,
  right: Value,
  op: "mul" | "div" | "of",
): Value | null {
  if (!isPercent(left) || !isPercent(right)) return null
  if (op === "mul" || op === "of") {
    return { kind: "percent", value: left.value.times(right.value) }
  }
  // div: ratio of two percents is a plain dimensionless number.
  return { value: left.value.div(right.value), unit: null }
}

/** Negate a percent without losing percent-ness. */
export function negatePercent(p: Percent): Percent {
  return { kind: "percent", value: p.value.neg() }
}
