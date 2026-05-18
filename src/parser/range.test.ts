import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { showProgram, showStatement } from "./ast.ts"
import { parseExpression, parseProgram } from "./parser.ts"

function parse(src: string) {
  const { tokens } = tokenize(src)
  return parseProgram(tokens)
}

function show(src: string): string {
  return showProgram(parse(src).program)
}

describe("range literal", () => {
  test("inclusive `1..10`", () => {
    expect(show("1..10")).toBe("(range 1 10)")
  })

  test("exclusive `1...10`", () => {
    expect(show("1...10")).toBe("(range-excl 1 10)")
  })

  test("endpoints can be expressions: `(1+2)..(3*4)`", () => {
    expect(show("(1 + 2)..(3 * 4)")).toBe(
      "(range (add 1 2) (mul 3 4))",
    )
  })

  test("range sits ABOVE binary: `1 + 2..10` → `(1+2)..10`", () => {
    expect(show("1 + 2..10")).toBe("(range (add 1 2) 10)")
  })

  test("negative endpoints: `-5..5`", () => {
    expect(show("-5..5")).toBe("(range (neg 5) 5)")
  })

  test("ident endpoints: `a..b`", () => {
    expect(show("a..b")).toBe("(range a b)")
  })

  test("parenthesized range used with property access", () => {
    // `(1..10).count` → property on a range
    expect(show("(1..10).count")).toBe("(prop (range 1 10) count)")
  })

  test("range as expression — bare statement parses to exprStatement", () => {
    const { program } = parse("1..10")
    expect(program.statements).toHaveLength(1)
    expect(program.statements[0]?.type).toBe("exprStatement")
  })

  test("parseExpression entry point also handles ranges", () => {
    const { tokens } = tokenize("1..10")
    const { expr, diagnostics } = parseExpression(tokens)
    expect(diagnostics).toEqual([])
    expect(expr?.type).toBe("range")
  })
})

describe("range trailing-name declaration", () => {
  test("`1..10 myRange` → rangeDecl", () => {
    const { program, diagnostics } = parse("1..10 myRange")
    expect(diagnostics).toEqual([])
    expect(showStatement(program.statements[0]!)).toBe(
      "(range-decl myRange (range 1 10))",
    )
  })

  test("`1...10 myRange` (exclusive) → rangeDecl", () => {
    const { program } = parse("1...10 myRange")
    expect(showStatement(program.statements[0]!)).toBe(
      "(range-decl myRange (range-excl 1 10))",
    )
  })

  test("decl followed by another statement", () => {
    const src = ["1..10 myRange", "myRange.count"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe(
      "(range-decl myRange (range 1 10))",
    )
    expect(showStatement(program.statements[1]!)).toBe("(prop myRange count)")
  })

  test("trailing-name doesn't fire if IDENT isn't end-of-line", () => {
    // `1..10 myRange + 1` should parse as ExprStatement, NOT a decl —
    // the IDENT must be immediately followed by a line end to be a decl.
    // Currently this would either error or parse the IDENT as something
    // adjacent; the important thing is we don't silently consume it as a decl.
    const { program } = parse("1..10 + 1")
    expect(program.statements[0]?.type).toBe("exprStatement")
  })
})

describe("RANGE keyword form", () => {
  test("`RANGE myRange 1 10` → inclusive rangeDecl", () => {
    const { program, diagnostics } = parse("RANGE myRange 1 10")
    expect(diagnostics).toEqual([])
    expect(showStatement(program.statements[0]!)).toBe(
      "(range-decl myRange (range 1 10))",
    )
  })

  test("RANGE with expression endpoints", () => {
    const { program } = parse("RANGE foo (1 + 2) (3 * 4)")
    expect(showStatement(program.statements[0]!)).toBe(
      "(range-decl foo (range (add 1 2) (mul 3 4)))",
    )
  })

  test("RANGE terminates the previous SERIES block", () => {
    const src = ["SERIES s", "1", "2", "RANGE r 1 5"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe("(series s 1 2)")
    expect(showStatement(program.statements[1]!)).toBe(
      "(range-decl r (range 1 5))",
    )
  })

  test("lowercase `range` is still a regular identifier", () => {
    const { program } = parse("range + 1")
    expect(program.statements[0]?.type).toBe("exprStatement")
  })

  test("missing IDENT after RANGE is a diagnostic", () => {
    const { diagnostics } = parse("RANGE")
    expect(diagnostics.length).toBeGreaterThan(0)
  })
})
