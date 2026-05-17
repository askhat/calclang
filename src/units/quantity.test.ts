import { describe, expect, test } from "bun:test"
import Decimal from "decimal.js"
import { UnitError } from "./errors.ts"
import * as Q from "./quantity.ts"
import type { Unit } from "./unit.ts"

// -- Test fixtures: hand-built units (no registry; that's tested elsewhere) --

const kg: Unit = {
  name: "kg",
  dimension: { mass: 1 },
  factor: new Decimal(1),
}
const gr: Unit = {
  name: "gr",
  dimension: { mass: 1 },
  factor: new Decimal("0.001"),
}
const m: Unit = {
  name: "m",
  dimension: { length: 1 },
  factor: new Decimal(1),
}
const s: Unit = {
  name: "s",
  dimension: { time: 1 },
  factor: new Decimal(1),
}
const usd: Unit = {
  name: "usd",
  dimension: { currency: 1 },
  factor: new Decimal(1),
}
const rub: Unit = {
  name: "rub",
  dimension: { currency: 1 },
  factor: new Decimal(1).div(90.5),
}

const dim = (v: number | string) => Q.dimensionless(v)
const at = (v: number | string, u: Unit) => Q.ofUnit(v, u)
const str = (q: Q.Quantity) =>
  q.unit ? `${q.value.toString()} ${q.unit.name}` : q.value.toString()

describe("add", () => {
  test("both dimensionless", () => {
    expect(Q.add(dim(2), dim(3)).value.toString()).toBe("5")
  })

  test("same unit: trivial", () => {
    const r = Q.add(at(2, kg), at(3, kg))
    expect(r.value.toString()).toBe("5")
    expect(r.unit?.name).toBe("kg")
  })

  test("same dimension, different units — right wins, left converts", () => {
    // 100 rub + 5 usd: 100 rub = 100/90.5 usd ≈ 1.10497...; total ≈ 6.10497 usd
    const r = Q.add(at(100, rub), at(5, usd))
    expect(r.unit?.name).toBe("usd")
    expect(r.value.toFixed(5)).toBe("6.10497")
  })

  test("from the spec: 'salary + minusTen' = 25,5 rub", () => {
    const salary = at("35.5", rub)
    const minusTen = dim(-10)
    const total = Q.add(salary, minusTen)
    expect(total.unit?.name).toBe("rub")
    expect(total.value.toString()).toBe("25.5")
  })

  test("dimensionless + dimensioned: keeps the dimensioned unit", () => {
    const r = Q.add(dim(5), at(10, kg))
    expect(r.unit?.name).toBe("kg")
    expect(r.value.toString()).toBe("15")
  })

  test("mismatched dimensions throws with a hint", () => {
    expect(() => Q.add(at(1, kg), at(1, rub))).toThrow(UnitError)
    try {
      Q.add(at(1, kg), at(1, rub))
    } catch (e) {
      expect(e).toBeInstanceOf(UnitError)
      expect((e as UnitError).message).toContain("kg")
      expect((e as UnitError).message).toContain("rub")
      expect((e as UnitError).hint).toContain("dimension")
    }
  })
})

describe("sub", () => {
  test("simple", () => {
    expect(Q.sub(dim(10), dim(3)).value.toString()).toBe("7")
  })

  test("same dimension, different units — right wins", () => {
    // 100 rub - 5 usd: 100/90.5 - 5 ≈ -3.89503 usd
    const r = Q.sub(at(100, rub), at(5, usd))
    expect(r.unit?.name).toBe("usd")
    expect(r.value.toFixed(5)).toBe("-3.89503")
  })
})

describe("mul", () => {
  test("dimensionless × dimensionless", () => {
    expect(Q.mul(dim(3), dim(4)).value.toString()).toBe("12")
  })

  test("dimensioned × dimensionless: keeps unit", () => {
    const r = Q.mul(at(3, kg), dim(2))
    expect(r.value.toString()).toBe("6")
    expect(r.unit?.name).toBe("kg")
  })

  test("dimensioned × dimensioned: composes unit and adds dimensions", () => {
    const r = Q.mul(at(2, m), at(3, s))
    expect(r.value.toString()).toBe("6")
    expect(r.unit?.name).toBe("m·s")
    expect(r.unit?.dimension).toEqual({ length: 1, time: 1 })
  })

  test("dimensions cancel: result is dimensionless, factors fold into value", () => {
    // 2 gr * (1 / 1 kg) — must end up dimensionless, with 0.001 baked in
    const inverseKg: Unit = {
      name: "1/kg",
      dimension: { mass: -1 },
      factor: new Decimal(1), // 1/(base mass)
    }
    const r = Q.mul(at(2, gr), at(1, inverseKg))
    expect(r.unit).toBeNull()
    // 2 gr in base = 0.002. 1 (1/kg) in base = 1. Product = 0.002.
    expect(r.value.toString()).toBe("0.002")
  })
})

describe("div", () => {
  test("division by zero throws", () => {
    expect(() => Q.div(dim(1), dim(0))).toThrow(UnitError)
  })

  test("dimensioned / dimensionless: keeps unit", () => {
    const r = Q.div(at(10, kg), dim(2))
    expect(r.value.toString()).toBe("5")
    expect(r.unit?.name).toBe("kg")
  })

  test("same dimension: divides to dimensionless ratio (factors fold)", () => {
    // 1000 gr / 1 kg = (1000 * 0.001) / (1 * 1) = 1
    const r = Q.div(at(1000, gr), at(1, kg))
    expect(r.unit).toBeNull()
    expect(r.value.toString()).toBe("1")
  })

  test("different dimensions: composes (m/s)", () => {
    const r = Q.div(at(10, m), at(2, s))
    expect(r.value.toString()).toBe("5")
    expect(r.unit?.dimension).toEqual({ length: 1, time: -1 })
    expect(r.unit?.name).toBe("m/s")
  })

  test("dimensionless / dimensioned: inverts the unit", () => {
    const r = Q.div(dim(1), at(2, s))
    expect(r.value.toString()).toBe("0.5")
    expect(r.unit?.dimension).toEqual({ time: -1 })
    expect(r.unit?.name).toBe("1/s")
  })
})

describe("pow", () => {
  test("integer power on dimensioned", () => {
    const r = Q.pow(at(2, m), dim(3))
    expect(r.value.toString()).toBe("8")
    expect(r.unit?.dimension).toEqual({ length: 3 })
  })

  test("any power on dimensionless", () => {
    expect(Q.pow(dim(4), dim("0.5")).value.toString()).toBe("2")
  })

  test("non-integer on dimensioned throws", () => {
    expect(() => Q.pow(at(4, m), dim("0.5"))).toThrow(UnitError)
  })

  test("dimensioned exponent throws", () => {
    expect(() => Q.pow(at(2, m), at(3, s))).toThrow(UnitError)
  })

  test("^0 → dimensionless 1", () => {
    const r = Q.pow(at(5, kg), dim(0))
    expect(r.unit).toBeNull()
    expect(r.value.toString()).toBe("1")
  })

  test("^1 → identity", () => {
    const r = Q.pow(at(5, kg), dim(1))
    expect(r).toEqual(at(5, kg))
  })

  test("negative power inverts dimension", () => {
    const r = Q.pow(at(2, s), dim(-1))
    expect(r.value.toString()).toBe("0.5")
    expect(r.unit?.dimension).toEqual({ time: -1 })
  })
})

describe("neg", () => {
  test("flips sign, keeps unit", () => {
    const r = Q.neg(at("35.5", rub))
    expect(r.value.toString()).toBe("-35.5")
    expect(r.unit?.name).toBe("rub")
  })
})

describe("convert ('as')", () => {
  test("same dimension, different units: converts via factor ratio", () => {
    // salary (35.5 rub) as usd: 35.5 / 90.5 ≈ 0.39226 usd
    const r = Q.convert(at("35.5", rub), usd)
    expect(r.unit?.name).toBe("usd")
    expect(r.value.toFixed(5)).toBe("0.39227")
  })

  test("identity when target equals source dimensionally", () => {
    const r = Q.convert(at(2000, gr), kg)
    expect(r.unit?.name).toBe("kg")
    expect(r.value.toString()).toBe("2")
  })

  test("dimensionless to dimensioned throws", () => {
    expect(() => Q.convert(dim(5), kg)).toThrow(UnitError)
  })

  test("mismatched dimensions throws", () => {
    expect(() => Q.convert(at(5, kg), usd)).toThrow(UnitError)
  })
})

describe("comparisons", () => {
  test("equal: same value, same unit", () => {
    expect(Q.eq(at(5, kg), at(5, kg))).toBe(true)
  })

  test("equal across units: 1000 gr == 1 kg", () => {
    expect(Q.eq(at(1000, gr), at(1, kg))).toBe(true)
  })

  test("not-equal across units: 999 gr != 1 kg", () => {
    expect(Q.neq(at(999, gr), at(1, kg))).toBe(true)
    expect(Q.lt(at(999, gr), at(1, kg))).toBe(true)
  })

  test("dimensioned vs dimensioned with same dim: 5 usd > 100 rub", () => {
    // 5 usd in rub = 5 * 90.5 = 452.5; 452.5 > 100
    expect(Q.gt(at(5, usd), at(100, rub))).toBe(true)
  })

  test("mismatched dimensions throws", () => {
    expect(() => Q.compare(at(1, kg), at(1, usd))).toThrow(UnitError)
  })

  test("dimensioned vs dimensionless: lenient (for 'salary > 0')", () => {
    expect(Q.gt(at(10, rub), dim(0))).toBe(true)
  })
})

describe("string roundtrip helper", () => {
  test("dimensionless", () => {
    expect(str(dim(42))).toBe("42")
  })

  test("with unit", () => {
    expect(str(at(5, kg))).toBe("5 kg")
  })
})
