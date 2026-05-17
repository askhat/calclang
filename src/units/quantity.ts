import Decimal from "decimal.js"
import * as Dim from "./dimension.ts"
import { UnitError } from "./errors.ts"
import type { Unit } from "./unit.ts"

export type Quantity = {
  readonly value: Decimal
  readonly unit: Unit | null
}

// -- Constructors --

export function dimensionless(value: Decimal | number | string): Quantity {
  return { value: new Decimal(value), unit: null }
}

export function ofUnit(value: Decimal | number | string, unit: Unit): Quantity {
  return { value: new Decimal(value), unit }
}

// -- Unary --

export function neg(q: Quantity): Quantity {
  return { value: q.value.neg(), unit: q.unit }
}

// -- Additive (right operand wins) --

export function add(a: Quantity, b: Quantity): Quantity {
  return additive(a, b, "add")
}

export function sub(a: Quantity, b: Quantity): Quantity {
  return additive(a, b, "sub")
}

function additive(a: Quantity, b: Quantity, kind: "add" | "sub"): Quantity {
  // Both dimensionless: simple arithmetic.
  if (!a.unit && !b.unit) {
    return dimensionless(
      kind === "add" ? a.value.plus(b.value) : a.value.minus(b.value),
    )
  }
  // One dimensionless: the dimensioned operand contributes its unit; the
  // dimensionless value is treated as already being in that unit.
  if (!a.unit) {
    return {
      value: kind === "add" ? a.value.plus(b.value) : a.value.minus(b.value),
      unit: b.unit,
    }
  }
  if (!b.unit) {
    return {
      value: kind === "add" ? a.value.plus(b.value) : a.value.minus(b.value),
      unit: a.unit,
    }
  }
  // Both dimensioned: dimensions must match. Right unit wins.
  if (!Dim.equals(a.unit.dimension, b.unit.dimension)) {
    const op = kind === "add" ? "+" : "-"
    throw new UnitError(
      `cannot ${op === "+" ? "add" : "subtract"} ${a.unit.name} (${Dim.format(a.unit.dimension)}) and ${b.unit.name} (${Dim.format(b.unit.dimension)})`,
      `operands must share a dimension; convert with 'as' or check the declares`,
    )
  }
  const aInB = a.value.times(a.unit.factor).div(b.unit.factor)
  return {
    value: kind === "add" ? aInB.plus(b.value) : aInB.minus(b.value),
    unit: b.unit,
  }
}

// -- Multiplicative --

export function mul(a: Quantity, b: Quantity): Quantity {
  // Dimensionless × anything: just scale the value, keep the other unit.
  if (!a.unit) return { value: a.value.times(b.value), unit: b.unit }
  if (!b.unit) return { value: a.value.times(b.value), unit: a.unit }

  const newDim = Dim.mul(a.unit.dimension, b.unit.dimension)

  // Dimensions cancel: result is dimensionless. The unit factors must be
  // folded into the value so we don't lose information.
  if (Dim.isDimensionless(newDim)) {
    return {
      value: a.value
        .times(a.unit.factor)
        .times(b.value)
        .times(b.unit.factor),
      unit: null,
    }
  }

  return {
    value: a.value.times(b.value),
    unit: {
      name: composeName(a.unit.name, b.unit.name, "mul"),
      dimension: newDim,
      factor: a.unit.factor.times(b.unit.factor),
    },
  }
}

export function div(a: Quantity, b: Quantity): Quantity {
  if (b.value.isZero()) {
    throw new UnitError("division by zero")
  }
  const value = a.value.div(b.value)

  // Both dimensionless.
  if (!a.unit && !b.unit) return { value, unit: null }
  // Dimensioned / dimensionless: keep a's unit.
  if (!b.unit) return { value, unit: a.unit }
  // Dimensionless / dimensioned: invert b's unit.
  if (!a.unit) {
    return {
      value: value.div(b.unit.factor),
      unit: {
        name: `1/${b.unit.name}`,
        dimension: Dim.pow(b.unit.dimension, -1),
        factor: new Decimal(1).div(b.unit.factor),
      },
    }
  }
  // Both dimensioned.
  const newDim = Dim.div(a.unit.dimension, b.unit.dimension)
  if (Dim.isDimensionless(newDim)) {
    return {
      value: a.value.times(a.unit.factor).div(b.value.times(b.unit.factor)),
      unit: null,
    }
  }
  return {
    value,
    unit: {
      name: composeName(a.unit.name, b.unit.name, "div"),
      dimension: newDim,
      factor: a.unit.factor.div(b.unit.factor),
    },
  }
}

function composeName(a: string, b: string, op: "mul" | "div"): string {
  // NOT canonicalized (e.g. 'm·m' instead of 'm^2'). Stage 7 polish.
  return op === "mul" ? `${a}·${b}` : `${a}/${b}`
}

// -- Power --

export function pow(base: Quantity, exp: Quantity): Quantity {
  if (exp.unit) {
    throw new UnitError(
      `exponent must be dimensionless, got ${Dim.format(exp.unit.dimension)}`,
    )
  }
  // Identity / zero shortcuts also avoid producing weird synthetic names
  // like 'kg^0' or 'kg^1'.
  if (exp.value.isZero()) {
    return { value: new Decimal(1), unit: null }
  }
  if (exp.value.eq(1)) {
    return base
  }
  if (!base.unit) {
    // Dimensionless base — any exponent allowed.
    return { value: base.value.pow(exp.value), unit: null }
  }
  if (!exp.value.isInteger()) {
    throw new UnitError(
      `non-integer exponent ${exp.value.toString()} on a quantity with units (${Dim.format(base.unit.dimension)})`,
      `dimensioned quantities can only be raised to integer powers`,
    )
  }
  const n = exp.value.toNumber()
  return {
    value: base.value.pow(exp.value),
    unit: {
      name: `${base.unit.name}^${n}`,
      dimension: Dim.pow(base.unit.dimension, n),
      factor: base.unit.factor.pow(n),
    },
  }
}

// -- Conversion --

export function convert(q: Quantity, target: Unit): Quantity {
  if (!q.unit) {
    throw new UnitError(
      `cannot convert dimensionless value to ${target.name} (${Dim.format(target.dimension)})`,
      `assign units via a 'declare' or a literal like '5 ${target.name}'`,
    )
  }
  if (!Dim.equals(q.unit.dimension, target.dimension)) {
    throw new UnitError(
      `cannot convert ${q.unit.name} (${Dim.format(q.unit.dimension)}) to ${target.name} (${Dim.format(target.dimension)})`,
      `'as' requires the source and target to share a dimension`,
    )
  }
  return {
    value: q.value.times(q.unit.factor).div(target.factor),
    unit: target,
  }
}

// -- Comparisons --

/**
 * Three-way comparison. Returns -1, 0, or 1 as in Decimal.cmp. Throws if
 * both operands are dimensioned and dimensions differ. Dimensionless mixes
 * freely with dimensioned (matches the additive rule for symmetry).
 */
export function compare(a: Quantity, b: Quantity): number {
  if (!a.unit || !b.unit) {
    return a.value.cmp(b.value)
  }
  if (!Dim.equals(a.unit.dimension, b.unit.dimension)) {
    throw new UnitError(
      `cannot compare ${a.unit.name} (${Dim.format(a.unit.dimension)}) and ${b.unit.name} (${Dim.format(b.unit.dimension)})`,
      `operands must share a dimension`,
    )
  }
  return a.value.times(a.unit.factor).div(b.unit.factor).cmp(b.value)
}

export const eq = (a: Quantity, b: Quantity) => compare(a, b) === 0
export const neq = (a: Quantity, b: Quantity) => compare(a, b) !== 0
export const lt = (a: Quantity, b: Quantity) => compare(a, b) < 0
export const gt = (a: Quantity, b: Quantity) => compare(a, b) > 0
export const lte = (a: Quantity, b: Quantity) => compare(a, b) <= 0
export const gte = (a: Quantity, b: Quantity) => compare(a, b) >= 0
