import Decimal from "decimal.js"
import type { Position } from "../parser/ast.ts"
import type { DimensionVector } from "../units/dimension.ts"
import * as Q from "../units/quantity.ts"
import type { Quantity } from "../units/quantity.ts"
import type { Unit } from "../units/unit.ts"
import { EvalError } from "./errors.ts"
import type { Value } from "./value.ts"

/**
 * Common shape for collection-like values that support `.sum / .avg / .count
 * / .min / .max` aggregates. Series and Range both implement this; new
 * collection kinds can be added by widening the union below and feeding into
 * `computeAggregate`.
 */
export interface Collection {
  readonly kind: "series" | "range"
  /** Materialized members in order. All share `dimension`. */
  readonly members: readonly Quantity[]
  /** Unified dimension vector. `{}` for dimensionless. */
  readonly dimension: DimensionVector
  /** "Default" unit. Aggregates render in this. `null` if dimensionless. */
  readonly unit: Unit | null
}

export interface SeriesValue extends Collection {
  readonly kind: "series"
  /** Map from named-member name to its (post-promotion) Quantity. */
  readonly byName: ReadonlyMap<string, Quantity>
}

export interface RangeValue extends Collection {
  readonly kind: "range"
  readonly start: Quantity
  readonly end: Quantity
  readonly inclusive: boolean
  /** Step value in the range unit. Always positive. Default 1. */
  readonly step: Decimal
}

export const AGGREGATE_METHODS = new Set([
  "sum",
  "avg",
  "count",
  "min",
  "max",
])

export function computeAggregate(
  c: Collection,
  method: string,
  pos: Position,
): Value {
  if (method === "count") {
    return { value: new Decimal(c.members.length), unit: null }
  }
  if (!AGGREGATE_METHODS.has(method)) {
    throw new EvalError(
      `unknown method '.${method}'`,
      pos,
      "available methods: sum, avg, count, min, max",
    )
  }
  if (c.members.length === 0) {
    throw new EvalError(
      `cannot compute '.${method}' on an empty ${c.kind}`,
      pos,
      `either add members or use '.count' which is 0 for an empty ${c.kind}`,
    )
  }
  switch (method) {
    case "sum":
      return sum(c, pos)
    case "avg":
      return avg(c, pos)
    case "min":
      return extreme(c, pos, "min")
    case "max":
      return extreme(c, pos, "max")
  }
  // Unreachable thanks to AGGREGATE_METHODS check above.
  throw new EvalError(`unhandled aggregate '${method}'`, pos)
}

function sum(c: Collection, pos: Position): Quantity {
  try {
    let acc = c.members[0]!
    for (let i = 1; i < c.members.length; i++) {
      // Q.add lets the right operand's unit win. Members are pre-promoted
      // into the collection's unit, so folding left-to-right yields a sum
      // in that unit.
      acc = Q.add(acc, c.members[i]!)
    }
    return inUnit(acc, c, pos)
  } catch (err) {
    throw EvalError.from(err, pos)
  }
}

function avg(c: Collection, pos: Position): Quantity {
  const total = sum(c, pos)
  try {
    return Q.div(total, {
      value: new Decimal(c.members.length),
      unit: null,
    })
  } catch (err) {
    throw EvalError.from(err, pos)
  }
}

function extreme(
  c: Collection,
  pos: Position,
  kind: "min" | "max",
): Quantity {
  try {
    let best = c.members[0]!
    for (let i = 1; i < c.members.length; i++) {
      const cmp = Q.compare(c.members[i]!, best)
      if (kind === "min" ? cmp < 0 : cmp > 0) best = c.members[i]!
    }
    return inUnit(best, c, pos)
  } catch (err) {
    throw EvalError.from(err, pos)
  }
}

/**
 * Coerce an aggregate result into the collection's default unit so all of
 * `.sum`/`.avg`/`.min`/`.max` render in the same unit even when members
 * mixed units within one dimension.
 */
function inUnit(q: Quantity, c: Collection, pos: Position): Quantity {
  if (!c.unit) return q
  if (!q.unit) return { value: q.value, unit: c.unit }
  if (q.unit === c.unit) return q
  try {
    return Q.convert(q, c.unit)
  } catch (err) {
    throw EvalError.from(err, pos)
  }
}

/**
 * Hard cap on materialized range size — protects against a typo'd
 * `1..1_000_000_000` taking out the editor. Tune later if needed.
 */
const MAX_RANGE_MEMBERS = 100_000

/**
 * Materialize a range literal into a `RangeValue`.
 *
 * Semantics (snap-to-multiples):
 *   - `start` is always anchored (always emitted for inclusive).
 *   - After `start`, append every multiple of `step` strictly between
 *     `start` and `end` — including `end` for inclusive `..`, excluding it
 *     for exclusive `...`.
 *   - For exclusive: if no such multiples exist (step jumps past `end`),
 *     `start` is also omitted, giving an empty range.
 *   - Direction is determined by `start <= end` (after conversion into the
 *     range unit). For descending, "multiples between" walks downward.
 *
 * Examples (with implicit step 1 unless given):
 *   1..10        → {1, 2, …, 10}
 *   1..10/5      → {1, 5, 10}
 *   1..10/3      → {1, 3, 6, 9}
 *   1..10/100    → {1}             (step jumps past end; start anchors)
 *   1...10/100   → {}              (exclusive: start dropped too)
 *   10..1/1      → {10, 9, …, 1}
 *
 * Units: the range unit is end's unit (last explicit, mirroring series).
 * Endpoints with same dim get converted; dimensionless promote; mismatched
 * dimensions throw via `Q.convert`. Step's unit, if provided, must match
 * (or be dimensionless) and is converted to the range unit.
 */
export function materializeRange(
  start: Quantity,
  end: Quantity,
  step: Quantity | null,
  inclusive: boolean,
  pos: Position,
): RangeValue {
  const rangeUnit: Unit | null = end.unit ?? start.unit ?? null
  const startValue = valueIn(start, rangeUnit, pos)
  const endValue = valueIn(end, rangeUnit, pos)
  const stepValue = step === null ? new Decimal(1) : valueIn(step, rangeUnit, pos)

  if (stepValue.lte(0)) {
    throw new EvalError(
      `range step must be positive, got ${stepValue.toString()}`,
      pos,
      "direction is inferred from start vs end; step is always positive",
    )
  }

  const ascending = startValue.lte(endValue)
  const insideMultiples: Decimal[] = []

  if (ascending) {
    // First multiple of step strictly greater than start.
    let i = startValue.div(stepValue).floor().plus(1).times(stepValue)
    while (true) {
      const cmp = i.cmp(endValue)
      const stop = inclusive ? cmp > 0 : cmp >= 0
      if (stop) break
      insideMultiples.push(i)
      if (insideMultiples.length > MAX_RANGE_MEMBERS) {
        throw new EvalError(
          `range too large (>${MAX_RANGE_MEMBERS} members)`,
          pos,
          "narrow the bounds or use a larger step",
        )
      }
      i = i.plus(stepValue)
    }
  } else {
    // First multiple of step strictly less than start (walking down).
    let i = startValue.div(stepValue).ceil().minus(1).times(stepValue)
    while (true) {
      const cmp = i.cmp(endValue)
      const stop = inclusive ? cmp < 0 : cmp <= 0
      if (stop) break
      insideMultiples.push(i)
      if (insideMultiples.length > MAX_RANGE_MEMBERS) {
        throw new EvalError(
          `range too large (>${MAX_RANGE_MEMBERS} members)`,
          pos,
          "narrow the bounds or use a larger step",
        )
      }
      i = i.minus(stepValue)
    }
  }

  // Inclusive always anchors start; exclusive anchors start only when at
  // least one in-range multiple exists.
  const members: Quantity[] = []
  if (inclusive || insideMultiples.length > 0) {
    members.push({ value: startValue, unit: rangeUnit })
    for (const m of insideMultiples) {
      members.push({ value: m, unit: rangeUnit })
    }
  }

  return {
    kind: "range",
    start,
    end,
    step: stepValue,
    inclusive,
    members,
    dimension: rangeUnit?.dimension ?? {},
    unit: rangeUnit,
  }
}

/**
 * Bring an endpoint into the range unit's value-space. A dimensionless
 * endpoint with a unit target is promoted (no conversion); a same-dim
 * different-unit endpoint is converted; everything else delegates to
 * `Q.convert`'s diagnostics.
 */
function valueIn(q: Quantity, target: Unit | null, pos: Position): Decimal {
  if (target === null) return q.value
  if (!q.unit || q.unit === target) return q.value
  try {
    return Q.convert(q, target).value
  } catch (err) {
    throw EvalError.from(err, pos)
  }
}
