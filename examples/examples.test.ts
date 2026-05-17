import { describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { evaluateProgram } from "../src/eval/evaluator.ts"
import { annotateSource } from "../src/format/output.ts"
import { tokenize } from "../src/lexer/lexer.ts"
import { parseProgram } from "../src/parser/parser.ts"

const dir = import.meta.dir

async function run(source: string): Promise<string> {
  const { tokens } = tokenize(source)
  const { program } = parseProgram(tokens)
  const { results } = evaluateProgram(program)
  let out = annotateSource(source, results)
  // Match how the CLI prints — append a final newline if missing.
  if (!out.endsWith("\n")) out += "\n"
  return out
}

describe("golden tests: examples/*.calc", async () => {
  const entries = await readdir(dir)
  const calcFiles = entries
    .filter((f) => f.endsWith(".calc"))
    .filter((f) => entries.includes(`${f}.expected`))

  if (calcFiles.length === 0) {
    test("no expected files found — did you forget to commit them?", () => {
      expect(calcFiles.length).toBeGreaterThan(0)
    })
    return
  }

  for (const file of calcFiles) {
    test(file, async () => {
      const src = await Bun.file(`${dir}/${file}`).text()
      const expected = await Bun.file(`${dir}/${file}.expected`).text()
      const actual = await run(src)
      expect(actual).toBe(expected)
    })
  }
})
