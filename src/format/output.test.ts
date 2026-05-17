import { describe, expect, test } from "bun:test"
import Decimal from "decimal.js"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"
import { evaluateProgram } from "../eval/evaluator.ts"
import {
  annotateSource,
  formatDecimal,
  formatQuantity,
  formatValue,
} from "./output.ts"
import type { Unit } from "../units/unit.ts"

const kg: Unit = {
  name: "kg",
  dimension: { mass: 1 },
  factor: new Decimal(1),
}

describe("formatDecimal", () => {
  test("default locale uses comma", () => {
    expect(formatDecimal(new Decimal("3.14159265358979"))).toBe("3,141593")
  })

  test("dot locale uses dot", () => {
    expect(
      formatDecimal(new Decimal("3.14"), { decimalSeparator: "." }),
    ).toBe("3.14")
  })

  test("trims to 6 places (rounded)", () => {
    expect(formatDecimal(new Decimal("1.1234567"))).toBe("1,123457")
  })

  test("integer renders without separator", () => {
    expect(formatDecimal(new Decimal(42))).toBe("42")
  })

  test("negative", () => {
    expect(formatDecimal(new Decimal("-10.5"))).toBe("-10,5")
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
      ["declare kg base mass", "5 kg flour"].join("\n"),
    )
    const lines = out.split("\n")
    expect(lines[0]).toBe("declare kg base mass") // unchanged
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
