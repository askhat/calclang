import { error, type Diagnostic } from "../errors/diagnostic.ts"
import { KEYWORDS, type Token, type TokenKind } from "./token.ts"

export type LexerConfig = {
  decimalSeparator: "," | "."
}

export const DEFAULT_CONFIG: LexerConfig = { decimalSeparator: "," }

export type LexResult = {
  tokens: Token[]
  diagnostics: Diagnostic[]
}

const SINGLE_CHAR: Readonly<Record<string, TokenKind>> = {
  "+": "PLUS",
  "-": "MINUS",
  "*": "STAR",
  "/": "SLASH",
  "^": "CARET",
  "(": "LPAREN",
  ")": "RPAREN",
  "?": "QUESTION",
  ":": "COLON",
}

class Lexer {
  private pos = 0
  private line = 1
  private col = 1
  private readonly tokens: Token[] = []
  private readonly diagnostics: Diagnostic[] = []

  constructor(
    private readonly source: string,
    private readonly config: LexerConfig,
  ) {}

  tokenize(): LexResult {
    while (!this.isAtEnd()) {
      this.scanToken()
    }
    this.push("EOF", "", this.line, this.col)
    return { tokens: this.tokens, diagnostics: this.diagnostics }
  }

  private scanToken(): void {
    const startLine = this.line
    const startCol = this.col
    const c = this.peek()

    if (c === " " || c === "\t" || c === "\r") {
      this.advance()
      return
    }
    if (c === "\n") {
      this.advance()
      this.push("NEWLINE", "\n", startLine, startCol)
      return
    }
    if (c === "#") {
      this.skipComment()
      return
    }
    if (this.isDigit(c)) {
      this.number(startLine, startCol)
      return
    }
    if (this.isIdentStart(c)) {
      this.identifier(startLine, startCol)
      return
    }

    const singleKind = SINGLE_CHAR[c]
    if (singleKind !== undefined) {
      this.advance()
      this.push(singleKind, c, startLine, startCol)
      return
    }

    switch (c) {
      case "=":
        this.advance()
        if (this.peek() === "=") {
          this.advance()
          this.push("EQEQ", "==", startLine, startCol)
        } else {
          this.push("EQ", "=", startLine, startCol)
        }
        return
      case "!":
        this.advance()
        if (this.peek() === "=") {
          this.advance()
          this.push("NEQ", "!=", startLine, startCol)
        } else {
          this.diagnostic(
            "unexpected '!'",
            startLine,
            startCol,
            "did you mean '!=' (not equal)?",
          )
        }
        return
      case "<":
        this.advance()
        if (this.peek() === "=") {
          this.advance()
          this.push("LTE", "<=", startLine, startCol)
        } else {
          this.push("LT", "<", startLine, startCol)
        }
        return
      case ">":
        this.advance()
        if (this.peek() === "=") {
          this.advance()
          this.push("GTE", ">=", startLine, startCol)
        } else {
          this.push("GT", ">", startLine, startCol)
        }
        return
    }

    this.advance()
    this.diagnoseStray(c, startLine, startCol)
  }

  private number(startLine: number, startCol: number): void {
    const start = this.pos
    this.consumeDigits()
    if (
      this.peek() === this.config.decimalSeparator &&
      this.isDigit(this.peek(1))
    ) {
      this.advance()
      this.consumeDigits()
    }
    const lexeme = this.source.slice(start, this.pos)
    const value = lexeme
      .replaceAll("_", "")
      .replace(this.config.decimalSeparator, ".")
    this.push("NUMBER", lexeme, startLine, startCol, value)
  }

  private consumeDigits(): void {
    if (!this.isDigit(this.peek())) return
    this.advance()
    while (true) {
      const c = this.peek()
      if (this.isDigit(c)) {
        this.advance()
      } else if (c === "_" && this.isDigit(this.peek(1))) {
        this.advance()
      } else {
        return
      }
    }
  }

  private identifier(startLine: number, startCol: number): void {
    const start = this.pos
    this.advance()
    while (this.isIdentCont(this.peek())) {
      this.advance()
    }
    const lexeme = this.source.slice(start, this.pos)
    const kind = KEYWORDS[lexeme] ?? "IDENT"
    this.push(kind, lexeme, startLine, startCol)
  }

  private skipComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance()
    }
  }

  private diagnoseStray(c: string, line: number, col: number): void {
    const decimal = this.config.decimalSeparator
    const other = decimal === "," ? "." : ","
    if (c === decimal) {
      this.diagnostic(
        `stray '${c}'`,
        line,
        col,
        `decimal separator must be inside a number, e.g. '35${c}5'`,
      )
      return
    }
    if (c === other) {
      this.diagnostic(
        `unexpected '${c}', the decimal separator in this file is '${decimal}'`,
        line,
        col,
        `try '${decimal}' (e.g. '35${decimal}5')`,
      )
      return
    }
    this.diagnostic(`unexpected character ${JSON.stringify(c)}`, line, col)
  }

  // -- low-level helpers --

  private isAtEnd(): boolean {
    return this.pos >= this.source.length
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? ""
  }

  private advance(): string {
    const c = this.source[this.pos]!
    this.pos++
    if (c === "\n") {
      this.line++
      this.col = 1
    } else {
      this.col++
    }
    return c
  }

  private isDigit(c: string): boolean {
    return c.length === 1 && c >= "0" && c <= "9"
  }

  private isIdentStart(c: string): boolean {
    return (
      c.length === 1 &&
      ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_")
    )
  }

  private isIdentCont(c: string): boolean {
    return this.isIdentStart(c) || this.isDigit(c)
  }

  private push(
    kind: TokenKind,
    lexeme: string,
    line: number,
    col: number,
    value?: string,
  ): void {
    this.tokens.push({
      kind,
      lexeme,
      value: value ?? lexeme,
      line,
      col,
    })
  }

  private diagnostic(
    message: string,
    line: number,
    col: number,
    hint?: string,
  ): void {
    this.diagnostics.push(error(message, line, col, hint))
  }
}

export function tokenize(
  source: string,
  config: LexerConfig = DEFAULT_CONFIG,
): LexResult {
  return new Lexer(source, config).tokenize()
}
