import { tokenize } from "../src/lexer/lexer.ts"
import { parseProgram } from "../src/parser/parser.ts"
import { evaluateProgram } from "../src/eval/evaluator.ts"

const src = await Bun.file("frontend/index.ts").text()
const start = src.indexOf("const STARTER = `") + "const STARTER = `".length
const end = src.indexOf("`", start)
const starter = src.slice(start, end).replace(/\\`/g, "`")

const { tokens, diagnostics: lexDiags } = tokenize(starter)
if (lexDiags.length) {
  console.error("LEX diagnostics:")
  for (const d of lexDiags) console.error(`  ${d.line}:${d.col}  ${d.message}`)
  process.exit(1)
}
const { program, diagnostics: parseDiags } = parseProgram(tokens)
if (parseDiags.length) {
  console.error("PARSE diagnostics:")
  for (const d of parseDiags) console.error(`  ${d.line}:${d.col}  ${d.message}`)
  process.exit(1)
}
const { diagnostics: evalDiags } = evaluateProgram(program)
if (evalDiags.length) {
  console.error("EVAL diagnostics:")
  for (const d of evalDiags) console.error(`  ${d.line}:${d.col}  ${d.message}`)
  process.exit(1)
}
console.log("STARTER OK — no diagnostics")
