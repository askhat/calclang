import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { showProgram, showStatement } from "./ast.ts"
import { parseProgram } from "./parser.ts"

function parse(src: string) {
  const { tokens } = tokenize(src)
  return parseProgram(tokens)
}

function show(src: string): string {
  return showProgram(parse(src).program)
}

describe("parseSeriesDecl", () => {
  test("basic series with numeric members", () => {
    const src = ["SERIES foo", "100", "20", "222", ""].join("\n")
    expect(show(src)).toBe("(series foo 100 20 222)")
  })

  test("blank line terminates the series", () => {
    const src = ["SERIES foo", "1", "2", "", "100 + 200"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe("(series foo 1 2)")
    expect(showStatement(program.statements[1]!)).toBe("(add 100 200)")
  })

  test("EOF terminates the series", () => {
    const src = "SERIES foo\n1\n2\n3"
    expect(show(src)).toBe("(series foo 1 2 3)")
  })

  test("UNIT keyword on next line terminates the series", () => {
    const src = ["SERIES foo", "1", "2", "UNIT Mass kg"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe("(series foo 1 2)")
    expect(showStatement(program.statements[1]!)).toBe("(unit kg Mass)")
  })

  test("SERIES on next line terminates the previous series", () => {
    const src = ["SERIES a", "1", "SERIES b", "2"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe("(series a 1)")
    expect(showStatement(program.statements[1]!)).toBe("(series b 2)")
  })

  test("members can be expressions, not just literals", () => {
    const src = ["SERIES foo", "1 + 2", "10 * 3", "-5"].join("\n")
    expect(show(src)).toBe("(series foo (add 1 2) (mul 10 3) (neg 5))")
  })

  test("empty series (header followed by blank line)", () => {
    expect(show("SERIES foo\n\nrest")).toBe(
      "(series foo)\nrest",
    )
  })

  test("missing header IDENT is a diagnostic", () => {
    const { diagnostics } = parse("SERIES")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("lowercase 'series' is a regular identifier, not a header", () => {
    const { program } = parse("series + 1")
    // 'series' is just an ident here → ExprStatement(add)
    expect(program.statements).toHaveLength(1)
    expect(program.statements[0]?.type).toBe("exprStatement")
  })
})

describe("property access", () => {
  test("simple dot", () => {
    const { program } = parse("foo.sum")
    expect(showStatement(program.statements[0]!)).toBe("(prop foo sum)")
  })

  test("chained dots", () => {
    const { program } = parse("a.b.c")
    expect(showStatement(program.statements[0]!)).toBe(
      "(prop (prop a b) c)",
    )
  })

  test("on a parenthesized expression", () => {
    const { program } = parse("(1 + 2).bar")
    expect(showStatement(program.statements[0]!)).toBe(
      "(prop (add 1 2) bar)",
    )
  })

  test("binds tighter than 'as'", () => {
    // foo.sum as kzt → (as (prop foo sum) kzt)
    const src = "UNIT Currency kzt\nfoo.sum as kzt"
    const { program } = parse(src)
    // Last statement is the conversion
    const last = program.statements[program.statements.length - 1]!
    expect(showStatement(last)).toBe("(as (prop foo sum) kzt)")
  })

  test("binds tighter than '+'", () => {
    // foo.sum + 1 → (add (prop foo sum) 1)
    const { program } = parse("foo.sum + 1")
    expect(showStatement(program.statements[0]!)).toBe(
      "(add (prop foo sum) 1)",
    )
  })

  test("missing property name after dot is a diagnostic", () => {
    const { diagnostics } = parse("foo.")
    expect(diagnostics.length).toBeGreaterThan(0)
  })
})
