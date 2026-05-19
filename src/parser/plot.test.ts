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

describe("parsePlotDecl", () => {
  test("empty plot block", () => {
    const { program, diagnostics } = parse("PLOT pic\n")
    expect(diagnostics).toEqual([])
    expect(program.statements).toHaveLength(1)
    expect(showStatement(program.statements[0]!)).toBe("(plot pic)")
  })

  test("single LINE instruction", () => {
    const src = ["PLOT pic", "LINE 0 0 10 10"].join("\n")
    expect(show(src)).toBe("(plot pic (LINE 0 0 10 10))")
  })

  test("mix of geometric primitives", () => {
    const src = [
      "PLOT pic",
      "LINE 0 0 100 100",
      "RECT 10 10 30 20",
      "CIRCLE 50 50 15",
      "POINT 75 75",
    ].join("\n")
    expect(show(src)).toBe(
      "(plot pic (LINE 0 0 100 100) (RECT 10 10 30 20) (CIRCLE 50 50 15) (POINT 75 75))",
    )
  })

  test("turtle primitives", () => {
    const src = ["PLOT pic", "F 50", "R 90", "F 30", "L 45"].join("\n")
    expect(show(src)).toBe("(plot pic (F 50) (R 90) (F 30) (L 45))")
  })

  test("arguments can be parenthesized expressions", () => {
    // Top-level binary is disallowed in PLOT args (each arg is a primary).
    // Wrap arithmetic in parens to use it as a single arg.
    const src = ["PLOT pic", "LINE 0 0 (5 + 5) (10 * 2)"].join("\n")
    expect(show(src)).toBe("(plot pic (LINE 0 0 (add 5 5) (mul 10 2)))")
  })

  test("top-level binary in PLOT args is rejected — splits into separate args", () => {
    // `LINE 0 0 5 + 5 10 * 2` parses as 7 args (each token a primary), not 4.
    const src = ["PLOT pic", "LINE 0 0 5 + 5 10 * 2"].join("\n")
    const { diagnostics } = parse(src)
    // The parser itself is permissive (collects whatever); arity is checked
    // at eval. But `+` as a leading-arg unary is allowed, `*` is not.
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("blank line terminates the block", () => {
    const src = ["PLOT pic", "LINE 0 0 1 1", "", "100 + 200"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe("(plot pic (LINE 0 0 1 1))")
    expect(showStatement(program.statements[1]!)).toBe("(add 100 200)")
  })

  test("EOF terminates the block", () => {
    const src = "PLOT pic\nLINE 0 0 1 1\nCIRCLE 5 5 3"
    expect(show(src)).toBe("(plot pic (LINE 0 0 1 1) (CIRCLE 5 5 3))")
  })

  test("next top-level keyword terminates the block", () => {
    const src = ["PLOT a", "LINE 0 0 1 1", "PLOT b", "CIRCLE 5 5 3"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe("(plot a (LINE 0 0 1 1))")
    expect(showStatement(program.statements[1]!)).toBe("(plot b (CIRCLE 5 5 3))")
  })

  test("SERIES on next line terminates the plot", () => {
    const src = ["PLOT a", "LINE 0 0 1 1", "SERIES s", "1", "2"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[0]!)).toBe("(plot a (LINE 0 0 1 1))")
    expect(showStatement(program.statements[1]!)).toBe("(series s 1 2)")
  })

  test("references variables in args", () => {
    const src = ["10 cx", "PLOT pic", "CIRCLE cx cx 3"].join("\n")
    expect(show(src)).toBe("(var cx 10)\n(plot pic (CIRCLE cx cx 3))")
  })

  test("missing name on header is a diagnostic", () => {
    const { diagnostics } = parse("PLOT\n")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("one-liner form `PLOT name ref` produces a dataRef", () => {
    const src = ["SERIES prices", "100", "120", "", "PLOT chart prices"].join(
      "\n",
    )
    const { program, diagnostics } = parse(src)
    expect(diagnostics).toEqual([])
    expect(program.statements).toHaveLength(2)
    expect(showStatement(program.statements[1]!)).toBe(
      "(plot chart (data prices))",
    )
  })

  test("one-liner form is single-line — next non-newline starts a new stmt", () => {
    const src = ["RANGE r 1 5", "PLOT chart r", "100 + 1"].join("\n")
    const { program, diagnostics } = parse(src)
    expect(diagnostics).toEqual([])
    expect(program.statements).toHaveLength(3)
    expect(showStatement(program.statements[1]!)).toBe(
      "(plot chart (data r))",
    )
  })
})
