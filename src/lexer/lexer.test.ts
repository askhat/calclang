import { describe, expect, test } from "bun:test"
import { tokenize } from "./lexer.ts"
import type { TokenKind } from "./token.ts"

const kinds = (src: string, config?: Parameters<typeof tokenize>[1]) =>
  tokenize(src, config).tokens.map((t) => t.kind)

describe("numbers", () => {
  test("plain integer", () => {
    const { tokens, diagnostics } = tokenize("42")
    expect(diagnostics).toEqual([])
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      kind: "NUMBER",
      lexeme: "42",
      value: "42",
      line: 1,
      col: 1,
    })
    expect(tokens[1]?.kind).toBe("EOF")
  })

  test("decimal with comma (default locale)", () => {
    const { tokens } = tokenize("35,5")
    expect(tokens[0]).toMatchObject({
      kind: "NUMBER",
      lexeme: "35,5",
      value: "35.5",
    })
  })

  test("decimal with dot when locale = dot", () => {
    const { tokens } = tokenize("35.5", { decimalSeparator: "." })
    expect(tokens[0]).toMatchObject({
      kind: "NUMBER",
      lexeme: "35.5",
      value: "35.5",
    })
  })

  test("thousands underscore", () => {
    expect(tokenize("1_000").tokens[0]).toMatchObject({
      lexeme: "1_000",
      value: "1000",
    })
  })

  test("thousands + decimal together", () => {
    expect(tokenize("1_000_000,5").tokens[0]).toMatchObject({
      value: "1000000.5",
    })
  })

  test("long fractional from spec (currency rate)", () => {
    expect(tokenize("467,245543").tokens[0]).toMatchObject({
      value: "467.245543",
    })
  })

  test("does NOT consume leading sign — '-10' is two tokens", () => {
    expect(kinds("-10")).toEqual(["MINUS", "NUMBER", "EOF"])
  })

  test("trailing decimal separator is NOT consumed", () => {
    const { tokens, diagnostics } = tokenize("35,")
    expect(tokens.map((t) => t.kind)).toEqual(["NUMBER", "EOF"])
    expect(tokens[0]?.lexeme).toBe("35")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("stray")
  })

  test("comma in dot-locale gets a helpful diagnostic", () => {
    const { diagnostics } = tokenize("35,5", { decimalSeparator: "." })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.hint).toContain(".")
  })

  test("dot in comma-locale gets a helpful diagnostic", () => {
    const { diagnostics } = tokenize("35.5")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.hint).toContain(",")
  })
})

describe("identifiers and keywords", () => {
  test("simple ident", () => {
    expect(tokenize("salary").tokens[0]).toMatchObject({
      kind: "IDENT",
      lexeme: "salary",
    })
  })

  test("ident with digits and underscore", () => {
    expect(tokenize("salary_2").tokens[0]).toMatchObject({
      kind: "IDENT",
      lexeme: "salary_2",
    })
  })

  test("ident starting with underscore", () => {
    expect(tokenize("_private").tokens[0]).toMatchObject({
      kind: "IDENT",
      lexeme: "_private",
    })
  })

  test("every keyword is recognized", () => {
    const cases: Array<[string, TokenKind]> = [
      ["unit", "UNIT"],
      ["base", "BASE"],
      ["as", "AS"],
      ["if", "IF"],
      ["then", "THEN"],
      ["else", "ELSE"],
      ["and", "AND"],
      ["or", "OR"],
      ["not", "NOT"],
    ]
    for (const [src, kind] of cases) {
      expect(tokenize(src).tokens[0]?.kind).toBe(kind)
    }
  })

  test("keyword as substring is still ident", () => {
    expect(tokenize("asparagus").tokens[0]).toMatchObject({
      kind: "IDENT",
      lexeme: "asparagus",
    })
    expect(tokenize("declared").tokens[0]).toMatchObject({
      kind: "IDENT",
      lexeme: "declared",
    })
  })
})

describe("operators and punctuation", () => {
  test("single-char operators", () => {
    expect(kinds("+ - * / ^ ( ) ? :")).toEqual([
      "PLUS",
      "MINUS",
      "STAR",
      "SLASH",
      "CARET",
      "LPAREN",
      "RPAREN",
      "QUESTION",
      "COLON",
      "EOF",
    ])
  })

  test("two-char operators", () => {
    expect(kinds("== != <= >= < > =")).toEqual([
      "EQEQ",
      "NEQ",
      "LTE",
      "GTE",
      "LT",
      "GT",
      "EQ",
      "EOF",
    ])
  })

  test("bare '!' is a diagnostic, not a silent NEQ", () => {
    const { diagnostics, tokens } = tokenize("!x")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.hint).toContain("!=")
    // '!' is dropped, 'x' still tokenized
    expect(tokens.map((t) => t.kind)).toEqual(["IDENT", "EOF"])
  })

  test("'==' is one token, not two '='", () => {
    expect(kinds("==")).toEqual(["EQEQ", "EOF"])
  })
})

describe("comments", () => {
  test("full-line comment yields just EOF", () => {
    expect(kinds("# hello world")).toEqual(["EOF"])
  })

  test("trailing comment is stripped", () => {
    expect(kinds("salary # rate")).toEqual(["IDENT", "EOF"])
  })

  test("comment ends at newline", () => {
    expect(kinds("# rate\nsalary")).toEqual(["NEWLINE", "IDENT", "EOF"])
  })

  test("comment with leading whitespace", () => {
    expect(kinds("  # spaces before")).toEqual(["EOF"])
  })
})

describe("positions", () => {
  test("first token starts at 1:1", () => {
    const { tokens } = tokenize("salary")
    expect(tokens[0]).toMatchObject({ line: 1, col: 1 })
  })

  test("col advances per character", () => {
    const { tokens } = tokenize("a bc")
    expect(tokens[0]).toMatchObject({ line: 1, col: 1 })
    expect(tokens[1]).toMatchObject({ line: 1, col: 3 })
  })

  test("newline bumps line and resets col", () => {
    const { tokens } = tokenize("a\nb")
    const [a, , b] = tokens
    expect(a).toMatchObject({ line: 1, col: 1 })
    expect(b).toMatchObject({ line: 2, col: 1 })
  })

  test("CR is treated as whitespace", () => {
    // Windows-style \r\n: \r is whitespace, \n emits NEWLINE
    expect(kinds("a\r\nb")).toEqual(["IDENT", "NEWLINE", "IDENT", "EOF"])
  })

  test("multiple blank lines stay as separate NEWLINE tokens", () => {
    expect(kinds("\n\n\n")).toEqual(["NEWLINE", "NEWLINE", "NEWLINE", "EOF"])
  })
})

describe("composite forms from the spec", () => {
  test("variable_decl with leading sign: '-10 minusTen'", () => {
    expect(kinds("-10 minusTen")).toEqual([
      "MINUS",
      "NUMBER",
      "IDENT",
      "EOF",
    ])
  })

  test("variable_decl with unit: '35,5 rub salary'", () => {
    const { tokens } = tokenize("35,5 rub salary")
    expect(tokens.map((t) => t.kind)).toEqual([
      "NUMBER",
      "IDENT",
      "IDENT",
      "EOF",
    ])
    expect(tokens[0]?.value).toBe("35.5")
  })

  test("unit decl with composite unit", () => {
    expect(kinds("unit kzt (usd / 467,245543)")).toEqual([
      "UNIT",
      "IDENT",
      "LPAREN",
      "IDENT",
      "SLASH",
      "NUMBER",
      "RPAREN",
      "EOF",
    ])
  })

  test("expression with conversion: '100 rub + 5 usd as eur'", () => {
    expect(kinds("100 rub + 5 usd as eur")).toEqual([
      "NUMBER",
      "IDENT",
      "PLUS",
      "NUMBER",
      "IDENT",
      "AS",
      "IDENT",
      "EOF",
    ])
  })

  test("expression_assignment with =", () => {
    expect(kinds("salary + minusTen = total")).toEqual([
      "IDENT",
      "PLUS",
      "IDENT",
      "EQ",
      "IDENT",
      "EOF",
    ])
  })
})

describe("empty / edge cases", () => {
  test("empty input is just EOF", () => {
    expect(kinds("")).toEqual(["EOF"])
  })

  test("whitespace only is just EOF", () => {
    expect(kinds("   \t  ")).toEqual(["EOF"])
  })

  test("unknown character is a diagnostic, lexing continues", () => {
    const { tokens, diagnostics } = tokenize("a @ b")
    expect(diagnostics).toHaveLength(1)
    expect(tokens.map((t) => t.kind)).toEqual(["IDENT", "IDENT", "EOF"])
  })
})
