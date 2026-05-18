import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { showExpr } from "./ast.ts"
import { parseExpression } from "./parser.ts"

function show(src: string): string {
  const { tokens } = tokenize(src)
  const { expr } = parseExpression(tokens)
  if (!expr) throw new Error(`failed to parse: ${src}`)
  return showExpr(expr)
}

describe("percent postfix", () => {
  test("bare N%", () => {
    expect(show("20%")).toBe("(percent 20)")
  })

  test("space between number and %", () => {
    expect(show("20 %")).toBe("(percent 20)")
  })

  test("percent on identifier", () => {
    expect(show("rate%")).toBe("(percent rate)")
  })

  test("percent on parenthesized expression", () => {
    expect(show("(1 + 2)%")).toBe("(percent (add 1 2))")
  })

  test("percent binds tighter than additive", () => {
    expect(show("100 + 20%")).toBe("(add 100 (percent 20))")
  })

  test("percent binds tighter than power on the base side", () => {
    // `5%^2` = `(5%)^2`. To pow the inner, write `(5^2)%`.
    expect(show("5%^2")).toBe("(pow (percent 5) 2)")
  })

  test("chained % is allowed by the parser; eval rejects it", () => {
    expect(show("5%%")).toBe("(percent (percent 5))")
  })
})

describe("'of' as a binary operator", () => {
  test("basic `N% of M`", () => {
    expect(show("20% of 1000")).toBe("(of (percent 20) 1000)")
  })

  test("`of` has multiplicative precedence (tighter than +/-)", () => {
    expect(show("100 - 20% of 1000")).toBe(
      "(sub 100 (of (percent 20) 1000))",
    )
  })

  test("`of` left-associative at level of */", () => {
    // 2 * 3 of 4 → ((2*3) of 4)
    expect(show("2 * 3 of 4")).toBe("(of (mul 2 3) 4)")
  })

  test("nested `of`: left-assoc — `a of b of c` = `(a of b) of c`", () => {
    expect(show("20% of 30% of 100")).toBe(
      "(of (of (percent 20) (percent 30)) 100)",
    )
  })
})
