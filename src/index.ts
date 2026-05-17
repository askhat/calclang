import { runFile } from "./cli.ts"

const path = Bun.argv[2]

if (!path) {
  console.error("usage: calc <file.calc>")
  process.exit(1)
}

await runFile(path)
