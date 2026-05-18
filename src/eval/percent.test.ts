import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"
import { evaluateProgram, type RunResult } from "./evaluator.ts"
import { isBoolean, isPercent, isQuantity } from "./value.ts"

function run(src: string) {
  const { tokens } = tokenize(src)
  const { program } = parseProgram(tokens)
  return evaluateProgram(program)
}

function fmt(r: RunResult): string {
  if (r.value === null) return "<no value>"
  if (isBoolean(r.value)) return String(r.value)
  if (isPercent(r.value)) {
    return `${r.value.value.times(100).toString()}%`
  }
  if (isQuantity(r.value)) {
    return r.value.unit
      ? `${r.value.value.toString()} ${r.value.unit.name}`
      : r.value.value.toString()
  }
  return "<unknown>"
}

const last = (r: RunResult[]): RunResult => r[r.length - 1]!

describe("percent literal", () => {
  test("bare percent evaluates to a Percent value displayed as N%", () => {
    const { results, diagnostics } = run("20%")
    expect(diagnostics).toEqual([])
    expect(fmt(last(results))).toBe("20%")
  })

  test("decimal percent — locale comma in source", () => {
    const { results } = run("12,5%")
    expect(fmt(last(results))).toBe("12.5%")
  })

  test("percent on a parenthesized expression", () => {
    const { results } = run("(1 + 2)%")
    expect(fmt(last(results))).toBe("3%")
  })

  test("percent on identifier (variable)", () => {
    const { results } = run("18 rate\nrate%")
    expect(fmt(last(results))).toBe("18%")
  })

  test("space between number and '%' is fine", () => {
    const { results } = run("20 %")
    expect(fmt(last(results))).toBe("20%")
  })
})

describe("percent — additive (Soulver convention)", () => {
  test("Quantity + Percent scales the quantity by 1+p", () => {
    const { results } = run("100 + 20%")
    expect(fmt(last(results))).toBe("120")
  })

  test("Quantity - Percent scales the quantity by 1-p", () => {
    const { results } = run("1000 - 13%")
    expect(fmt(last(results))).toBe("870")
  })

  test("Quantity-with-unit + Percent keeps the unit", () => {
    const { results } = run("UNIT Currency rub\n100 rub + 15%")
    expect(fmt(last(results))).toBe("115 rub")
  })

  test("Percent + Percent stays a percent", () => {
    const { results } = run("20% + 30%")
    expect(fmt(last(results))).toBe("50%")
  })

  test("Percent - Percent stays a percent", () => {
    const { results } = run("50% - 10%")
    expect(fmt(last(results))).toBe("40%")
  })

  test("Percent + Quantity coerces percent → dimensionless and adds", () => {
    // No Soulver rule for percent-on-left; falls through to plain addition.
    const { results } = run("20% + 100")
    expect(fmt(last(results))).toBe("100.2")
  })

  test("chained: A + p1 + p2 applies p1 to A, then p2 to A*(1+p1)", () => {
    // (100 + 20%) + 30% = 120 + 30% = 156
    const { results } = run("100 + 20% + 30%")
    expect(fmt(last(results))).toBe("156")
  })
})

describe("percent — multiplicative", () => {
  test("'of' is multiplication; reads as 'percent of quantity'", () => {
    const { results } = run("20% of 1000")
    expect(fmt(last(results))).toBe("200")
  })

  test("Percent * Quantity-with-unit applies percentage to the quantity", () => {
    const { results } = run("UNIT Currency rub\n20% * 1000 rub")
    expect(fmt(last(results))).toBe("200 rub")
  })

  test("Percent * dimensionless number coerces percent → fraction", () => {
    // Predictable rule: only Percent×Percent preserves percent-ness. Scaling
    // a percent by a scalar yields the fraction (write the percent directly
    // if you wanted '40%').
    const { results } = run("20% * 2")
    expect(fmt(last(results))).toBe("0.4")
  })

  test("scalar * Percent coerces percent → fraction", () => {
    const { results } = run("4 * 25%")
    expect(fmt(last(results))).toBe("1")
  })

  test("Percent / dimensionless number coerces percent → fraction", () => {
    const { results } = run("20% / 4")
    expect(fmt(last(results))).toBe("0.05")
  })

  test("Percent / Percent yields a plain ratio (not percent)", () => {
    const { results } = run("20% / 50%")
    expect(fmt(last(results))).toBe("0.4")
  })

  test("Percent of Percent multiplies fractions, stays percent", () => {
    // 20% of 50% = 0.20 × 0.50 = 0.10 = 10%
    const { results } = run("20% of 50%")
    expect(fmt(last(results))).toBe("10%")
  })

  test("precedence: of binds tighter than additive", () => {
    // 100 - 20% of 1000 = 100 - 200 = -100
    // The right operand of '-' is 200 (a Quantity), not a Percent,
    // so the Soulver scaling rule does NOT fire.
    const { results } = run("100 - 20% of 1000")
    expect(fmt(last(results))).toBe("-100")
  })
})

describe("percent — unary and edge cases", () => {
  test("unary minus on percent preserves percent-ness", () => {
    const { results } = run("-20%")
    expect(fmt(last(results))).toBe("-20%")
  })

  test("'%' on a unit-bearing quantity is rejected", () => {
    const { results, diagnostics } = run("UNIT Currency rub\n5 rub%")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toMatch(/dimensionless number/i)
    expect(results.length).toBeGreaterThan(0)
  })

  test("chained '%%' is rejected", () => {
    const { diagnostics } = run("5%%")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toMatch(/already a percent/i)
  })
})

describe("percent — comparisons (via coercion)", () => {
  test("20% > 10% compares fractions", () => {
    const { results } = run("20% > 10%")
    expect(fmt(last(results))).toBe("true")
  })

  test("Percent vs Quantity coerces percent", () => {
    const { results } = run("50% < 1")
    expect(fmt(last(results))).toBe("true")
  })
})

describe("percent in real-world formulas", () => {
  test("tax: 1000 + 13% VAT", () => {
    const { results } = run("UNIT Currency rub\n1000 rub + 13%")
    expect(fmt(last(results))).toBe("1130 rub")
  })

  test("discount: price - 20%", () => {
    const { results } = run("2_000 - 20%")
    expect(fmt(last(results))).toBe("1600")
  })

  test("compound interest factor: (1 + rate%)^years", () => {
    // 5% over 3 years: (1.05)^3 ≈ 1.157625
    const { results } = run("5 rate\n(1 + rate%)^3")
    expect(fmt(last(results))).toBe("1.157625")
  })
})
