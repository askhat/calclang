import Decimal from "decimal.js"
import { error as mkError, type Diagnostic } from "../errors/diagnostic.ts"
import type { Token, TokenKind } from "../lexer/token.ts"
import type {
  BinaryOp,
  Expr,
  ExprAssignment,
  ExprStatement,
  Position,
  Program,
  Statement,
  UnaryOp,
  UnitDecl,
  UnitDef,
  UnitExpr,
  VariableDecl,
} from "./ast.ts"

export type ParseResult = {
  expr: Expr | null
  diagnostics: Diagnostic[]
}

export type ProgramResult = {
  program: Program
  diagnostics: Diagnostic[]
}

type BinaryEntry = {
  prec: number
  assoc: "left" | "right"
  op: BinaryOp
}

// Pratt table for binary ops or..* /. ^ is handled by parsePower (right side
// is `unary`, per grammar — keeps '-2^3' = '-(2^3)' and '2^-3' = '2^(-3)').
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
  IDENT: "identifier",
  NUMBER: "number",
}

/** First pass: scan for `declare X ...` lines and collect the X names. */
export function collectUnitNames(tokens: readonly Token[]): Set<string> {
  const names = new Set<string>()
  for (let i = 0; i < tokens.length - 1; i++) {
    if (
      tokens[i]?.kind === "DECLARE" &&
      tokens[i + 1]?.kind === "IDENT"
    ) {
      names.add(tokens[i + 1]!.lexeme)
    }
  }
  return names
}

class Parser {
  private cursor = 0
  private readonly eof: Token
  readonly diagnostics: Diagnostic[] = []

  constructor(
    private readonly tokens: readonly Token[],
    private readonly unitNames: ReadonlySet<string> = new Set(),
  ) {
    this.eof = tokens[tokens.length - 1] ?? {
      kind: "EOF",
      lexeme: "",
      value: "",
      line: 1,
      col: 1,
    }
  }

  // ===== Program-level (stage 3) =====

  parseProgram(): Program {
    const statements: Statement[] = []
    this.skipNewlines()
    while (this.peek().kind !== "EOF") {
      const stmt = this.parseStatement()
      if (stmt) statements.push(stmt)
      // If we're not at line end (either statement parsed but tokens linger,
      // or parsing failed mid-line), report and skip to next line.
      if (this.peek().kind !== "NEWLINE" && this.peek().kind !== "EOF") {
        if (stmt) {
          this.diagnose(
            this.peek(),
            `unexpected ${describe(this.peek())} after statement`,
          )
        }
        this.syncToLineEnd()
      }
      this.skipNewlines()
    }
    return { statements }
  }

  private parseStatement(): Statement | null {
    const t = this.peek()
    if (t.kind === "DECLARE") return this.parseDeclaration()
    if (this.isVariableDeclStart()) return this.parseVariableDecl()
    return this.parseExpressionOrAssignment()
  }

  /** Pure-lookahead test for the [+|-]? NUMBER ... IDENT (NEWLINE|EOF) shape. */
  private isVariableDeclStart(): boolean {
    let i = 0
    const k0 = this.peek(i).kind
    if (k0 === "MINUS" || k0 === "PLUS") i++
    if (this.peek(i).kind !== "NUMBER") return false
    i++
    const after = this.peek(i).kind
    if (after === "IDENT") {
      // NUMBER IDENT (line end)  → dimensionless var_decl
      if (this.isLineEnd(this.peek(i + 1))) return true
      // NUMBER IDENT IDENT (line end)  → var_decl with simple unit
      if (
        this.peek(i + 1).kind === "IDENT" &&
        this.isLineEnd(this.peek(i + 2))
      ) {
        return true
      }
      return false
    }
    if (after === "LPAREN") {
      // NUMBER ( … ) IDENT (line end)  → var_decl with composite unit
      let depth = 1
      i++
      while (depth > 0) {
        const k = this.peek(i).kind
        if (k === "EOF" || k === "NEWLINE") return false
        if (k === "LPAREN") depth++
        else if (k === "RPAREN") depth--
        i++
      }
      if (
        this.peek(i).kind === "IDENT" &&
        this.isLineEnd(this.peek(i + 1))
      ) {
        return true
      }
    }
    return false
  }

  private isLineEnd(t: Token): boolean {
    return t.kind === "NEWLINE" || t.kind === "EOF"
  }

  private parseDeclaration(): UnitDecl | null {
    const declareTok = this.advance() // 'declare'
    const nameTok = this.expect("IDENT")
    if (!nameTok) return null

    const next = this.peek()
    let def: UnitDef
    if (next.kind === "BASE") {
      this.advance()
      const dimTok = this.expect("IDENT")
      if (!dimTok) return null
      def = { kind: "base", dimension: dimTok.lexeme }
    } else if (next.kind === "LPAREN") {
      this.advance()
      this.skipNewlines()
      const expr = this.parseExpressionRule()
      if (!expr) return null
      this.skipNewlines()
      if (!this.expect("RPAREN")) return null
      def = { kind: "composite", expr }
    } else if (next.kind === "IDENT") {
      this.advance()
      def = { kind: "alias", dimension: next.lexeme }
    } else {
      this.diagnose(
        next,
        `expected 'base', '(', or dimension name, got ${describe(next)}`,
      )
      return null
    }

    return {
      type: "unitDecl",
      name: nameTok.lexeme,
      def,
      pos: pos(declareTok),
    }
  }

  private parseVariableDecl(): VariableDecl | null {
    const startTok = this.peek()
    let sign: 1 | -1 = 1
    if (this.peek().kind === "MINUS") {
      this.advance()
      sign = -1
    } else if (this.peek().kind === "PLUS") {
      this.advance()
    }

    const numTok = this.expect("NUMBER")
    if (!numTok) return null
    let value = new Decimal(numTok.value)
    if (sign === -1) value = value.neg()

    let unit: UnitExpr | undefined
    // Simple unit: NUMBER IDENT IDENT — first IDENT is unit, second is name.
    if (
      this.peek().kind === "IDENT" &&
      this.peek(1).kind === "IDENT"
    ) {
      const unitTok = this.advance()
      if (!this.unitNames.has(unitTok.lexeme)) {
        this.diagnose(
          unitTok,
          `unknown unit '${unitTok.lexeme}'`,
          `add 'declare ${unitTok.lexeme} base <dim>' or 'declare ${unitTok.lexeme} (<expr>)'`,
        )
      }
      unit = {
        type: "unitRef",
        name: unitTok.lexeme,
        pos: pos(unitTok),
      }
    } else if (this.peek().kind === "LPAREN") {
      // Composite unit: NUMBER ( unit_expr ) IDENT.
      this.advance()
      const u = this.parseUnitExpr()
      if (!u) return null
      if (!this.expect("RPAREN")) return null
      unit = u
    }

    const nameTok = this.expect("IDENT")
    if (!nameTok) return null

    return {
      type: "variableDecl",
      name: nameTok.lexeme,
      value,
      unit,
      pos: pos(startTok),
    }
  }

  private parseExpressionOrAssignment():
    | ExprAssignment
    | ExprStatement
    | null {
    const startTok = this.peek()
    const expr = this.parseExpressionRule()
    if (!expr) return null
    if (this.peek().kind === "EQ") {
      this.advance()
      const nameTok = this.expect("IDENT")
      if (!nameTok) return null
      return {
        type: "exprAssignment",
        expr,
        name: nameTok.lexeme,
        pos: pos(startTok),
      }
    }
    return { type: "exprStatement", expr, pos: pos(startTok) }
  }

  private syncToLineEnd(): void {
    while (
      this.peek().kind !== "NEWLINE" &&
      this.peek().kind !== "EOF"
    ) {
      this.advance()
    }
  }

  // ===== Expression parsing (stage 2 + conversion/quantity) =====

  /** Public single-expression entry point — used by tests and the REPL. */
  parseExpressionOnly(): Expr | null {
    this.skipNewlines()
    if (this.peek().kind === "EOF") {
      this.diagnose(this.peek(), "expected expression, got end of input")
      return null
    }
    const expr = this.parseExpressionRule()
    if (!expr) return null
    this.skipNewlines()
    if (this.peek().kind !== "EOF") {
      this.diagnose(
        this.peek(),
        `unexpected ${describe(this.peek())} after expression`,
      )
    }
    return expr
  }

  private parseExpressionRule(): Expr | null {
    const left = this.parseBinary(0)
    if (!left) return null
    if (this.peek().kind === "QUESTION") {
      const qTok = this.advance()
      const thenBranch = this.parseExpressionRule()
      if (!thenBranch) return null
      if (!this.expect("COLON")) return null
      const elseBranch = this.parseExpressionRule()
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
    const base = this.parseConversion()
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

  private parseConversion(): Expr | null {
    const expr = this.parsePrimary()
    if (!expr) return null
    if (this.peek().kind === "AS") {
      const asTok = this.advance()
      const unit = this.parseUnitExpr()
      if (!unit) return null
      return { type: "conversion", expr, unit, pos: pos(asTok) }
    }
    return expr
  }

  private parsePrimary(): Expr | null {
    const t = this.peek()
    switch (t.kind) {
      case "NUMBER": {
        this.advance()
        let unit: UnitExpr | undefined
        const next = this.peek()
        if (next.kind === "IDENT") {
          if (this.unitNames.has(next.lexeme)) {
            this.advance()
            unit = {
              type: "unitRef",
              name: next.lexeme,
              pos: pos(next),
            }
          } else {
            // After a number, an adjacent IDENT must be a unit suffix —
            // the grammar has no implicit multiplication. Treat the unknown
            // name as a broken unit, emit a diagnostic, and still consume
            // it to avoid cascading errors.
            this.advance()
            this.diagnose(
              next,
              `unknown unit '${next.lexeme}'`,
              `add 'declare ${next.lexeme} base <dim>' or 'declare ${next.lexeme} (<expr>)'`,
            )
            unit = {
              type: "unitRef",
              name: next.lexeme,
              pos: pos(next),
            }
          }
        }
        return {
          type: "number",
          value: new Decimal(t.value),
          unit,
          pos: pos(t),
        }
      }
      case "IDENT":
        this.advance()
        return { type: "ident", name: t.lexeme, pos: pos(t) }
      case "LPAREN": {
        this.advance()
        this.skipNewlines()
        const inner = this.parseExpressionRule()
        if (!inner) return null
        this.skipNewlines()
        if (!this.expect("RPAREN")) return null
        return inner
      }
      case "IF": {
        this.advance()
        const cond = this.parseExpressionRule()
        if (!cond) return null
        if (!this.expect("THEN")) return null
        const thenBranch = this.parseExpressionRule()
        if (!thenBranch) return null
        if (!this.expect("ELSE")) return null
        const elseBranch = this.parseExpressionRule()
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

  // ===== Unit expressions =====

  parseUnitExpr(): UnitExpr | null {
    let left = this.parseUnitAtom()
    if (!left) return null
    while (
      this.peek().kind === "STAR" ||
      this.peek().kind === "SLASH"
    ) {
      const opTok = this.advance()
      const right = this.parseUnitAtom()
      if (!right) return null
      left = {
        type: "unitBinary",
        op: opTok.kind === "STAR" ? "mul" : "div",
        left,
        right,
        pos: pos(opTok),
      }
    }
    return left
  }

  private parseUnitAtom(): UnitExpr | null {
    const t = this.peek()
    if (t.kind === "IDENT") {
      this.advance()
      let atom: UnitExpr = {
        type: "unitRef",
        name: t.lexeme,
        pos: pos(t),
      }
      if (this.peek().kind === "CARET") {
        const caretTok = this.advance()
        let negative = false
        if (this.peek().kind === "MINUS") {
          this.advance()
          negative = true
        }
        const expTok = this.expect("NUMBER")
        if (!expTok) return null
        if (expTok.value.includes(".")) {
          this.diagnose(expTok, "unit exponent must be an integer")
          return null
        }
        const expVal = parseInt(expTok.value, 10)
        atom = {
          type: "unitPow",
          base: atom,
          exp: negative ? -expVal : expVal,
          pos: pos(caretTok),
        }
      }
      return atom
    }
    if (t.kind === "LPAREN") {
      this.advance()
      const inner = this.parseUnitExpr()
      if (!inner) return null
      if (!this.expect("RPAREN")) return null
      return inner
    }
    this.diagnose(t, `expected unit identifier, got ${describe(t)}`)
    return null
  }

  // ===== low-level helpers =====

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

export function parseExpression(
  tokens: readonly Token[],
  unitNames?: ReadonlySet<string>,
): ParseResult {
  const p = new Parser(tokens, unitNames ?? collectUnitNames(tokens))
  const expr = p.parseExpressionOnly()
  return { expr, diagnostics: p.diagnostics }
}

export function parseProgram(tokens: readonly Token[]): ProgramResult {
  const unitNames = collectUnitNames(tokens)
  const p = new Parser(tokens, unitNames)
  const program = p.parseProgram()
  return { program, diagnostics: p.diagnostics }
}
