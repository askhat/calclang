import { error as mkError, type Diagnostic } from "../errors/diagnostic.ts"
import type { Position } from "../parser/ast.ts"

/**
 * Runtime error during evaluation, carrying the source position of the AST
 * node that triggered it. Wraps lower-level errors (UnitError from
 * src/units/) via `EvalError.from(err, pos)`.
 */
export class EvalError extends Error {
  readonly pos: Position
  readonly hint: string | undefined

  constructor(message: string, pos: Position, hint?: string) {
    super(message)
    this.name = "EvalError"
    this.pos = pos
    this.hint = hint
  }

  static from(err: unknown, pos: Position): EvalError {
    if (err instanceof EvalError) return err
    if (err instanceof Error) {
      const hint = (err as Error & { hint?: string }).hint
      return new EvalError(err.message, pos, hint)
    }
    return new EvalError(String(err), pos)
  }

  toDiagnostic(): Diagnostic {
    return mkError(this.message, this.pos.line, this.pos.col, this.hint)
  }
}
