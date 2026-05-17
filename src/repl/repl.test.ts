import { describe, expect, test } from "bun:test"
import { Evaluator } from "../eval/evaluator.ts"
import { handleReplLine } from "./repl.ts"

describe("handleReplLine", () => {
  test("empty line is a no-op", () => {
    const r = handleReplLine("", new Evaluator())
    expect(r.stdoutLines).toEqual([])
    expect(r.stderrLines).toEqual([])
    expect(r.command).toBe("continue")
  })

  test("comment line is a no-op", () => {
    const r = handleReplLine("# just a note", new Evaluator())
    expect(r.stdoutLines).toEqual([])
  })

  test("bare expression prints '= value'", () => {
    const r = handleReplLine("1 + 2 * 3", new Evaluator())
    expect(r.stdoutLines).toEqual(["= 7"])
  })

  test("variable persists across calls (REPL state)", () => {
    const ev = new Evaluator()
    handleReplLine("10 x", ev)
    const r = handleReplLine("x * 4", ev)
    expect(r.stdoutLines).toEqual(["= 40"])
  })

  test("unit declaration is silent (no annotation)", () => {
    const r = handleReplLine("declare kg base mass", new Evaluator())
    expect(r.stdoutLines).toEqual([])
  })

  test("composite unit setup then expression", () => {
    const ev = new Evaluator()
    handleReplLine("declare kg base mass", ev)
    handleReplLine("declare gr (kg / 1_000)", ev)
    const r = handleReplLine("2500 gr as kg", ev)
    expect(r.stdoutLines).toEqual(["= 2,5 kg"])
  })

  test("eval error goes to stderr (or annotation), not stdout", () => {
    const r = handleReplLine("undefined + 1", new Evaluator())
    expect(r.stdoutLines.length).toBeGreaterThan(0) // annotation has the error
    expect(r.stdoutLines[0]).toContain("error:")
    expect(r.stdoutLines[0]).toContain("undefined name 'undefined'")
  })

  test("parse error goes to stderr", () => {
    const r = handleReplLine("1 +", new Evaluator())
    expect(r.stderrLines.length).toBeGreaterThan(0)
  })

  test(":exit returns the exit command", () => {
    const r = handleReplLine(":exit", new Evaluator())
    expect(r.command).toBe("exit")
  })

  test(":quit also exits", () => {
    expect(handleReplLine(":quit", new Evaluator()).command).toBe("exit")
  })

  test(":help lists commands", () => {
    const r = handleReplLine(":help", new Evaluator())
    expect(r.stdoutLines.join("\n")).toContain(":exit")
    expect(r.stdoutLines.join("\n")).toContain(":units")
    expect(r.stdoutLines.join("\n")).toContain(":vars")
  })

  test(":units lists registered units (after some declares)", () => {
    const ev = new Evaluator()
    handleReplLine("declare kg base mass", ev)
    handleReplLine("declare gr (kg / 1_000)", ev)
    const r = handleReplLine(":units", ev)
    const all = r.stdoutLines.join("\n")
    expect(all).toContain("kg")
    expect(all).toContain("gr")
    expect(all).toContain("mass")
  })

  test(":units when empty notes there are none", () => {
    const r = handleReplLine(":units", new Evaluator())
    expect(r.stdoutLines[0]).toContain("no units")
  })

  test(":vars lists bound variables", () => {
    const ev = new Evaluator()
    handleReplLine("10 x", ev)
    handleReplLine("20 y", ev)
    const r = handleReplLine(":vars", ev)
    const all = r.stdoutLines.join("\n")
    expect(all).toContain("x")
    expect(all).toContain("10")
    expect(all).toContain("y")
    expect(all).toContain("20")
  })

  test(":vars only lists ready (resolved) bindings", () => {
    const ev = new Evaluator()
    // 'x' references undefined 'foo' and won't resolve
    handleReplLine("foo + 1 = x", ev)
    const r = handleReplLine(":vars", ev)
    expect(r.stdoutLines[0]).toContain("no variables")
  })

  test("unknown command reports gracefully", () => {
    const r = handleReplLine(":notathing", new Evaluator())
    expect(r.stderrLines[0]).toContain("unknown command")
  })

  test("workflow: declare → bind → reference → conversion", () => {
    const ev = new Evaluator()
    handleReplLine("declare usd base currency", ev)
    handleReplLine("declare rub (usd / 90,5)", ev)
    handleReplLine("35,5 rub salary", ev)
    const r = handleReplLine("salary as usd", ev)
    // 35.5 / 90.5 ≈ 0.392265
    expect(r.stdoutLines[0]).toMatch(/= 0,3922\d+ usd/)
  })
})
