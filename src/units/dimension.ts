/**
 * A dimension vector maps base-dimension names ("mass", "length", "currency",
 * "time", …) to integer exponents. Canonical form omits zero entries so two
 * vectors are equal iff they have the same key set with the same values; the
 * equals() helper is also tolerant of explicit zero entries.
 */
export type DimensionVector = Readonly<Record<string, number>>

export const DIMENSIONLESS: DimensionVector = Object.freeze({})

export function isDimensionless(v: DimensionVector): boolean {
  for (const exp of Object.values(v)) {
    if (exp !== 0) return false
  }
  return true
}

export function equals(a: DimensionVector, b: DimensionVector): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  }
  return true
}

export function mul(a: DimensionVector, b: DimensionVector): DimensionVector {
  return compose(a, b, 1)
}

export function div(a: DimensionVector, b: DimensionVector): DimensionVector {
  return compose(a, b, -1)
}

export function pow(v: DimensionVector, n: number): DimensionVector {
  if (n === 0) return DIMENSIONLESS
  const result: Record<string, number> = {}
  for (const [k, exp] of Object.entries(v)) {
    const next = exp * n
    if (next !== 0) result[k] = next
  }
  return result
}

function compose(
  a: DimensionVector,
  b: DimensionVector,
  sign: 1 | -1,
): DimensionVector {
  const result: Record<string, number> = {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const v = (a[k] ?? 0) + sign * (b[k] ?? 0)
    if (v !== 0) result[k] = v
  }
  return result
}

/**
 * Human-readable form for diagnostics: "mass·length/time^2", "kg", "1/s",
 * "dimensionless".
 */
export function format(v: DimensionVector): string {
  if (isDimensionless(v)) return "dimensionless"
  const positives: string[] = []
  const negatives: string[] = []
  for (const [k, exp] of Object.entries(v)) {
    if (exp > 0) positives.push(exp === 1 ? k : `${k}^${exp}`)
    else if (exp < 0) negatives.push(-exp === 1 ? k : `${k}^${-exp}`)
  }
  if (negatives.length === 0) return positives.join("·")
  if (positives.length === 0) return `1/${negatives.join("·")}`
  return `${positives.join("·")}/${negatives.join("·")}`
}
