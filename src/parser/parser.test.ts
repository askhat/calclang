import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { showExpr } from "./ast.ts"
import { parseExpression } from "./parser.ts"

function parse(src: string) {
  const { tokens } = tokenize(src)
  return parseExpression(tokens)
}

function show(src: string): string {
  const { expr } = parse(src)
  if (!expr) throw new Error(`failed to parse: ${src}`)
  return showExpr(expr)
}

describe("primaries", () => {
  test("integer", () => {
    expect(show("42")).toBe("42")
  })

  test("decimal preserves precision", () => {
    expect(show("467,245543")).toBe("467.245543")
  })

  test("identifier", () => {
    expect(show("salary")).toBe("salary")
  })

  test("parens", () => {
    expect(show("(1)")).toBe("1")
    expect(show("((42))")).toBe("42")
  })

  test("leading and trailing newlines are skipped", () => {
    expect(show("\n\n42\n\n")).toBe("42")
  })
})

describe("arithmetic precedence", () => {
  test("addition is left-associative", () => {
    expect(show("1 + 2 + 3")).toBe("(add (add 1 2) 3)")
  })

  test("subtraction is left-associative", () => {
    expect(show("10 - 3 - 2")).toBe("(sub (sub 10 3) 2)")
  })

  test("* binds tighter than +", () => {
    expect(show("1 + 2 * 3")).toBe("(add 1 (mul 2 3))")
    expect(show("2 * 3 + 1")).toBe("(add (mul 2 3) 1)")
  })

  test("parens override precedence", () => {
    expect(show("(1 + 2) * 3")).toBe("(mul (add 1 2) 3)")
  })

  test("division is left-associative", () => {
    expect(show("12 / 3 / 2")).toBe("(div (div 12 3) 2)")
  })
})

describe("unary", () => {
  test("simple negation", () => {
    expect(show("-5")).toBe("(neg 5)")
  })

  test("unary plus is preserved (might fold later)", () => {
    expect(show("+5")).toBe("(pos 5)")
  })

  test("not", () => {
    expect(show("not x")).toBe("(not x)")
  })

  test("unary inside binary", () => {
    expect(show("1 + -2")).toBe("(add 1 (neg 2))")
  })

  test("no chaining of prefix operators (per spec)", () => {
    const { diagnostics } = parse("- -5")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("parens enable chained negation", () => {
    expect(show("-(-5)")).toBe("(neg (neg 5))")
  })
})

describe("power", () => {
  test("simple", () => {
    expect(show("2 ^ 3")).toBe("(pow 2 3)")
  })

  test("right-associative", () => {
    expect(show("2 ^ 3 ^ 4")).toBe("(pow 2 (pow 3 4))")
  })

  test("unary minus binds LOOSER than ^ — '-2^3' = '-(2^3)'", () => {
    expect(show("-2 ^ 3")).toBe("(neg (pow 2 3))")
  })

  test("right side of ^ accepts unary minus — '2^-3'", () => {
    expect(show("2 ^ -3")).toBe("(pow 2 (neg 3))")
  })

  test("^ binds tighter than *", () => {
    expect(show("2 * 3 ^ 4")).toBe("(mul 2 (pow 3 4))")
  })
})

describe("comparison and equality", () => {
  test("<", () => {
    expect(show("a < b")).toBe("(lt a b)")
  })

  test("==, !=", () => {
    expect(show("a == b")).toBe("(eq a b)")
    expect(show("a != b")).toBe("(neq a b)")
  })

  test("comparison binds tighter than equality", () => {
    expect(show("a < b == c")).toBe("(eq (lt a b) c)")
  })

  test("arithmetic binds tighter than comparison", () => {
    expect(show("a + 1 < b * 2")).toBe("(lt (add a 1) (mul b 2))")
  })
})

describe("logical operators", () => {
  test("and binds tighter than or", () => {
    expect(show("a or b and c")).toBe("(or a (and b c))")
  })

  test("not binds tighter than and", () => {
    expect(show("not a and b")).toBe("(and (not a) b)")
  })

  test("equality binds tighter than and", () => {
    expect(show("a == b and c")).toBe("(and (eq a b) c)")
  })
})

describe("if/then/else", () => {
  test("simple", () => {
    expect(show("if a then b else c")).toBe("(if a b c)")
  })

  test("nested in then", () => {
    expect(show("if a then if b then c else d else e")).toBe(
      "(if a (if b c d) e)",
    )
  })

  test("can be used as a primary in an expression", () => {
    expect(show("1 + if a then 2 else 3")).toBe("(add 1 (if a 2 3))")
  })

  test("else branch greedily consumes additive", () => {
    expect(show("if a then b else c + d")).toBe("(if a b (add c d))")
  })
})

describe("ternary ?:", () => {
  test("simple", () => {
    expect(show("a ? b : c")).toBe("(if a b c)")
  })

  test("right-associative", () => {
    expect(show("a ? b : c ? d : e")).toBe("(if a b (if c d e))")
  })

  test("condition is a full binary expression", () => {
    expect(show("a + 1 < b ? 1 : 0")).toBe("(if (lt (add a 1) b) 1 0)")
  })

  test("both branches can be arithmetic", () => {
    expect(show("cond ? x + 1 : y * 2")).toBe(
      "(if cond (add x 1) (mul y 2))",
    )
  })
})

describe("errors", () => {
  test("unclosed paren", () => {
    const { diagnostics } = parse("(1 + 2")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("')'")
  })

  test("unexpected token after expression", () => {
    const { diagnostics } = parse("1 2")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("unexpected")
  })

  test("missing 'then'", () => {
    const { diagnostics } = parse("if a b else c")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("'then'")
  })

  test("missing ':' in ternary", () => {
    const { diagnostics } = parse("a ? b c")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("':'")
  })

  test("trailing operator", () => {
    const { expr, diagnostics } = parse("1 +")
    expect(expr).toBeNull()
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("empty input", () => {
    const { expr, diagnostics } = parse("")
    expect(expr).toBeNull()
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("diagnostic carries the token's line/col", () => {
    const { diagnostics } = parse("(1 + 2")
    expect(diagnostics[0]).toMatchObject({ line: 1 })
    // col points at end-of-input where ')' was expected (col 7 — past the '2')
    expect(diagnostics[0]?.col).toBeGreaterThan(1)
  })
})

describe("AST positions", () => {
  test("number carries source position", () => {
    const { expr } = parse("  42")
    expect(expr).toMatchObject({ type: "number", pos: { line: 1, col: 3 } })
  })

  test("binary op pos is at the operator", () => {
    const { expr } = parse("1 + 2")
    expect(expr).toMatchObject({ type: "binary", pos: { line: 1, col: 3 } })
  })
})
