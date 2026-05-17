export type TokenKind =
  // literals & names
  | "NUMBER"
  | "IDENT"
  // keywords
  | "UNIT"
  | "SERIES"
  | "AS"
  | "IF"
  | "THEN"
  | "ELSE"
  | "AND"
  | "OR"
  | "NOT"
  // operators
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "CARET"
  | "EQ"
  | "EQEQ"
  | "NEQ"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE"
  | "QUESTION"
  | "COLON"
  | "DOT"
  | "LPAREN"
  | "RPAREN"
  // structural
  | "NEWLINE"
  | "EOF"

export type Token = {
  kind: TokenKind
  /** Exact source text — used for error messages. */
  lexeme: string
  /**
   * Normalized value. For NUMBER, locale-independent form parsable by
   * Decimal (e.g. "1000.5" for source "1_000,5"). For other tokens this
   * equals `lexeme`.
   */
  value: string
  /** 1-based, like editors. */
  line: number
  /** 1-based column where the lexeme starts. */
  col: number
}

// Note: 'UNIT' is intentionally case-sensitive uppercase to leave lowercase
// 'unit' free as a regular identifier. Dimensions follow the same Capitalized
// convention (parser enforces). Other keywords stay lowercase.
export const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  UNIT: "UNIT",
  SERIES: "SERIES",
  as: "AS",
  if: "IF",
  then: "THEN",
  else: "ELSE",
  and: "AND",
  or: "OR",
  not: "NOT",
}
