import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"
import { evaluateProgram, type RunResult } from "./evaluator.ts"
import { isQuantity } from "./value.ts"

function run(src: string) {
  const { tokens } = tokenize(src)
  const { program } = parseProgram(tokens)
  return evaluateProgram(program)
}

function lastValue(results: RunResult[]): string {
  const r = results[results.length - 1]!
  if (r.error) return `<error: ${r.error.message}>`
  if (r.value === null) return "<null>"
  if (typeof r.value === "boolean") return String(r.value)
  if (isQuantity(r.value)) {
    return r.value.unit
      ? `${r.value.value.toString()} ${r.value.unit.name}`
      : r.value.value.toString()
  }
  return "<unknown>"
}

describe("SERIES — basic aggregates on dimensionless members", () => {
  const setup = ["SERIES foo", "100", "20", "222", "500", "-3909", "0"].join(
    "\n",
  )

  test("count", () => {
    const { results, diagnostics } = run(setup + "\n\nfoo.count")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("6")
  })

  test("sum", () => {
    const { results, diagnostics } = run(setup + "\n\nfoo.sum")
    expect(diagnostics).toEqual([])
    // 100 + 20 + 222 + 500 - 3909 + 0 = -3067
    expect(lastValue(results)).toBe("-3067")
  })

  test("avg = sum / count", () => {
    const { results, diagnostics } = run(setup + "\n\nfoo.avg")
    expect(diagnostics).toEqual([])
    // -3067 / 6
    const r = results[results.length - 1]!
    expect(r.value && isQuantity(r.value) ? r.value.value.toFixed(4) : "").toBe(
      "-511.1667",
    )
  })

  test("min", () => {
    const { results } = run(setup + "\n\nfoo.min")
    expect(lastValue(results)).toBe("-3909")
  })

  test("max", () => {
    const { results } = run(setup + "\n\nfoo.max")
    expect(lastValue(results)).toBe("500")
  })
})

describe("SERIES with units", () => {
  test("series of same unit: sum keeps the unit", () => {
    const src = [
      "UNIT Currency usd",
      "SERIES income",
      "100 usd",
      "200 usd",
      "50 usd",
      "",
      "income.sum",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    const r = results[results.length - 1]!
    expect(r.value && isQuantity(r.value) && r.value.unit?.name).toBe("usd")
    expect(
      r.value && isQuantity(r.value) ? r.value.value.toString() : "",
    ).toBe("350")
  })

  test("series with mixed units (same dim): result in first member's unit", () => {
    const src = [
      "UNIT Currency usd",
      "UNIT (usd / 90,5) rub",
      "SERIES income",
      "100 rub",
      "5 usd",
      "",
      "income.sum",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    const r = results[results.length - 1]!
    expect(r.value && isQuantity(r.value) && r.value.unit?.name).toBe("rub")
    // First member rub. 100 rub + 5 usd; 5 usd in rub = 5 * 90.5 = 452.5
    // Total in rub: 100 + 452.5 = 552.5. Decimal carries the conversion
    // round-trip imprecisely at the trailing digits, so compare on a
    // rounded form (which is what the formatter shows users).
    expect(
      r.value && isQuantity(r.value) ? r.value.value.toFixed(4) : "",
    ).toBe("552.5000")
  })

  test("min/max across same-dim, different-unit members", () => {
    const src = [
      "UNIT Currency usd",
      "UNIT (usd / 90,5) rub",
      "SERIES wallet",
      "100 rub",
      "5 usd",
      "",
      "wallet.min",
    ].join("\n")
    const { results } = run(src)
    // 100 rub ≈ 1.105 usd. 5 usd > 1.105. So min is 100 rub.
    const r = results[results.length - 1]!
    expect(r.value && isQuantity(r.value) && r.value.unit?.name).toBe("rub")
  })

  test("dimension mismatch in series is diagnosed", () => {
    const src = [
      "UNIT Currency usd",
      "UNIT Mass kg",
      "SERIES mixed",
      "10 usd",
      "5 kg",
      "",
      "mixed.sum",
    ].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message.toLowerCase()).toContain("dimension")
  })
})

describe("SERIES error paths", () => {
  test("bare reference to series (without .method) is a helpful error", () => {
    const src = "SERIES foo\n1\n2\n\nfoo + 1"
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("series")
    expect(diagnostics[0]?.message).toContain("foo.sum")
  })

  test("unknown method '.frobnicate' is diagnosed", () => {
    const src = "SERIES foo\n1\n\nfoo.frobnicate"
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("unknown series method")
  })

  test("empty series: count is 0, sum/avg errors", () => {
    const src = "SERIES empty\n\nempty.count"
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("0")

    const { diagnostics: errDiag } = run("SERIES empty\n\nempty.sum")
    expect(errDiag.length).toBeGreaterThan(0)
    expect(errDiag[0]?.message).toContain("empty series")
  })

  test("cyclic series → diagnostic", () => {
    const src = [
      "SERIES a",
      "b.sum",
      "1",
      "",
      "SERIES b",
      "a.sum",
      "2",
      "",
      "a.sum",
    ].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("cyclic")
  })

  test("duplicate series declaration is reported", () => {
    const src = "SERIES foo\n1\n\nSERIES foo\n2"
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("already declared")
  })
})

describe("SERIES with referenced variables", () => {
  test("series members can reference variables (lazy resolve)", () => {
    const src = [
      "10 a",
      "20 b",
      "SERIES nums",
      "a",
      "b",
      "a + b",
      "",
      "nums.sum",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("60") // 10 + 20 + 30
  })

  test("series referenced from an expression assignment", () => {
    const src = [
      "SERIES temps",
      "10",
      "20",
      "30",
      "",
      "temps.avg = mean",
      "mean",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("20")
  })
})
