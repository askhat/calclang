import { createInterface } from "node:readline"
import { Evaluator } from "../eval/evaluator.ts"
import { bold, cyan, gray } from "../format/color.ts"
import {
  DEFAULT_LOCALE,
  formatDiagnosticColored,
  formatValue,
  replLine,
  type Locale,
} from "../format/output.ts"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"

export type ReplCommand = "continue" | "exit"

export type ReplResult = {
  stdoutLines: string[]
  stderrLines: string[]
  command: ReplCommand
}

const BANNER = [
  `${bold("calc")} REPL — Ctrl+D or ${cyan(":exit")} to quit, ${cyan(":help")} for commands`,
]

export function handleReplLine(
  raw: string,
  ev: Evaluator,
  locale: Locale = DEFAULT_LOCALE,
): ReplResult {
  const stdoutLines: string[] = []
  const stderrLines: string[] = []
  const line = raw.trimEnd()

  if (line === "" || line.startsWith("#")) {
    return { stdoutLines, stderrLines, command: "continue" }
  }

  if (line.startsWith(":")) {
    return handleCommand(line, ev, locale)
  }

  const { tokens, diagnostics: lexErrors } = tokenize(line)
  for (const d of lexErrors) {
    stderrLines.push(formatDiagnosticColored(d, "<stdin>"))
  }
  if (lexErrors.length > 0) {
    return { stdoutLines, stderrLines, command: "continue" }
  }

  const { program, diagnostics: parseErrors } = parseProgram(
    tokens,
    ev.unitNames(),
  )
  for (const d of parseErrors) {
    stderrLines.push(formatDiagnosticColored(d, "<stdin>"))
  }
  if (parseErrors.length > 0) {
    return { stdoutLines, stderrLines, command: "continue" }
  }

  const results = ev.feed(program)
  for (const r of results) {
    const text = replLine(r, locale)
    if (text !== null) stdoutLines.push(text)
  }

  return { stdoutLines, stderrLines, command: "continue" }
}

function handleCommand(
  line: string,
  ev: Evaluator,
  locale: Locale,
): ReplResult {
  const cmd = line.slice(1).trim()
  const stdoutLines: string[] = []
  switch (cmd) {
    case "exit":
    case "quit":
    case "q":
      return { stdoutLines: [], stderrLines: [], command: "exit" }
    case "help":
      stdoutLines.push(`${cyan(":exit")} / ${cyan(":quit")}  — leave the REPL`)
      stdoutLines.push(`${cyan(":units")}          — list declared units`)
      stdoutLines.push(`${cyan(":vars")}           — list bound variables`)
      stdoutLines.push(`${cyan(":help")}           — this message`)
      return { stdoutLines, stderrLines: [], command: "continue" }
    case "units": {
      const units = [...ev.registry.all()]
      if (units.length === 0) {
        stdoutLines.push(gray("  (no units declared)"))
      } else {
        for (const u of units) {
          const dim = formatDimensionVector(u.dimension)
          const factor = u.factor.toString()
          stdoutLines.push(
            `  ${bold(u.name.padEnd(12))} ${dim.padEnd(20)} ${gray("factor:")} ${factor}`,
          )
        }
      }
      return { stdoutLines, stderrLines: [], command: "continue" }
    }
    case "vars": {
      const vars = [...ev.readyVariables()]
      if (vars.length === 0) {
        stdoutLines.push(gray("  (no variables bound)"))
      } else {
        for (const [name, value] of vars) {
          stdoutLines.push(`  ${bold(name.padEnd(16))} ${formatValue(value, locale)}`)
        }
      }
      return { stdoutLines, stderrLines: [], command: "continue" }
    }
    default:
      return {
        stdoutLines: [],
        stderrLines: [`unknown command: ${cmd}; try :help`],
        command: "continue",
      }
  }
}

function formatDimensionVector(d: Readonly<Record<string, number>>): string {
  const entries = Object.entries(d)
  if (entries.length === 0) return "dimensionless"
  return entries
    .map(([k, v]) => (v === 1 ? k : `${k}^${v}`))
    .join("·")
}

export async function runRepl(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  const ev = new Evaluator()
  for (const line of BANNER) console.log(line)
  rl.setPrompt(cyan("calc> "))

  rl.on("line", (line) => {
    const r = handleReplLine(line, ev)
    for (const s of r.stdoutLines) console.log(s)
    for (const s of r.stderrLines) console.error(s)
    if (r.command === "exit") {
      rl.close()
      return
    }
    rl.prompt()
  })

  rl.on("close", () => {
    process.stdout.write("\n")
  })

  rl.prompt()

  // Keep the function alive until readline closes.
  await new Promise<void>((resolve) => rl.once("close", () => resolve()))
}
