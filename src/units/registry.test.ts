import { describe, expect, test } from "bun:test"
import Decimal from "decimal.js"
import { UnitError } from "./errors.ts"
import * as Q from "./quantity.ts"
import { UnitRegistry } from "./registry.ts"

describe("registerBase", () => {
  test("creates a unit with factor 1 and a single-component dimension", () => {
    const reg = new UnitRegistry()
    const kg = reg.registerBase("kg", "mass")
    expect(kg.name).toBe("kg")
    expect(kg.dimension).toEqual({ mass: 1 })
    expect(kg.factor.toString()).toBe("1")
  })

  test("duplicate name throws", () => {
    const reg = new UnitRegistry()
    reg.registerBase("kg", "mass")
    expect(() => reg.registerBase("kg", "mass")).toThrow(UnitError)
  })
})

describe("registerAlias", () => {
  test("creates a unit with factor 1 (placeholder for dynamic FX)", () => {
    const reg = new UnitRegistry()
    const kzt = reg.registerAlias("kzt", "currency")
    expect(kzt.dimension).toEqual({ currency: 1 })
    expect(kzt.factor.toString()).toBe("1")
  })
})

describe("registerDerived", () => {
  test("from spec: rub = usd / 90.5", () => {
    const reg = new UnitRegistry()
    const usd = reg.registerBase("usd", "currency")
    // body of unit decl evaluates to (1/90.5) usd; we pass that quantity in.
    const body = Q.div(Q.ofUnit(1, usd), Q.dimensionless("90.5"))
    const rub = reg.registerDerived("rub", body)
    expect(rub.dimension).toEqual({ currency: 1 })
    // 1 rub = 1/90.5 usd-base ≈ 0.011049...
    expect(rub.factor.toFixed(10)).toBe("0.0110497238")
  })

  test("from spec: gr = kg / 1000", () => {
    const reg = new UnitRegistry()
    const kg = reg.registerBase("kg", "mass")
    const body = Q.div(Q.ofUnit(1, kg), Q.dimensionless(1000))
    const gr = reg.registerDerived("gr", body)
    expect(gr.factor.toString()).toBe("0.001")
  })

  test("derived from another derived: factors compose", () => {
    const reg = new UnitRegistry()
    const kg = reg.registerBase("kg", "mass")
    const gr = reg.registerDerived(
      "gr",
      Q.div(Q.ofUnit(1, kg), Q.dimensionless(1000)),
    )
    // mg = gr / 1000 → 1 mg = 0.001 gr = 0.000001 kg
    const mg = reg.registerDerived(
      "mg",
      Q.div(Q.ofUnit(1, gr), Q.dimensionless(1000)),
    )
    expect(mg.factor.toString()).toBe("0.000001")
  })

  test("rejects dimensionless body with a hint", () => {
    const reg = new UnitRegistry()
    expect(() =>
      reg.registerDerived("nope", Q.dimensionless(5)),
    ).toThrow(UnitError)
    try {
      reg.registerDerived("nope", Q.dimensionless(5))
    } catch (e) {
      expect((e as UnitError).hint).toContain("unit nope")
    }
  })
})

describe("get / has / all", () => {
  test("get returns the registered unit", () => {
    const reg = new UnitRegistry()
    const kg = reg.registerBase("kg", "mass")
    expect(reg.get("kg")).toBe(kg)
  })

  test("get returns undefined for unknown name", () => {
    const reg = new UnitRegistry()
    expect(reg.get("kg")).toBeUndefined()
  })

  test("has reports presence", () => {
    const reg = new UnitRegistry()
    reg.registerBase("kg", "mass")
    expect(reg.has("kg")).toBe(true)
    expect(reg.has("rub")).toBe(false)
  })

  test("all yields units in declaration order", () => {
    const reg = new UnitRegistry()
    reg.registerBase("kg", "mass")
    reg.registerBase("m", "length")
    reg.registerBase("s", "time")
    expect([...reg.all()].map((u) => u.name)).toEqual(["kg", "m", "s"])
  })
})

describe("end-to-end: budget.calc unit chain", () => {
  test("conversion via the registered chain matches direct arithmetic", () => {
    const reg = new UnitRegistry()
    const usd = reg.registerBase("usd", "currency")
    const rub = reg.registerDerived(
      "rub",
      Q.div(Q.ofUnit(1, usd), Q.dimensionless("90.5")),
    )
    const kzt = reg.registerDerived(
      "kzt",
      Q.div(Q.ofUnit(1, usd), Q.dimensionless("467.245543")),
    )
    // 35.5 rub as kzt: through the registry's factors.
    const salary = Q.ofUnit("35.5", rub)
    const inKzt = Q.convert(salary, kzt)
    // base-usd value of salary = 35.5 / 90.5
    // in kzt = (35.5 / 90.5) * 467.245543
    const expected = new Decimal("35.5")
      .div("90.5")
      .times("467.245543")
    expect(inKzt.value.toFixed(8)).toBe(expected.toFixed(8))
    expect(inKzt.unit?.name).toBe("kzt")
  })
})
