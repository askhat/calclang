import { describe, expect, test } from "bun:test"
import Decimal from "decimal.js"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"
import { evaluateProgram } from "../eval/evaluator.ts"
import {
  annotateSource,
  formatDecimal,
  formatDiagnosticColored,
  formatQuantity,
  formatValue,
  replLine,
} from "./output.ts"
import { makeNamedUnit } from "../units/unit.ts"
import type { RunResult } from "../eval/evaluator.ts"

const kg = makeNamedUnit("kg", { mass: 1 }, new Decimal(1))

describe("formatDecimal", () => {
  test("default locale uses comma + space thousands", () => {
    expect(formatDecimal(new Decimal("3.14159265358979"))).toBe("3,141593")
  })

  test("dot locale + comma thousands", () => {
    expect(
      formatDecimal(new Decimal("1234567.89"), {
        decimalSeparator: ".",
        thousandsSeparator: ",",
      }),
    ).toBe("1,234,567.89")
  })

  test("trims to 6 places (rounded)", () => {
    expect(formatDecimal(new Decimal("1.1234567"))).toBe("1,123457")
  })

  test("integer with thousands separator (default = space)", () => {
    expect(formatDecimal(new Decimal(1234567))).toBe("1 234 567")
  })

  test("disabling thousands separator", () => {
    expect(
      formatDecimal(new Decimal(1234567), {
        decimalSeparator: ",",
        thousandsSeparator: "",
      }),
    ).toBe("1234567")
  })

  test("decimal with thousands separator on the integer part only", () => {
    expect(formatDecimal(new Decimal("1234567.89"))).toBe("1 234 567,89")
  })

  test("negative with thousands", () => {
    expect(formatDecimal(new Decimal("-12345.67"))).toBe("-12 345,67")
  })

  test("3-digit numbers don't get a leading separator", () => {
    expect(formatDecimal(new Decimal(999))).toBe("999")
  })

  test("4 digits get one separator", () => {
    expect(formatDecimal(new Decimal(1000))).toBe("1 000")
  })
})

describe("formatQuantity", () => {
  test("dimensionless", () => {
    expect(formatQuantity({ value: new Decimal(42), unit: null })).toBe("42")
  })

  test("with unit", () => {
    expect(formatQuantity({ value: new Decimal("25.5"), unit: kg })).toBe(
      "25,5 kg",
    )
  })
})

describe("formatValue", () => {
  test("boolean true", () => {
    expect(formatValue(true)).toBe("true")
  })

  test("boolean false", () => {
    expect(formatValue(false)).toBe("false")
  })

  test("quantity", () => {
    expect(formatValue({ value: new Decimal(5), unit: kg })).toBe("5 kg")
  })

  test("percent renders as N% (fraction × 100)", () => {
    expect(formatValue({ kind: "percent", value: new Decimal("0.2") })).toBe(
      "20%",
    )
  })

  test("percent with fractional display", () => {
    expect(
      formatValue({ kind: "percent", value: new Decimal("0.125") }),
    ).toBe("12,5%")
  })

  test("negative percent", () => {
    expect(formatValue({ kind: "percent", value: new Decimal("-0.05") })).toBe(
      "-5%",
    )
  })
})

describe("annotateSource (end-to-end)", () => {
  function evalAndAnnotate(src: string) {
    const { tokens } = tokenize(src)
    const { program } = parseProgram(tokens)
    const { results } = evaluateProgram(program)
    return annotateSource(src, results)
  }

  test("bare expression gets '// = value' annotation", () => {
    const out = evalAndAnnotate("1 + 2 * 3")
    expect(out).toContain("// = 7")
  })

  test("declarations get no annotation", () => {
    const out = evalAndAnnotate(
      ["UNIT Mass kg", "5 kg flour"].join("\n"),
    )
    const lines = out.split("\n")
    expect(lines[0]).toBe("UNIT Mass kg") // unchanged
    expect(lines[1]).toContain("// = 5 kg") // variableDecl gets annotation
  })

  test("comment-only lines are preserved", () => {
    const out = evalAndAnnotate(["# header", "1 + 1"].join("\n"))
    const lines = out.split("\n")
    expect(lines[0]).toBe("# header")
    expect(lines[1]).toContain("// = 2")
  })

  test("blank lines preserved", () => {
    const out = evalAndAnnotate(["1", "", "2"].join("\n"))
    const lines = out.split("\n")
    expect(lines[1]).toBe("")
  })

  test("budget.calc end-to-end annotation contains expected results", async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../../examples/budget.calc`,
    ).text()
    const out = evalAndAnnotate(src)
    expect(out).toContain("// = 25,5 rub")
    expect(out).toContain("// = 183") // salaryInKzt ~= 183.28
    expect(out).toContain("usd") // 100 rub + 5 usd → in usd
  })

  test("errors render as '// error: …'", () => {
    const out = evalAndAnnotate("undeclared + 1")
    expect(out).toContain("// error:")
    expect(out).toContain("undefined name 'undeclared'")
  })
})

describe("replLine", () => {
  function evalOne(src: string): RunResult {
    const { tokens } = tokenize(src)
    const { program } = parseProgram(tokens)
    const { results } = evaluateProgram(program)
    return results[0]!
  }

  test("bare expression: '= value'", () => {
    expect(replLine(evalOne("1 + 2"))).toBe("= 3")
  })

  test("variable declaration: '= value'", () => {
    expect(replLine(evalOne("42 answer"))).toBe("= 42")
  })

  test("unit declaration: no line", () => {
    expect(replLine(evalOne("UNIT Mass kg"))).toBeNull()
  })

  test("error: 'error: ...'", () => {
    const r = evalOne("undefined + 1")
    expect(replLine(r)).toContain("error:")
    expect(replLine(r)).toContain("undefined name")
  })
})

describe("formatDiagnosticColored", () => {
  // Color codes are stripped in test environment (no TTY), so we check
  // the textual content directly.
  test("includes location, severity, and message", () => {
    const out = formatDiagnosticColored(
      { severity: "error", message: "boom", line: 3, col: 7 },
      "foo.calc",
    )
    expect(out).toContain("foo.calc:3:7:")
    expect(out).toContain("error:")
    expect(out).toContain("boom")
  })

  test("includes hint when present", () => {
    const out = formatDiagnosticColored(
      {
        severity: "error",
        message: "bad",
        line: 1,
        col: 1,
        hint: "do better",
      },
      "x.calc",
    )
    expect(out).toContain("hint:")
    expect(out).toContain("do better")
  })
})
