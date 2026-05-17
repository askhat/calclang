/**
 * Runtime errors from the units / quantity machinery — dimension mismatches,
 * undefined conversions, division by zero, etc. The evaluator (stage 5)
 * catches these and wraps them in Diagnostic with the source position of the
 * offending AST node.
 */
export class UnitError extends Error {
  readonly hint: string | undefined

  constructor(message: string, hint?: string) {
    super(message)
    this.name = "UnitError"
    this.hint = hint
  }
}
