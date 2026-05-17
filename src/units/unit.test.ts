import { describe, expect, test } from "bun:test"
import Decimal from "decimal.js"
import * as Q from "./quantity.ts"
import {
  divAtoms,
  formatUnitName,
  makeNamedUnit,
  mulAtoms,
  powAtoms,
  type AtomMap,
} from "./unit.ts"

const m = makeNamedUnit("m", { length: 1 }, new Decimal(1))
const s = makeNamedUnit("s", { time: 1 }, new Decimal(1))
const kg = makeNamedUnit("kg", { mass: 1 }, new Decimal(1))

const at = (v: number, u: Parameters<typeof Q.ofUnit>[1]) => Q.ofUnit(v, u)

describe("formatUnitName", () => {
  test("empty map → '1'", () => {
    expect(formatUnitName(new Map())).toBe("1")
  })

  test("single positive atom", () => {
    expect(formatUnitName(new Map([["kg", 1]]))).toBe("kg")
  })

  test("single positive atom with exponent", () => {
    expect(formatUnitName(new Map([["m", 2]]))).toBe("m^2")
  })

  test("multiple positives, alphabetical order", () => {
    // Insertion order is reverse-alphabetical to verify sort.
    expect(
      formatUnitName(
        new Map([
          ["s", 1],
          ["kg", 1],
          ["m", 1],
        ]),
      ),
    ).toBe("kg·m·s")
  })

  test("only negative atoms", () => {
    expect(formatUnitName(new Map([["s", -1]]))).toBe("1/s")
  })

  test("only negative atoms with exponent", () => {
    expect(formatUnitName(new Map([["s", -2]]))).toBe("1/s^2")
  })

  test("mix: kg·m / s^2 (Newton)", () => {
    expect(
      formatUnitName(
        new Map([
          ["kg", 1],
          ["m", 1],
          ["s", -2],
        ]),
      ),
    ).toBe("kg·m/s^2")
  })

  test("zero atoms are stripped", () => {
    // (zero entries don't appear in canonical maps; this just confirms format
    // doesn't include them if they slip in)
    expect(formatUnitName(new Map([["m", 0], ["s", 1]]))).toBe("s")
  })
})

describe("atom composition", () => {
  test("mulAtoms adds exponents", () => {
    const result = mulAtoms(new Map([["m", 1]]), new Map([["m", 1]]))
    expect([...result.entries()]).toEqual([["m", 2]])
  })

  test("mulAtoms drops zeros", () => {
    const result = mulAtoms(new Map([["m", 1]]), new Map([["m", -1]]))
    expect(result.size).toBe(0)
  })

  test("divAtoms subtracts exponents", () => {
    const result = divAtoms(new Map([["m", 1]]), new Map([["s", 1]]))
    expect([...result.entries()].sort()).toEqual([["m", 1], ["s", -1]])
  })

  test("powAtoms multiplies exponents", () => {
    const result = powAtoms(new Map([["s", -1]]), 2)
    expect([...result.entries()]).toEqual([["s", -2]])
  })

  test("powAtoms(0) → empty", () => {
    const result = powAtoms(new Map([["m", 1]]), 0)
    expect(result.size).toBe(0)
  })
})

describe("canonicalization through Quantity arithmetic", () => {
  test("m * m yields m^2", () => {
    expect(Q.mul(at(2, m), at(3, m)).unit?.name).toBe("m^2")
  })

  test("m / s gives m/s, then * s leaves just m", () => {
    const ms = Q.div(at(10, m), at(2, s))
    expect(ms.unit?.name).toBe("m/s")
    const m_back = Q.mul(ms, at(2, s))
    expect(m_back.unit?.name).toBe("m")
  })

  test("m / s / s yields m/s^2", () => {
    const a = Q.div(Q.div(at(9.8, m), at(1, s)), at(1, s))
    expect(a.unit?.name).toBe("m/s^2")
  })

  test("kg * m / s^2 (Newton) — stable alphabetical order", () => {
    // Build (m / s^2) * kg; the canonical name should still be kg·m/s^2.
    const newton = Q.mul(Q.div(at(1, m), Q.pow(at(1, s), Q.dimensionless(2))), at(1, kg))
    expect(newton.unit?.name).toBe("kg·m/s^2")
  })

  test("s^-2 via pow with negative exponent", () => {
    const r = Q.pow(at(1, s), Q.dimensionless(-2))
    expect(r.unit?.name).toBe("1/s^2")
  })
})
