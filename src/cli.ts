import type { Diagnostic } from "./errors/diagnostic.ts"
import { evaluateProgram } from "./eval/evaluator.ts"
import { annotateSource, formatDiagnosticColored } from "./format/output.ts"
import { tokenize } from "./lexer/lexer.ts"
import type { Token } from "./lexer/token.ts"
import { showProgram } from "./parser/ast.ts"
import { parseProgram } from "./parser/parser.ts"

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

  evalAndPrint(source, path)
}

function dumpTokens(source: string, path: string): void {
  const { tokens, diagnostics } = tokenize(source)
  for (const t of tokens) {
    console.log(formatToken(t))
  }
  reportDiagnostics(diagnostics, path)
  if (diagnostics.length > 0) process.exit(1)
}

function dumpAst(source: string, path: string): void {
  const { tokens, diagnostics: lexErrors } = tokenize(source)
  reportDiagnostics(lexErrors, path)
  const { program, diagnostics: parseErrors } = parseProgram(tokens)
  reportDiagnostics(parseErrors, path)
  if (program.statements.length > 0) console.log(showProgram(program))
  if (lexErrors.length + parseErrors.length > 0) process.exit(1)
}

function evalAndPrint(source: string, path: string): void {
  const { tokens, diagnostics: lexErrors } = tokenize(source)
  const { program, diagnostics: parseErrors } = parseProgram(tokens)
  const { results, diagnostics: evalErrors } = evaluateProgram(program)

  // Print the annotated source — line annotations are how the user reads
  // both successes and per-line errors.
  process.stdout.write(annotateSource(source, results))
  if (!source.endsWith("\n")) process.stdout.write("\n")

  // Lex and parse errors don't have per-line annotations; show them in a
  // trailing block. Eval errors are already inline in the annotation.
  const beforeEval = [...lexErrors, ...parseErrors]
  if (beforeEval.length > 0) {
    process.stderr.write("\n")
    reportDiagnostics(beforeEval, path)
  }

  if (lexErrors.length + parseErrors.length + evalErrors.length > 0) {
    process.exit(1)
  }
}

function reportDiagnostics(
  diagnostics: readonly Diagnostic[],
  path: string,
): void {
  for (const d of diagnostics) {
    console.error(formatDiagnosticColored(d, path))
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
