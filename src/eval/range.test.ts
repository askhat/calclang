import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"
import { evaluateProgram, type RunResult } from "./evaluator.ts"
import { isQuantity, isRange } from "./value.ts"

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
  if (isRange(r.value)) {
    const sep = r.value.inclusive ? ".." : "..."
    const fmt = (q: { value: import("decimal.js").default; unit: { name: string } | null }) =>
      q.unit ? `${q.value.toString()} ${q.unit.name}` : q.value.toString()
    const step = r.value.step.eq(1) ? "" : `/${r.value.step.toString()}`
    return `${fmt(r.value.start)}${sep}${fmt(r.value.end)}${step} (n=${r.value.members.length})`
  }
  if (isQuantity(r.value)) {
    return r.value.unit
      ? `${r.value.value.toString()} ${r.value.unit.name}`
      : r.value.value.toString()
  }
  return "<unknown>"
}

describe("Range — bare literal expressions", () => {
  test("`1..10` evaluates to a RangeValue with 10 members", () => {
    const { results, diagnostics } = run("1..10")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("1..10 (n=10)")
  })

  test("`1...10` (exclusive) has 9 members", () => {
    const { results, diagnostics } = run("1...10")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("1...10 (n=9)")
  })

  test("decimal endpoints: `1,5..5,5` → 5 members", () => {
    const { results, diagnostics } = run("1,5..5,5")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("1.5..5.5 (n=5)")
  })

  test("reverse: `10..1` walks down → 10 members", () => {
    const { results, diagnostics } = run("10..1")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("10..1 (n=10)")
  })

  test("reverse exclusive: `10...1` → 9 members [10..2]", () => {
    const { results, diagnostics } = run("10...1")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("10...1 (n=9)")
  })

  test("`1..1` inclusive → 1 member", () => {
    const { results } = run("1..1")
    expect(lastValue(results)).toBe("1..1 (n=1)")
  })

  test("`1...1` exclusive → 0 members", () => {
    const { results } = run("1...1")
    expect(lastValue(results)).toBe("1...1 (n=0)")
  })

  test("expression endpoints: `(1+1)..(2*5)`", () => {
    const { results, diagnostics } = run("(1 + 1)..(2 * 5)")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("2..10 (n=9)")
  })
})

describe("Range — aggregates via property access", () => {
  test("`1..10 r` then `r.count`", () => {
    const { results, diagnostics } = run("1..10 r\nr.count")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("10")
  })

  test("`r.sum` over `1..10` = 55", () => {
    const { results } = run("1..10 r\nr.sum")
    expect(lastValue(results)).toBe("55")
  })

  test("`r.avg` over `1..10` = 5.5", () => {
    const { results } = run("1..10 r\nr.avg")
    expect(lastValue(results)).toBe("5.5")
  })

  test("`r.min` and `r.max` over `1..10`", () => {
    expect(lastValue(run("1..10 r\nr.min").results)).toBe("1")
    expect(lastValue(run("1..10 r\nr.max").results)).toBe("10")
  })

  test("exclusive: `r.sum` over `1...10` = 45", () => {
    const { results } = run("1...10 r\nr.sum")
    expect(lastValue(results)).toBe("45")
  })

  test("reverse `r.sum` over `10..1` = 55 (same members, walked down)", () => {
    expect(lastValue(run("10..1 r\nr.sum").results)).toBe("55")
  })

  test("aggregates on inline parenthesized range: `(1..10).count`", () => {
    const { results, diagnostics } = run("(1..10).count")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("10")
  })

  test("aggregates on inline parenthesized range: `(1..10).sum`", () => {
    expect(lastValue(run("(1..10).sum").results)).toBe("55")
  })
})

describe("Range — RANGE keyword form", () => {
  test("`RANGE r 1 10` then `r.count`", () => {
    const { results, diagnostics } = run("RANGE r 1 10\nr.count")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("10")
  })

  test("RANGE with expression endpoints", () => {
    const { results } = run(
      ["RANGE r (1 + 2) (4 * 2)", "r.sum"].join("\n"),
    )
    // 3..8 inclusive = 3+4+5+6+7+8 = 33
    expect(lastValue(results)).toBe("33")
  })
})

describe("Range — bare ident returns the range value", () => {
  test("`r` alone returns the range, useful for echoing", () => {
    const { results } = run("1..5 r\nr")
    expect(lastValue(results)).toBe("1..5 (n=5)")
  })

  test("`myRange.sum + 1` works (aggregate is a quantity)", () => {
    const { results } = run("1..10 r\nr.sum + 1")
    expect(lastValue(results)).toBe("56")
  })
})

describe("Range — error paths", () => {
  test("unknown method `.frobnicate`", () => {
    const { diagnostics } = run("1..10 r\nr.frobnicate")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("has no '.frobnicate'")
  })

  test("aggregates on empty range error", () => {
    const { diagnostics } = run("1...1 r\nr.sum")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message.toLowerCase()).toContain("empty range")
  })

  test("`r.count` on empty range = 0", () => {
    const { results, diagnostics } = run("1...1 r\nr.count")
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("0")
  })

  test("dimension mismatch in range endpoints is diagnosed", () => {
    const src = ["UNIT Currency usd", "UNIT Mass kg", "1 usd..10 kg"].join(
      "\n",
    )
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message.toLowerCase()).toContain("convert")
  })

  test("duplicate range declaration is reported", () => {
    const { diagnostics } = run("1..10 r\n1..5 r")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("already declared")
  })

  test("name collision: variable then range", () => {
    const { diagnostics } = run("42 r\n1..10 r")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("already declared")
  })

  test("undefined range when used as ident — caught with hint", () => {
    const { diagnostics } = run("noSuchRange.sum")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message.toLowerCase()).toContain("undefined")
  })

  test("range too large", () => {
    const { diagnostics } = run("1..200000 r\nr.count")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message.toLowerCase()).toContain("too large")
  })

  test("non-range / non-series target for property access", () => {
    const { diagnostics } = run("42 x\nx.sum")
    expect(diagnostics.length).toBeGreaterThan(0)
  })
})

describe("Range — custom step (`/step`)", () => {
  test("`1..10/1` matches default behavior", () => {
    expect(lastValue(run("1..10/1 r\nr.count").results)).toBe("10")
    expect(lastValue(run("1..10/1 r\nr.sum").results)).toBe("55")
  })

  test("`1..10/3` → {1, 3, 6, 9} (sum 19)", () => {
    expect(lastValue(run("1..10/3 r\nr.count").results)).toBe("4")
    expect(lastValue(run("1..10/3 r\nr.sum").results)).toBe("19")
  })

  test("`1..10/5` → {1, 5, 10} (sum 16)", () => {
    expect(lastValue(run("1..10/5 r\nr.count").results)).toBe("3")
    expect(lastValue(run("1..10/5 r\nr.sum").results)).toBe("16")
  })

  test("`1..10/100` inclusive → {1} (start anchor only)", () => {
    expect(lastValue(run("1..10/100 r\nr.count").results)).toBe("1")
  })

  test("`1...10/100` exclusive → {} (start dropped, no inner multiples)", () => {
    expect(lastValue(run("1...10/100 r\nr.count").results)).toBe("0")
  })

  test("`10..1/1` reverse → {10, 9, …, 1}", () => {
    expect(lastValue(run("10..1/1 r\nr.count").results)).toBe("10")
    expect(lastValue(run("10..1/1 r\nr.sum").results)).toBe("55")
  })

  test("reverse with step: `10..1/3` → {10, 9, 6, 3} (start anchor + desc multiples)", () => {
    expect(lastValue(run("10..1/3 r\nr.count").results)).toBe("4")
    expect(lastValue(run("10..1/3 r\nr.sum").results)).toBe("28")
  })

  test("negative endpoints with step: `-3..3/3` → {-3, 0, 3}", () => {
    expect(lastValue(run("-3..3/3 r\nr.count").results)).toBe("3")
    expect(lastValue(run("-3..3/3 r\nr.sum").results)).toBe("0")
  })

  test("step as expression: `1..10/(1+2)` parses and evaluates", () => {
    expect(lastValue(run("1..10/(1 + 2) r\nr.count").results)).toBe("4")
  })

  test("step = 0 is a diagnostic", () => {
    const { diagnostics } = run("1..10/0 r\nr.count")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message.toLowerCase()).toContain("step")
  })

  test("negative step is a diagnostic", () => {
    const { diagnostics } = run("1..10/-2 r\nr.count")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message.toLowerCase()).toContain("step")
  })

  test("step with units: `1 usd..10 usd / 2`", () => {
    const src = ["UNIT Currency usd", "1 usd..10 usd / 2 r", "r.count"].join("\n")
    // anchor 1, multiples of 2 in (1, 10]: 2, 4, 6, 8, 10. Total 6.
    expect(lastValue(run(src).results)).toBe("6")
  })

  test("RANGE keyword + step (`RANGE r 1 10 3`)", () => {
    expect(lastValue(run("RANGE r 1 10 3\nr.count").results)).toBe("4")
    expect(lastValue(run("RANGE r 1 10 3\nr.sum").results)).toBe("19")
  })

  test("paren-forced division inside end: `1..(10/3)` → range(1, 3.33…)", () => {
    // No /step modifier; end is 10/3. snap step=1 from 1: anchor 1,
    // multiples of 1 in (1, 10/3]: 2, 3. Members = {1, 2, 3}.
    expect(lastValue(run("1..(10/3) r\nr.count").results)).toBe("3")
  })

  test("annotation shows /step when non-default", () => {
    expect(lastValue(run("1..10/3").results)).toBe("1..10/3 (n=4)")
  })

  test("annotation omits /step for default step 1", () => {
    expect(lastValue(run("1..10").results)).toBe("1..10 (n=10)")
  })
})

describe("Range — units", () => {
  test("`1 usd..10 usd` → 10 members in usd, sum 55 usd", () => {
    const src = ["UNIT Currency usd", "1 usd..10 usd r", "r.sum"].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("55 usd")
  })

  test("`r.count` and `r.min` / `r.max` carry the range unit", () => {
    const src = ["UNIT Currency usd", "1 usd..10 usd r"].join("\n")
    expect(lastValue(run(src + "\nr.count").results)).toBe("10")
    expect(lastValue(run(src + "\nr.min").results)).toBe("1 usd")
    expect(lastValue(run(src + "\nr.max").results)).toBe("10 usd")
  })

  test("dimensionless start promotes into end's unit (`1..5 usd r`)", () => {
    // Lexer-level: `5 usd r` is a SeriesMember-like form; in expression
    // context, parsePrimary picks up `5 usd` as Quantity(5, usd), then
    // `r` becomes the trailing range-decl name. So `1..5 usd r` decls
    // a range from 1 (dimensionless) to 5 usd, named r.
    const src = ["UNIT Currency usd", "1..5 usd r", "r.sum"].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("15 usd")
  })

  test("mixed-unit same dim: end's unit wins, start is converted", () => {
    // 100 rub = 100/90.5 ≈ 1.1050 usd. Snap step=1: anchor 1.1050, then
    // multiples of 1 in (1.105, 5]: 2, 3, 4, 5. Members = 5.
    const src = [
      "UNIT Currency usd",
      "UNIT (usd / 90,5) rub",
      "100 rub..5 usd r",
      "r.count",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("5")
  })

  test("reverse with units: `10 usd..1 usd` walks down → sum 55 usd", () => {
    const src = ["UNIT Currency usd", "10 usd..1 usd r", "r.sum"].join("\n")
    expect(lastValue(run(src).results)).toBe("55 usd")
  })

  test("exclusive with units: `1 usd...5 usd` → 4 members, sum 10 usd", () => {
    const src = ["UNIT Currency usd", "1 usd...5 usd r", "r.sum"].join("\n")
    expect(lastValue(run(src).results)).toBe("10 usd")
  })

  test("RANGE keyword with united endpoints", () => {
    const src = [
      "UNIT Currency usd",
      "RANGE r 1 usd 10 usd",
      "r.avg",
    ].join("\n")
    expect(lastValue(run(src).results)).toBe("5.5 usd")
  })

  test("bare range with units shows the unit in the annotation", () => {
    const src = ["UNIT Currency usd", "1 usd..3 usd"].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(lastValue(results)).toBe("1 usd..3 usd (n=3)")
  })
})

describe("Range — interactions with the rest of the language", () => {
  test("range can be referenced by name in another expression", () => {
    const src = ["1..10 r", "r.sum + r.count"].join("\n")
    expect(lastValue(run(src).results)).toBe("65")
  })

  test("range members feed into a function", () => {
    const src = [
      "FN double(x) x * 2",
      "1..3 r",
      "double(r.sum)",
    ].join("\n")
    expect(lastValue(run(src).results)).toBe("12") // (1+2+3)*2
  })

  test("assignment captures an aggregate of a range", () => {
    const src = ["1..10 r", "r.avg = mean", "mean"].join("\n")
    expect(lastValue(run(src).results)).toBe("5.5")
  })
})
