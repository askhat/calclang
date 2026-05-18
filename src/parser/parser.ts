import Decimal from "decimal.js"
import { error as mkError, type Diagnostic } from "../errors/diagnostic.ts"
import type { Token, TokenKind } from "../lexer/token.ts"
import type {
  BinaryOp,
  Expr,
  ExprAssignment,
  ExprStatement,
  FunctionDecl,
  NumberLit,
  PlotDecl,
  PlotInstr,
  Position,
  Program,
  RangeDecl,
  RangeLit,
  SeriesDecl,
  SeriesMember,
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
  ["OF", { prec: 6, assoc: "left", op: "of" }],
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

/**
 * First pass: find the unit name in each UNIT line, regardless of form.
 *   UNIT <Dim> <name> ...     → name is at position i+2
 *   UNIT ( ... ) <name>       → name is the first IDENT after the closing ')'
 */
export function collectUnitNames(tokens: readonly Token[]): Set<string> {
  const names = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.kind !== "UNIT") continue
    const next = tokens[i + 1]
    if (next?.kind === "IDENT" && tokens[i + 2]?.kind === "IDENT") {
      names.add(tokens[i + 2]!.lexeme)
    } else if (next?.kind === "LPAREN") {
      // Skip to matching ')'; the next IDENT after it is the unit name.
      let depth = 1
      let j = i + 2
      while (j < tokens.length && depth > 0) {
        const k = tokens[j]?.kind
        if (k === "LPAREN") depth++
        else if (k === "RPAREN") depth--
        else if (k === "NEWLINE" || k === "EOF") break
        j++
      }
      if (depth === 0 && tokens[j]?.kind === "IDENT") {
        names.add(tokens[j]!.lexeme)
      }
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
      // A statement is followed by a newline, EOF, or the next top-level
      // keyword (UNIT / SERIES — used when a block statement stops just
      // before the next statement's header without consuming a newline).
      const after = this.peek().kind
      const atBoundary =
        after === "NEWLINE" ||
        after === "EOF" ||
        after === "UNIT" ||
        after === "SERIES" ||
        after === "RANGE" ||
        after === "FN" ||
        after === "PLOT"
      if (!atBoundary) {
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
    if (t.kind === "UNIT") return this.parseDeclaration()
    if (t.kind === "SERIES") return this.parseSeriesDecl()
    if (t.kind === "RANGE") return this.parseRangeDeclKeyword()
    if (t.kind === "FN") return this.parseFunctionDecl()
    if (t.kind === "PLOT") return this.parsePlotDecl()
    if (this.isVariableDeclStart()) return this.parseVariableDecl()
    return this.parseExpressionOrAssignment()
  }

  /**
   * `RANGE <name> <start> <end> [<step>]` — inclusive only. Endpoints and
   * step are conditional-level expressions. Step is optional (defaults to 1
   * at eval time).
   */
  private parseRangeDeclKeyword(): RangeDecl | null {
    const rangeTok = this.advance() // 'RANGE'
    const nameTok = this.expect("IDENT")
    if (!nameTok) return null
    const start = this.parseConditional()
    if (!start) return null
    const end = this.parseConditional()
    if (!end) return null
    let step: Expr | undefined
    if (!this.isLineEnd(this.peek())) {
      const stepExpr = this.parseConditional()
      if (!stepExpr) return null
      step = stepExpr
    }
    const range: RangeLit = {
      type: "range",
      start,
      end,
      step,
      inclusive: true,
      pos: pos(rangeTok),
    }
    return {
      type: "rangeDecl",
      name: nameTok.lexeme,
      range,
      pos: pos(rangeTok),
    }
  }

  private parseFunctionDecl(): FunctionDecl | null {
    const fnTok = this.advance() // 'FN'
    const nameTok = this.expect("IDENT")
    if (!nameTok) return null
    if (!this.expect("LPAREN")) return null

    const params: string[] = []
    if (this.peek().kind !== "RPAREN") {
      const first = this.expect("IDENT")
      if (!first) return null
      params.push(first.lexeme)
      while (this.peek().kind === "COMMA") {
        this.advance()
        const p = this.expect("IDENT")
        if (!p) return null
        params.push(p.lexeme)
      }
    }
    if (!this.expect("RPAREN")) return null

    const body = this.parseExpressionRule()
    if (!body) return null

    return {
      type: "functionDecl",
      name: nameTok.lexeme,
      params,
      body,
      pos: pos(fnTok),
    }
  }

  /**
   * `PLOT <name>` header followed by instruction lines. Each line is
   * `<OP> <expr>...`. Argument arity per opcode is checked in the evaluator;
   * the parser just collects whatever expressions follow until end of line.
   * Block ends at blank line, EOF, or the next top-level keyword.
   */
  private parsePlotDecl(): PlotDecl | null {
    const plotTok = this.advance() // 'PLOT'
    const nameTok = this.expect("IDENT")
    if (!nameTok) return null

    // One-liner form: `PLOT <name> <ident>` — auto-chart from a series/range.
    // Distinguish from the block form by what follows the name: an IDENT
    // here can only be a data-source reference (the block header takes its
    // own line).
    if (this.peek().kind === "IDENT") {
      const refTok = this.advance()
      return {
        type: "plotDecl",
        name: nameTok.lexeme,
        instructions: [],
        dataRef: { name: refTok.lexeme, pos: pos(refTok) },
        pos: pos(plotTok),
      }
    }

    if (!this.expect("NEWLINE")) return null

    const instructions: PlotInstr[] = []
    while (true) {
      const k = this.peek().kind
      if (
        k === "NEWLINE" ||
        k === "EOF" ||
        k === "UNIT" ||
        k === "SERIES" ||
        k === "RANGE" ||
        k === "FN" ||
        k === "PLOT"
      ) break

      const instr = this.parsePlotInstr()
      if (!instr) {
        this.syncToLineEnd()
        if (this.peek().kind === "NEWLINE") this.advance()
        continue
      }
      instructions.push(instr)
      if (this.peek().kind === "NEWLINE") {
        this.advance()
      } else if (this.peek().kind !== "EOF") {
        this.diagnose(
          this.peek(),
          `unexpected ${describe(this.peek())} after plot instruction`,
        )
        this.syncToLineEnd()
      }
    }

    return {
      type: "plotDecl",
      name: nameTok.lexeme,
      instructions,
      pos: pos(plotTok),
    }
  }

  private parsePlotInstr(): PlotInstr | null {
    const opTok = this.expect("IDENT")
    if (!opTok) return null
    const args: Expr[] = []
    while (!this.isLineEnd(this.peek())) {
      const a = this.parseExpressionRule()
      if (!a) return null
      args.push(a)
    }
    return { op: opTok.lexeme, args, pos: pos(opTok) }
  }

  private parseSeriesDecl(): SeriesDecl | null {
    const seriesTok = this.advance() // 'SERIES'
    const nameTok = this.expect("IDENT")
    if (!nameTok) return null
    // The header takes its own line; members follow on subsequent lines.
    if (!this.expect("NEWLINE")) return null

    const members: SeriesMember[] = []
    while (true) {
      const k = this.peek().kind
      // Blank line / EOF / next top-level keyword → end of series.
      if (
        k === "NEWLINE" ||
        k === "EOF" ||
        k === "UNIT" ||
        k === "SERIES" ||
        k === "RANGE" ||
        k === "FN" ||
        k === "PLOT"
      ) break

      const member = this.parseSeriesMember()
      if (!member) {
        // Skip the broken line and keep collecting members.
        this.syncToLineEnd()
        if (this.peek().kind === "NEWLINE") this.advance()
        continue
      }
      members.push(member)
      if (this.peek().kind === "NEWLINE") {
        this.advance()
      } else if (this.peek().kind !== "EOF") {
        this.diagnose(
          this.peek(),
          `unexpected ${describe(this.peek())} after series member`,
        )
        this.syncToLineEnd()
      }
    }

    return {
      type: "seriesDecl",
      name: nameTok.lexeme,
      members,
      pos: pos(seriesTok),
    }
  }

  private parseSeriesMember(): SeriesMember | null {
    // The var-decl-like form (`[+|-]? NUMBER [<unit>] <name>`) is matched
    // first so an unknown identifier after a bare number is taken as the
    // member's name rather than swallowed as a broken unit by parsePrimary.
    if (this.isNamedSimpleMemberStart()) {
      return this.parseNamedSimpleMember()
    }
    const expr = this.parseExpressionRule()
    if (!expr) return null
    // Trailing-name form: any expression followed by `<IDENT> NEWLINE`.
    if (this.peek().kind === "IDENT" && this.isLineEnd(this.peek(1))) {
      const nameTok = this.advance()
      return { expr, name: nameTok.lexeme, namePos: pos(nameTok) }
    }
    return { expr }
  }

  /**
   * Lookahead for the var-decl-like simple-named form inside a SERIES:
   *   [+|-]? NUMBER <name>              — only if <name> is NOT a known unit
   *   [+|-]? NUMBER <unit> <name>       — first IDENT taken as unit
   *   [+|-]? NUMBER ( <unit_expr> ) <name>
   * In all cases the line must end immediately after the name.
   */
  private isNamedSimpleMemberStart(): boolean {
    let i = 0
    const k0 = this.peek(i).kind
    if (k0 === "MINUS" || k0 === "PLUS") i++
    if (this.peek(i).kind !== "NUMBER") return false
    i++
    const after = this.peek(i).kind
    if (after === "IDENT") {
      // NUMBER IDENT (line end) — dimensionless named iff IDENT isn't a unit.
      // (If it IS a unit, fall through so parseExpressionRule keeps the
      //  existing anonymous-united-member semantics, e.g. `5 usd`.)
      if (this.isLineEnd(this.peek(i + 1))) {
        return !this.unitNames.has(this.peek(i).lexeme)
      }
      // NUMBER IDENT IDENT (line end) — first IDENT is unit, second is name.
      if (
        this.peek(i + 1).kind === "IDENT" &&
        this.isLineEnd(this.peek(i + 2))
      ) {
        return true
      }
      return false
    }
    if (after === "LPAREN") {
      // NUMBER ( … ) IDENT (line end) — composite-unit named member.
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

  private parseNamedSimpleMember(): SeriesMember | null {
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
    // NUMBER IDENT IDENT — first IDENT is unit, second is name.
    if (
      this.peek().kind === "IDENT" &&
      this.peek(1).kind === "IDENT"
    ) {
      const unitTok = this.advance()
      if (!this.unitNames.has(unitTok.lexeme)) {
        this.diagnose(
          unitTok,
          `unknown unit '${unitTok.lexeme}'`,
          `add 'UNIT <Dimension> ${unitTok.lexeme}' or 'UNIT <Dimension> ${unitTok.lexeme} (<expr>)'`,
        )
      }
      unit = { type: "unitRef", name: unitTok.lexeme, pos: pos(unitTok) }
    } else if (this.peek().kind === "LPAREN") {
      this.advance()
      const u = this.parseUnitExpr()
      if (!u) return null
      if (!this.expect("RPAREN")) return null
      unit = u
    }

    const nameTok = this.expect("IDENT")
    if (!nameTok) return null

    const expr: NumberLit = {
      type: "number",
      value,
      unit,
      pos: pos(startTok),
    }
    return { expr, name: nameTok.lexeme, namePos: pos(nameTok) }
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
    // Two forms — both end with the unit name:
    //   UNIT <Dimension> <name> [ ( expr ) ]   — explicit dim, optional body
    //   UNIT ( expr ) <name>                   — composite, dim inferred from body
    const unitKwTok = this.advance() // 'UNIT'

    let def: UnitDef
    let nameTok: Token | null

    if (this.peek().kind === "LPAREN") {
      // Inferred-dim form: UNIT ( expr ) <name>
      this.advance() // (
      this.skipNewlines()
      const expr = this.parseExpressionRule()
      if (!expr) return null
      this.skipNewlines()
      if (!this.expect("RPAREN")) return null
      nameTok = this.expect("IDENT")
      if (!nameTok) return null
      def = { expr }
    } else {
      // Explicit-dim form.
      const dimTok = this.expect("IDENT")
      if (!dimTok) return null
      if (!startsUppercase(dimTok.lexeme)) {
        this.diagnose(
          dimTok,
          `expected a capitalized dimension name, got '${dimTok.lexeme}'`,
          "dimensions are Capitalized (e.g. Mass, Length, Currency); unit and variable names are lowercase",
        )
      }
      nameTok = this.expect("IDENT")
      if (!nameTok) return null

      def = { dimension: dimTok.lexeme }
      if (this.peek().kind === "LPAREN") {
        this.advance()
        this.skipNewlines()
        const expr = this.parseExpressionRule()
        if (!expr) return null
        this.skipNewlines()
        if (!this.expect("RPAREN")) return null
        def = { dimension: dimTok.lexeme, expr }
      }
    }

    return {
      type: "unitDecl",
      name: nameTok.lexeme,
      def,
      pos: pos(unitKwTok),
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
          `add 'UNIT <Dimension> ${unitTok.lexeme}' or 'UNIT <Dimension> ${unitTok.lexeme} (<expr>)'`,
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
    | RangeDecl
    | null {
    const startTok = this.peek()
    const expr = this.parseExpressionRule()
    if (!expr) return null
    // Range trailing-name form: `<range_expr> <ident>` (line end) → decl.
    if (
      expr.type === "range" &&
      this.peek().kind === "IDENT" &&
      this.isLineEnd(this.peek(1))
    ) {
      const nameTok = this.advance()
      return {
        type: "rangeDecl",
        name: nameTok.lexeme,
        range: expr,
        pos: pos(startTok),
      }
    }
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

  /**
   * Top of the expression grammar. Range (`..` / `...`) sits above the
   * conditional/binary stack so endpoints are full expressions and
   * `(1+2)..(3*4)` parses without parens. An optional `/<step>` suffix
   * follows the end; the end itself is parsed without consuming a top-level
   * `/` so that `1..10/3` cleanly means `range(1, 10) step 3` (not
   * `1..(10/3)`). To divide inside an endpoint, wrap in parens: `1..(10/3)`.
   */
  private parseExpressionRule(): Expr | null {
    const left = this.parseConditional()
    if (!left) return null
    const k = this.peek().kind
    if (k === "DOTDOT" || k === "DOTDOTDOT") {
      const opTok = this.advance()
      const right = this.parseRangeEnd()
      if (!right) return null
      let step: Expr | undefined
      if (this.peek().kind === "SLASH") {
        this.advance()
        const stepExpr = this.parseConditional()
        if (!stepExpr) return null
        step = stepExpr
      }
      return {
        type: "range",
        start: left,
        end: right,
        step,
        inclusive: opTok.kind === "DOTDOT",
        pos: pos(opTok),
      }
    }
    return left
  }

  /**
   * Range-end production: full conditional/binary parsing but stops at a
   * top-level `/` so that `1..a*b/c` reads as `range(1, a*b) step c`. To
   * divide inside an endpoint, use parens.
   */
  private parseRangeEnd(): Expr | null {
    return this.parseBinaryRangeEnd(0)
  }

  private parseBinaryRangeEnd(minPrec: number): Expr | null {
    let left = this.parseUnary()
    if (!left) return null
    while (true) {
      const k = this.peek().kind
      if (k === "SLASH") break
      const entry = BINARY_OPS.get(k)
      if (!entry || entry.prec < minPrec) break
      const opTok = this.advance()
      const nextMin = entry.assoc === "left" ? entry.prec + 1 : entry.prec
      const right = this.parseBinaryRangeEnd(nextMin)
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

  private parseConditional(): Expr | null {
    const left = this.parseBinary(0)
    if (!left) return null
    if (this.peek().kind === "QUESTION") {
      const qTok = this.advance()
      const thenBranch = this.parseConditional()
      if (!thenBranch) return null
      if (!this.expect("COLON")) return null
      const elseBranch = this.parseConditional()
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
    let expr = this.parsePrimary()
    if (!expr) return null
    // Property access and postfix `%` both bind tighter than `as`. Loop to
    // allow chains like `series.sum%` or `5%.sum` (the latter is meaningless
    // and errors at eval, but the parser stays uniform).
    while (true) {
      const k = this.peek().kind
      if (k === "DOT") {
        const dotTok = this.advance()
        const propTok = this.expect("IDENT")
        if (!propTok) return null
        expr = {
          type: "property",
          target: expr,
          property: propTok.lexeme,
          pos: pos(dotTok),
        }
      } else if (k === "PERCENT") {
        const pctTok = this.advance()
        expr = { type: "percent", expr, pos: pos(pctTok) }
      } else {
        break
      }
    }
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
          } else if (this.isLineEnd(this.peek(1))) {
            // `NUMBER unknownIdent (line end)` — leave the IDENT alone so a
            // higher production (range-decl trailing name) can claim it.
            // Top-level `35 unknownUnit` is already handled by parseVariableDecl.
          } else {
            // After a number, an adjacent IDENT must be a unit suffix —
            // the grammar has no implicit multiplication. Treat the unknown
            // name as a broken unit, emit a diagnostic, and still consume
            // it to avoid cascading errors.
            this.advance()
            this.diagnose(
              next,
              `unknown unit '${next.lexeme}'`,
              `add 'UNIT <Dimension> ${next.lexeme}' or 'UNIT <Dimension> ${next.lexeme} (<expr>)'`,
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
      case "IDENT": {
        this.advance()
        // IDENT immediately followed by '(' is a function call. There's no
        // implicit multiplication in the grammar, so the only meaning of
        // `name(...)` is application.
        if (this.peek().kind === "LPAREN") {
          this.advance()
          const args: Expr[] = []
          this.skipNewlines()
          if (this.peek().kind !== "RPAREN") {
            const first = this.parseExpressionRule()
            if (!first) return null
            args.push(first)
            while (this.peek().kind === "COMMA") {
              this.advance()
              this.skipNewlines()
              const a = this.parseExpressionRule()
              if (!a) return null
              args.push(a)
            }
          }
          this.skipNewlines()
          if (!this.expect("RPAREN")) return null
          return { type: "call", callee: t.lexeme, args, pos: pos(t) }
        }
        return { type: "ident", name: t.lexeme, pos: pos(t) }
      }
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

function startsUppercase(s: string): boolean {
  const c = s[0]
  return !!c && c >= "A" && c <= "Z"
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

export function parseProgram(
  tokens: readonly Token[],
  seedUnitNames?: ReadonlySet<string>,
): ProgramResult {
  // Names from this chunk + any names the caller already knows about
  // (used by the REPL so units declared on earlier lines aren't
  // diagnosed as 'unknown' on later ones).
  const fromChunk = collectUnitNames(tokens)
  const unitNames = seedUnitNames
    ? new Set([...seedUnitNames, ...fromChunk])
    : fromChunk
  const p = new Parser(tokens, unitNames)
  const program = p.parseProgram()
  return { program, diagnostics: p.diagnostics }
}
