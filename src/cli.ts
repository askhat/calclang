import { formatDiagnostic, type Diagnostic } from "./errors/diagnostic.ts"
import { tokenize } from "./lexer/lexer.ts"
import type { Token } from "./lexer/token.ts"
import { showExpr } from "./parser/ast.ts"
import { parseExpression } from "./parser/parser.ts"

export type RunOptions = {
  tokens?: boolean
  ast?: boolean
}

export async function runFile(
  path: string,
  opts: RunOptions = {},
): Promise<void> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    console.error(`calc: file not found: ${path}`)
    process.exit(1)
  }
  const source = await file.text()

  if (opts.tokens) {
    dumpTokens(source, path)
    return
  }

  if (opts.ast) {
    dumpAst(source, path)
    return
  }

  process.stdout.write(source)
}

function dumpTokens(source: string, path: string): void {
  const { tokens, diagnostics } = tokenize(source)
  for (const t of tokens) {
    console.log(formatToken(t))
  }
  reportDiagnostics(diagnostics, path)
}

function dumpAst(source: string, path: string): void {
  const { tokens, diagnostics: lexErrors } = tokenize(source)
  reportDiagnostics(lexErrors, path)
  const { expr, diagnostics: parseErrors } = parseExpression(tokens)
  reportDiagnostics(parseErrors, path)
  if (expr) console.log(showExpr(expr))
  if (lexErrors.length + parseErrors.length > 0) process.exit(1)
}

function reportDiagnostics(diagnostics: readonly Diagnostic[], path: string): void {
  for (const d of diagnostics) {
    console.error(formatDiagnostic(d, path))
  }
}

function formatToken(t: Token): string {
  const pos = `${t.line}:${t.col}`.padEnd(7)
  const kind = t.kind.padEnd(8)
  switch (t.kind) {
    case "NEWLINE":
    case "EOF":
      return `${pos} ${kind}`
    case "NUMBER":
      return t.lexeme === t.value
        ? `${pos} ${kind} ${t.lexeme}`
        : `${pos} ${kind} ${t.lexeme} → ${t.value}`
    default:
      return `${pos} ${kind} ${t.lexeme}`
  }
}
