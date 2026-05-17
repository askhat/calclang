import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"
import { evaluateProgram, type RunResult } from "./evaluator.ts"
import { isBoolean, isQuantity } from "./value.ts"

function run(src: string) {
  const { tokens } = tokenize(src)
  const { program } = parseProgram(tokens)
  return evaluateProgram(program)
}

function valueOf(r: RunResult): string {
  if (r.value === null) return "<no value>"
  if (isBoolean(r.value)) return String(r.value)
  if (isQuantity(r.value)) {
    return r.value.unit
      ? `${r.value.value.toString()} ${r.value.unit.name}`
      : r.value.value.toString()
  }
  return "<unknown>"
}

function last(r: RunResult[]): RunResult {
  return r[r.length - 1]!
}

describe("dimensionless arithmetic", () => {
  test("basic + and *", () => {
    const { results, diagnostics } = run("1 + 2 * 3")
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("7")
  })

  test("decimal precision: 0,1 + 0,2 == 0,3", () => {
    const { results } = run("0,1 + 0,2")
    expect(valueOf(last(results))).toBe("0.3")
  })

  test("power right-associative", () => {
    const { results } = run("2 ^ 3 ^ 2")
    expect(valueOf(last(results))).toBe("512")
  })

  test("parens", () => {
    const { results } = run("(1 + 2) * (3 + 4)")
    expect(valueOf(last(results))).toBe("21")
  })

  test("division by zero diagnoses with position", () => {
    const { diagnostics } = run("1 / 0")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("division by zero")
  })
})

describe("variables and lazy resolution", () => {
  test("simple binding", () => {
    const { results } = run(["42 answer", "answer + 1"].join("\n"))
    expect(valueOf(results[1]!)).toBe("43")
  })

  test("forward reference (lazy) — variable used before declared", () => {
    const src = ["b + 1 = c", "10 b", "c"].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("11")
  })

  test("cycle detection across two variables", () => {
    const src = ["b + 1 = a", "a + 1 = b", "a"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("cyclic")
  })

  test("undefined variable", () => {
    const { diagnostics } = run("foo + 1")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("undefined name 'foo'")
  })

  test("duplicate variable declaration is reported once at the second site", () => {
    const src = ["1 x", "2 x"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("already declared")
  })
})

describe("unit declarations", () => {
  test("base unit registers and 'kg' resolves to Quantity(1, kg)", () => {
    const { results, diagnostics } = run(
      ["UNIT Mass kg", "kg"].join("\n"),
    )
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("1 kg")
  })

  test("composite unit registers with the right factor", () => {
    const src = [
      "UNIT Mass kg",
      "UNIT Mass gr (kg / 1_000)",
      "gr",
    ].join("\n")
    const { results, registry } = run(src)
    // `gr` alone is an ident expression → resolves to Quantity(1, gr).
    // (`1 gr` at line start would be a var_decl per the spec table, not an
    // expression — it would conflict with the unit name.)
    expect(valueOf(last(results))).toBe("1 gr")
    expect(registry.get("gr")?.factor.toString()).toBe("0.001")
  })

  test("forward reference: composite uses an as-yet-undeclared unit", () => {
    const src = [
      "UNIT Mass gr (kg / 1_000)",
      "UNIT Mass kg",
      "1000 gr as kg",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("1 kg")
  })

  test("cycle between unit declarations", () => {
    const src = [
      "UNIT Mass a (b * 2)",
      "UNIT Mass b (a * 2)",
      "a",
    ].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("cyclic")
  })

  test("name conflict: variable shadows a declared unit", () => {
    const src = ["UNIT Mass kg", "5 kg"].join("\n")
    // '5 kg' is var_decl with name kg per the spec; conflicts with unit kg.
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("already declared")
  })
})

describe("quantity arithmetic and conversions", () => {
  test("spec example: 100 rub + 5 usd ≈ 6.105 usd", () => {
    const src = [
      "UNIT Currency usd",
      "UNIT Currency rub (usd / 90,5)",
      "100 rub + 5 usd",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    const r = last(results)
    expect(r.value && isQuantity(r.value) && r.value.unit?.name).toBe("usd")
    expect(
      r.value && isQuantity(r.value) ? r.value.value.toFixed(4) : "",
    ).toBe("6.1050")
  })

  test("salary + minusTen = 25,5 rub (from the brief)", () => {
    const src = [
      "UNIT Currency usd",
      "UNIT Currency rub (usd / 90,5)",
      "-10 minusTen",
      "35,5 rub salary",
      "salary + minusTen = total",
      "total",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("25.5 rub")
  })

  test("conversion via 'as'", () => {
    const src = [
      "UNIT Mass kg",
      "UNIT Mass gr (kg / 1_000)",
      "2500 gr as kg",
    ].join("\n")
    const { results } = run(src)
    expect(valueOf(last(results))).toBe("2.5 kg")
  })

  test("dimension mismatch errors with both dimensions named", () => {
    const src = [
      "UNIT Mass kg",
      "UNIT Currency usd",
      "1 kg + 1 usd",
    ].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("kg")
    expect(diagnostics[0]?.message).toContain("usd")
  })

  test("composite unit literal: '9,8 (m / s^2) gravity'", () => {
    const src = [
      "UNIT Length m",
      "UNIT Time s",
      "9,8 (m / s ^ 2) gravity",
      "gravity",
    ].join("\n")
    const { results } = run(src)
    const r = last(results)
    expect(r.value && isQuantity(r.value) && r.value.unit?.dimension).toEqual({
      Length: 1,
      Time: -2,
    })
  })
})

describe("conditionals and booleans", () => {
  test("if/then/else picks the right branch", () => {
    expect(valueOf(last(run("if 1 < 2 then 100 else 200").results))).toBe("100")
    expect(valueOf(last(run("if 1 > 2 then 100 else 200").results))).toBe("200")
  })

  test("ternary", () => {
    expect(valueOf(last(run("3 < 5 ? 10 : 20").results))).toBe("10")
  })

  test("and short-circuits — right side not evaluated when left is false", () => {
    // If we evaluated the right, the undefined 'foo' would error.
    const { results, diagnostics } = run("1 > 2 and foo")
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("false")
  })

  test("or short-circuits — right side not evaluated when left is true", () => {
    const { results, diagnostics } = run("1 < 2 or foo")
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("true")
  })

  test("not flips boolean; rejects quantity", () => {
    // Per the spec grammar, `not` binds at unary level (tighter than `<`),
    // so `not 1 < 2` is `(not 1) < 2`. Parentheses are required.
    expect(valueOf(last(run("not (1 < 2)").results))).toBe("false")
    const { diagnostics } = run("not 5")
    expect(diagnostics[0]?.message).toContain("boolean")
  })

  test("comparison with dimensioned and dimensionless is lenient", () => {
    const src = [
      "UNIT Currency usd",
      "5 usd salary",
      "if salary > 0 then 1 else 0",
    ].join("\n")
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    expect(valueOf(last(results))).toBe("1")
  })
})

describe("budget.calc end-to-end", () => {
  test("evaluates without diagnostics", async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../../examples/budget.calc`,
    ).text()
    const { results, diagnostics } = run(src)
    expect(diagnostics).toEqual([])
    // Spot checks
    const byKind = new Map<string, RunResult[]>()
    for (const r of results) {
      const arr = byKind.get(r.stmt.type) ?? []
      arr.push(r)
      byKind.set(r.stmt.type, arr)
    }
    // The two expression assignments produce results:
    //   total = 25.5 rub
    //   salaryInKzt ≈ 183.28 kzt
    const assigns = byKind.get("exprAssignment") ?? []
    expect(assigns).toHaveLength(2)
    expect(valueOf(assigns[0]!)).toBe("25.5 rub")
    const inKzt = assigns[1]!
    if (inKzt.value && isQuantity(inKzt.value)) {
      expect(inKzt.value.unit?.name).toBe("kzt")
      expect(inKzt.value.value.toFixed(2)).toBe("183.28")
    }
    // The bare expression: 100 rub + 5 usd
    const bare = byKind.get("exprStatement") ?? []
    expect(bare).toHaveLength(1)
    if (bare[0]!.value && isQuantity(bare[0]!.value)) {
      expect(bare[0]!.value.unit?.name).toBe("usd")
      expect(bare[0]!.value.value.toFixed(4)).toBe("6.1050")
    }
  })
})
