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

describe("parseFunctionDecl", () => {
  test("no-arg function", () => {
    expect(show("FN pi() 3,14159")).toBe("(fn pi () 3.14159)")
  })

  test("one-arg function", () => {
    expect(show("FN double(x) x * 2")).toBe("(fn double (x) (mul x 2))")
  })

  test("multi-arg function with arithmetic body", () => {
    expect(show("FN kinetic(m, v) m * v ^ 2 / 2")).toBe(
      "(fn kinetic (m v) (div (mul m (pow v 2)) 2))",
    )
  })

  test("body can be a parenthesized expression", () => {
    expect(show("FN avg2(a, b) (a + b) / 2")).toBe(
      "(fn avg2 (a b) (div (add a b) 2))",
    )
  })

  test("body can reference other identifiers (globals)", () => {
    expect(show("FN withTax(x) x * 1,2")).toBe(
      "(fn withTax (x) (mul x 1.2))",
    )
  })

  test("missing name reports a diagnostic", () => {
    const { diagnostics } = parse("FN")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("missing '(' reports a diagnostic", () => {
    const { diagnostics } = parse("FN foo")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("missing ')' reports a diagnostic", () => {
    const { diagnostics } = parse("FN foo(x")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("FN on next line terminates the previous block-style statement", () => {
    const src = ["SERIES s", "1", "FN add(a, b) a + b"].join("\n")
    const { program } = parse(src)
    expect(program.statements).toHaveLength(2)
    expect(program.statements[0]?.type).toBe("seriesDecl")
    expect(program.statements[1]?.type).toBe("functionDecl")
  })

  test("lowercase 'fn' is a regular identifier", () => {
    // 'fn' isn't a keyword (FN is). This should parse as an ident
    // reference (which produces "undefined name" at eval time).
    const { program } = parse("fn + 1")
    expect(program.statements).toHaveLength(1)
    expect(program.statements[0]?.type).toBe("exprStatement")
  })
})

describe("function call parsing", () => {
  test("zero-args", () => {
    const { program } = parse("pi()")
    expect(showStatement(program.statements[0]!)).toBe("(call pi)")
  })

  test("one arg", () => {
    const { program } = parse("double(7)")
    expect(showStatement(program.statements[0]!)).toBe("(call double 7)")
  })

  test("multiple args", () => {
    const { program } = parse("kinetic(70, 10)")
    expect(showStatement(program.statements[0]!)).toBe(
      "(call kinetic 70 10)",
    )
  })

  test("args can be expressions", () => {
    const { program } = parse("kinetic(70 + 1, 10 * 2)")
    expect(showStatement(program.statements[0]!)).toBe(
      "(call kinetic (add 70 1) (mul 10 2))",
    )
  })

  test("nested calls", () => {
    const { program } = parse("f(g(h(1)))")
    expect(showStatement(program.statements[0]!)).toBe(
      "(call f (call g (call h 1)))",
    )
  })

  test("call in arithmetic", () => {
    const { program } = parse("double(5) + 1")
    expect(showStatement(program.statements[0]!)).toBe(
      "(add (call double 5) 1)",
    )
  })

  test("call result with .property (property binds tighter than calls? actually equal)", () => {
    // foo(1).bar — call first, then property
    const { program } = parse("foo(1).bar")
    expect(showStatement(program.statements[0]!)).toBe(
      "(prop (call foo 1) bar)",
    )
  })

  test("'35,5' (one number) vs '35, 5' (two args)", () => {
    const a = parse("f(35,5)").program
    expect(showStatement(a.statements[0]!)).toBe("(call f 35.5)")
    const b = parse("f(35, 5)").program
    expect(showStatement(b.statements[0]!)).toBe("(call f 35 5)")
  })
})
