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

describe("function calls — dimensionless", () => {
  test("simple one-arg", () => {
    const src = "FN double(x) x * 2\ndouble(7)"
    expect(lastValue(run(src).results)).toBe("14")
  })

  test("no-arg constant", () => {
    const src = "FN pi() 3,14159265\npi()"
    expect(lastValue(run(src).results)).toBe("3.14159265")
  })

  test("two-arg arithmetic", () => {
    const src = "FN avg2(a, b) (a + b) / 2\navg2(10, 30)"
    expect(lastValue(run(src).results)).toBe("20")
  })

  test("forward reference: call before declaration (functions collected in pass 1)", () => {
    const src = ["use(5)", "FN use(x) x * 10"].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    // The first statement is the call — assert directly, since the last
    // statement is the (value-less) FN decl.
    const r = results[0]!
    expect(r.value && isQuantity(r.value) ? r.value.value.toString() : "").toBe("50")
  })

  test("body references a global variable", () => {
    const src = ["10 tax\nFN withTax(x) x + tax\nwithTax(100)"].join("\n")
    expect(lastValue(run(src).results)).toBe("110")
  })

  test("local param shadows a same-named global var", () => {
    const src = ["99 x\nFN id(x) x\nid(7)"].join("\n")
    expect(lastValue(run(src).results)).toBe("7")
  })
})

describe("function calls — with units", () => {
  test("kinetic energy: m * v^2 / 2", () => {
    const src = [
      "UNIT Mass kg",
      "UNIT Length m",
      "UNIT Time s",
      "FN kinetic(m, v) m * v ^ 2 / 2",
      // `10 m / s` reads as (10 m) / s which is the same quantity as
      // `10 m/s`. Composite unit literals in arbitrary expression
      // position aren't part of MVP primary syntax — only in var_decl.
      "kinetic(70 kg, 10 m / s)",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    // 70 * 10^2 / 2 = 3500. Composite unit kg·m^2/s^2.
    const r = results[results.length - 1]!
    expect(r.value && isQuantity(r.value) && r.value.unit?.name).toBe(
      "kg·m^2/s^2",
    )
    expect(
      r.value && isQuantity(r.value) ? r.value.value.toString() : "",
    ).toBe("3500")
  })

  test("function arg can be a unit-bearing quantity", () => {
    const src = [
      "UNIT Mass kg",
      "FN doubled(x) x * 2",
      "doubled(35 kg)",
    ].join("\n")
    expect(lastValue(run(src).results)).toBe("70 kg")
  })

  test("local param shadows a unit name", () => {
    const src = ["UNIT Mass m", "FN id(m) m", "id(42)"].join("\n")
    // Inside the body, `m` is the param (42), not the unit. So id(42) = 42.
    expect(lastValue(run(src).results)).toBe("42")
  })
})

describe("function errors", () => {
  test("undefined function", () => {
    const { diagnostics } = run("nope(1)")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("undefined function")
  })

  test("variable used as a function", () => {
    const src = "10 x\nx(1)"
    const { diagnostics } = run(src)
    expect(diagnostics[0]?.message).toContain("variable, not a function")
  })

  test("unit used as a function", () => {
    const src = "UNIT Mass kg\nkg(1)"
    const { diagnostics } = run(src)
    expect(diagnostics[0]?.message).toContain("unit, not a function")
  })

  test("arity too few", () => {
    const src = "FN add3(a, b, c) a + b + c\nadd3(1, 2)"
    const { diagnostics } = run(src)
    expect(diagnostics[0]?.message).toContain("expects 3 arguments, got 2")
  })

  test("arity too many", () => {
    const src = "FN id(x) x\nid(1, 2, 3)"
    const { diagnostics } = run(src)
    expect(diagnostics[0]?.message).toContain("expects 1 argument, got 3")
  })

  test("bare function reference (no parens) is a targeted error", () => {
    const src = "FN double(x) x * 2\ndouble + 1"
    const { diagnostics } = run(src)
    expect(diagnostics[0]?.message).toContain("is a function")
  })

  test("duplicate function declaration", () => {
    const src = "FN foo(x) x\nFN foo(y) y * 2"
    const { diagnostics } = run(src)
    expect(diagnostics[0]?.message).toContain("already declared")
  })
})

describe("recursion", () => {
  test("factorial", () => {
    const src = [
      "FN fact(n) if n < 2 then 1 else n * fact(n - 1)",
      "fact(5)",
    ].join("\n")
    expect(lastValue(run(src).results)).toBe("120")
  })

  test("fibonacci (small)", () => {
    const src = [
      "FN fib(n) if n < 2 then n else fib(n - 1) + fib(n - 2)",
      "fib(8)",
    ].join("\n")
    expect(lastValue(run(src).results)).toBe("21")
  })
})

describe("composing with series", () => {
  test("FN can read from a series via property access", () => {
    const src = [
      "SERIES nums",
      "10",
      "20",
      "30",
      "",
      "FN scaled(k) nums.sum * k",
      "scaled(2)",
    ].join("\n")
    expect(lastValue(run(src).results)).toBe("120")
  })
})
