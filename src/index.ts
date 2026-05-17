import { runFile, type RunOptions } from "./cli.ts"
import { runRepl } from "./repl/repl.ts"

const argv = Bun.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith("--")))
const positional = argv.filter((a) => !a.startsWith("--"))
const path = positional[0]

if (flags.has("--help") || flags.has("-h")) {
  console.log("usage: calc [--tokens|--ast] [<file.calc>]")
  console.log("  with no file, starts a REPL (Ctrl+D / :exit to leave)")
  process.exit(0)
}

if (!path) {
  // No file → interactive REPL.
  await runRepl()
  process.exit(0)
}

const opts: RunOptions = {
  tokens: flags.has("--tokens"),
  ast: flags.has("--ast"),
}
await runFile(path, opts)
