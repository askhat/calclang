import { runFile, type RunOptions } from "./cli.ts"

const argv = Bun.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith("--")))
const positional = argv.filter((a) => !a.startsWith("--"))
const path = positional[0]

if (!path) {
  console.error("usage: calc [--tokens] <file.calc>")
  process.exit(1)
}

const opts: RunOptions = { tokens: flags.has("--tokens") }
await runFile(path, opts)
