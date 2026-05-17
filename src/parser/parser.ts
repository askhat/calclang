import Decimal from "decimal.js"
import { error as mkError, type Diagnostic } from "../errors/diagnostic.ts"
import type { Token, TokenKind } from "../lexer/token.ts"
import type { BinaryOp, Expr, Position, UnaryOp } from "./ast.ts"

export type ParseResult = {
  expr: Expr | null
  diagnostics: Diagnostic[]
}

type BinaryEntry = {
  prec: number
  assoc: "left" | "right"
  op: BinaryOp
}

// Pratt table for left-associative binary ops, from lowest to highest prec.
// ^ is NOT here — it's handled by parsePower so that its right side parses
// as `unary`, giving `2 ^ -3` and `-2 ^ 3 = -(2^3)` per the spec grammar.
const BINARY_OPS: ReadonlyMap<TokenKind, BinaryEntry> = new Map([
  ["OR", { prec: 1, assoc: "left", op: "or" }],
  ["AND", { prec: 2, assoc: "left", op: "and" }],
  ["EQEQ", { prec: 3, assoc: "left", op: "eq" }],
  ["NEQ", { prec: 3, assoc: "left", op: "neq" }],
  ["LT", { prec: 4, assoc: "left", op: "lt" }],
  ["GT", { prec: 4, assoc: "left", op: "gt" }],
  ["LTE", { prec: 4, assoc: "left", op: "lte" }],
  ["GTE", { prec: 4, assoc: "left", op: "gte" }],
  ["PLUS", { prec: 5, assoc: "left", op: "add" }],
  ["MINUS", { prec: 5, assoc: "left", op: "sub" }],
  ["STAR", { prec: 6, assoc: "left", op: "mul" }],
  ["SLASH", { prec: 6, assoc: "left", op: "div" }],
])

const KIND_NAMES: Partial<Record<TokenKind, string>> = {
  LPAREN: "'('",
  RPAREN: "')'",
  COLON: "':'",
  QUESTION: "'?'",
  THEN: "'then'",
  ELSE: "'else'",
  CARET: "'^'",
}

class Parser {
  private cursor = 0
  private readonly eof: Token
  readonly diagnostics: Diagnostic[] = []

  constructor(private readonly tokens: Token[]) {
    this.eof = tokens[tokens.length - 1] ?? {
      kind: "EOF",
      lexeme: "",
      value: "",
      line: 1,
      col: 1,
    }
  }

  parse(): Expr | null {
    this.skipNewlines()
    if (this.peek().kind === "EOF") {
      this.diagnose(this.peek(), "expected expression, got end of input")
      return null
    }
    const expr = this.parseExpression()
    if (!expr) return null
    this.skipNewlines()
    if (this.peek().kind !== "EOF") {
      const t = this.peek()
      this.diagnose(t, `unexpected ${describe(t)} after expression`)
    }
    return expr
  }

  private parseExpression(): Expr | null {
    const left = this.parseBinary(0)
    if (!left) return null
    if (this.peek().kind === "QUESTION") {
      const qTok = this.advance()
      const thenBranch = this.parseExpression()
      if (!thenBranch) return null
      if (!this.expect("COLON")) return null
      const elseBranch = this.parseExpression()
      if (!elseBranch) return null
      return {
        type: "if",
        cond: left,
        then: thenBranch,
        else: elseBranch,
        pos: pos(qTok),
      }
    }
    return left
  }

  private parseBinary(minPrec: number): Expr | null {
    let left = this.parseUnary()
    if (!left) return null
    while (true) {
      const entry = BINARY_OPS.get(this.peek().kind)
      if (!entry || entry.prec < minPrec) break
      const opTok = this.advance()
      const nextMin = entry.assoc === "left" ? entry.prec + 1 : entry.prec
      const right = this.parseBinary(nextMin)
      if (!right) return null
      left = {
        type: "binary",
        op: entry.op,
        left,
        right,
        pos: pos(opTok),
      }
    }
    return left
  }

  private parseUnary(): Expr | null {
    const t = this.peek()
    if (t.kind === "MINUS" || t.kind === "PLUS" || t.kind === "NOT") {
      this.advance()
      const operand = this.parsePower()
      if (!operand) return null
      const op: UnaryOp =
        t.kind === "MINUS" ? "neg" : t.kind === "PLUS" ? "pos" : "not"
      return { type: "unary", op, operand, pos: pos(t) }
    }
    return this.parsePower()
  }

  private parsePower(): Expr | null {
    const base = this.parsePrimary()
    if (!base) return null
    if (this.peek().kind === "CARET") {
      const opTok = this.advance()
      const exp = this.parseUnary()
      if (!exp) return null
      return {
        type: "binary",
        op: "pow",
        left: base,
        right: exp,
        pos: pos(opTok),
      }
    }
    return base
  }

  private parsePrimary(): Expr | null {
    const t = this.peek()
    switch (t.kind) {
      case "NUMBER":
        this.advance()
        return { type: "number", value: new Decimal(t.value), pos: pos(t) }
      case "IDENT":
        this.advance()
        return { type: "ident", name: t.lexeme, pos: pos(t) }
      case "LPAREN": {
        this.advance()
        this.skipNewlines()
        const inner = this.parseExpression()
        if (!inner) return null
        this.skipNewlines()
        if (!this.expect("RPAREN")) return null
        return inner
      }
      case "IF": {
        this.advance()
        const cond = this.parseExpression()
        if (!cond) return null
        if (!this.expect("THEN")) return null
        const thenBranch = this.parseExpression()
        if (!thenBranch) return null
        if (!this.expect("ELSE")) return null
        const elseBranch = this.parseExpression()
        if (!elseBranch) return null
        return {
          type: "if",
          cond,
          then: thenBranch,
          else: elseBranch,
          pos: pos(t),
        }
      }
      default:
        this.diagnose(t, `expected expression, got ${describe(t)}`)
        return null
    }
  }

  // -- helpers --

  private peek(offset = 0): Token {
    return this.tokens[this.cursor + offset] ?? this.eof
  }

  private advance(): Token {
    const t = this.peek()
    if (t.kind !== "EOF") this.cursor++
    return t
  }

  private expect(kind: TokenKind): Token | null {
    const t = this.peek()
    if (t.kind === kind) {
      this.advance()
      return t
    }
    this.diagnose(t, `expected ${kindName(kind)}, got ${describe(t)}`)
    return null
  }

  private skipNewlines(): void {
    while (this.peek().kind === "NEWLINE") this.advance()
  }

  private diagnose(t: Token, message: string, hint?: string): void {
    this.diagnostics.push(mkError(message, t.line, t.col, hint))
  }
}

function pos(t: Token): Position {
  return { line: t.line, col: t.col }
}

function describe(t: Token): string {
  if (t.kind === "EOF") return "end of input"
  if (t.kind === "NEWLINE") return "end of line"
  return `'${t.lexeme}'`
}

function kindName(kind: TokenKind): string {
  return KIND_NAMES[kind] ?? kind
}

export function parseExpression(tokens: Token[]): ParseResult {
  const p = new Parser(tokens)
  const expr = p.parse()
  return { expr, diagnostics: p.diagnostics }
}
