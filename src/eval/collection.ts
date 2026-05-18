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
 * - Step is always ±1 *in the range unit*; direction is `+1` when start ≤
 *   end (after conversion to the range unit), else `-1`.
 * - Decimal endpoints OK; step stays 1 so `1,5..5,5` is 1.5–5.5.
 * - `inclusive` includes both endpoints when reachable; exclusive stops one
 *   step short of `end`.
 * - With units: the range unit is the END's unit (last explicit, mirroring
 *   the series rule). A dimensionless endpoint is promoted into the range
 *   unit; a same-dim differently-unit endpoint is converted; mismatched
 *   dimensions throw via `Q.convert`.
 */
export function materializeRange(
  start: Quantity,
  end: Quantity,
  inclusive: boolean,
  pos: Position,
): RangeValue {
  const rangeUnit: Unit | null = end.unit ?? start.unit ?? null
  const startValue = valueIn(start, rangeUnit, pos)
  const endValue = valueIn(end, rangeUnit, pos)

  const ascending = startValue.lte(endValue)
  const step = ascending ? new Decimal(1) : new Decimal(-1)

  const members: Quantity[] = []
  let i = startValue
  while (true) {
    const cmp = i.cmp(endValue)
    const stop = ascending
      ? inclusive
        ? cmp > 0
        : cmp >= 0
      : inclusive
        ? cmp < 0
        : cmp <= 0
    if (stop) break
    members.push({ value: i, unit: rangeUnit })
    if (members.length > MAX_RANGE_MEMBERS) {
      throw new EvalError(
        `range too large (>${MAX_RANGE_MEMBERS} members)`,
        pos,
        "narrow the bounds; current step is fixed at 1",
      )
    }
    i = i.plus(step)
  }

  return {
    kind: "range",
    start,
    end,
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
