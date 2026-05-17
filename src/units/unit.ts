import Decimal from "decimal.js"
import type { DimensionVector } from "./dimension.ts"

/**
 * Maps atomic unit names (kg, m, s, rub, …) to integer exponents.
 * Canonical form omits zero entries. Used to render a clean display name
 * for composite units — `m * m` shows as `m^2`, `m / s / s` as `m/s^2`.
 */
export type AtomMap = ReadonlyMap<string, number>

export type Unit = {
  readonly name: string
  readonly atoms: AtomMap
  readonly dimension: DimensionVector
  readonly factor: Decimal
}

/** Construct a Unit with a single-atom name (i.e. the user's declared unit). */
export function makeNamedUnit(
  name: string,
  dimension: DimensionVector,
  factor: Decimal,
): Unit {
  return {
    name,
    atoms: new Map([[name, 1]]),
    dimension,
    factor,
  }
}

/** Construct a synthetic Unit with a derived name from its atom map. */
export function makeComposedUnit(
  atoms: AtomMap,
  dimension: DimensionVector,
  factor: Decimal,
): Unit {
  return {
    name: formatUnitName(atoms),
    atoms,
    dimension,
    factor,
  }
}

/**
 * Render an atom map as a canonical display name. Positive atoms join with
 * '·', negatives go to the right of '/'. Exponents !=1 use '^N'. Names are
 * sorted alphabetically for stable output: `kg·m/s^2` is always the same
 * string regardless of construction order.
 */
export function formatUnitName(atoms: AtomMap): string {
  if (atoms.size === 0) return "1"
  const positives: string[] = []
  const negatives: string[] = []
  const sorted = [...atoms.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [name, exp] of sorted) {
    if (exp === 0) continue
    if (exp > 0) {
      positives.push(exp === 1 ? name : `${name}^${exp}`)
    } else {
      negatives.push(-exp === 1 ? name : `${name}^${-exp}`)
    }
  }
  if (negatives.length === 0) return positives.join("·")
  if (positives.length === 0) return `1/${negatives.join("·")}`
  return `${positives.join("·")}/${negatives.join("·")}`
}

/** atomMul: combine atom maps with +/- exponent merge, dropping zeros. */
export function mulAtoms(a: AtomMap, b: AtomMap): AtomMap {
  return composeAtoms(a, b, 1)
}

export function divAtoms(a: AtomMap, b: AtomMap): AtomMap {
  return composeAtoms(a, b, -1)
}

export function powAtoms(a: AtomMap, n: number): AtomMap {
  if (n === 0) return new Map()
  const result = new Map<string, number>()
  for (const [name, exp] of a) {
    const next = exp * n
    if (next !== 0) result.set(name, next)
  }
  return result
}

function composeAtoms(a: AtomMap, b: AtomMap, sign: 1 | -1): AtomMap {
  const result = new Map<string, number>(a)
  for (const [name, exp] of b) {
    const current = result.get(name) ?? 0
    const next = current + sign * exp
    if (next === 0) result.delete(name)
    else result.set(name, next)
  }
  return result
}
