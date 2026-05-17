export type Severity = "error" | "warning"

export type Diagnostic = {
  severity: Severity
  message: string
  line: number
  col: number
  hint?: string
}

export function error(
  message: string,
  line: number,
  col: number,
  hint?: string,
): Diagnostic {
  return hint === undefined
    ? { severity: "error", message, line, col }
    : { severity: "error", message, line, col, hint }
}

export function formatDiagnostic(d: Diagnostic, sourceName = "<input>"): string {
  const head = `${sourceName}:${d.line}:${d.col}: ${d.severity}: ${d.message}`
  return d.hint ? `${head}\n  hint: ${d.hint}` : head
}
