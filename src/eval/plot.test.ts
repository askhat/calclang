import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { parseProgram } from "../parser/parser.ts"
import { evaluateProgram } from "./evaluator.ts"
import { isPlotValue } from "./value.ts"

function run(src: string) {
  const { tokens } = tokenize(src)
  const { program } = parseProgram(tokens)
  return evaluateProgram(program)
}

function plotOf(src: string) {
  const { results, diagnostics } = run(src)
  expect(diagnostics).toEqual([])
  const r = results[results.length - 1]!
  expect(r.error).toBeNull()
  expect(r.value).not.toBeNull()
  if (!isPlotValue(r.value!)) throw new Error("expected PlotValue")
  return r.value
}

describe("PLOT — geometric primitives", () => {
  test("empty plot has zero shapes", () => {
    const p = plotOf("PLOT empty\n")
    expect(p.shapes).toEqual([])
  })

  test("LINE produces a line shape", () => {
    const p = plotOf(["PLOT p", "LINE 0 0 10 20"].join("\n"))
    expect(p.shapes).toHaveLength(1)
    const s = p.shapes[0]!
    expect(s.kind).toBe("line")
    if (s.kind !== "line") return
    expect(s.x1.toString()).toBe("0")
    expect(s.y1.toString()).toBe("0")
    expect(s.x2.toString()).toBe("10")
    expect(s.y2.toString()).toBe("20")
  })

  test("RECT, CIRCLE, POINT each produce their own shape", () => {
    const p = plotOf(
      [
        "PLOT p",
        "RECT 1 2 30 40",
        "CIRCLE 5 5 3",
        "POINT 7 8",
      ].join("\n"),
    )
    expect(p.shapes.map((s) => s.kind)).toEqual(["rect", "circle", "point"])
  })

  test("arguments evaluate as expressions (vars and arithmetic)", () => {
    // Note: putting `IDENT(...)` next to each other parses as a function call
    // by the surrounding grammar, so use bare arithmetic for compound args
    // (or pre-compute into a variable).
    const p = plotOf(
      [
        "10 cx",
        "PLOT p",
        "CIRCLE cx cx + 5 3",
      ].join("\n"),
    )
    expect(p.shapes).toHaveLength(1)
    const s = p.shapes[0]!
    if (s.kind !== "circle") throw new Error("kind mismatch")
    expect(s.cx.toString()).toBe("10")
    expect(s.cy.toString()).toBe("15")
    expect(s.r.toString()).toBe("3")
  })

  test("parenthesized expressions work as args when no IDENT precedes '('", () => {
    const p = plotOf(["PLOT p", "CIRCLE 0 0 (5 + 5)"].join("\n"))
    const s = p.shapes[0]!
    if (s.kind !== "circle") throw new Error("kind mismatch")
    expect(s.r.toString()).toBe("10")
  })
})

describe("PLOT — turtle primitives compile to lines", () => {
  test("F advances east by default and emits one LINE", () => {
    const p = plotOf(["PLOT p", "F 10"].join("\n"))
    expect(p.shapes).toHaveLength(1)
    const s = p.shapes[0]!
    if (s.kind !== "line") throw new Error("kind mismatch")
    expect(s.x1.toString()).toBe("0")
    expect(s.y1.toString()).toBe("0")
    expect(s.x2.toString()).toBe("10")
    // y stays at 0 (or within rounding of 0)
    expect(Number(s.y2.toString())).toBeCloseTo(0, 10)
  })

  test("R 90 + F draws south (y grows)", () => {
    const p = plotOf(["PLOT p", "R 90", "F 5"].join("\n"))
    expect(p.shapes).toHaveLength(1)
    const s = p.shapes[0]!
    if (s.kind !== "line") throw new Error("kind mismatch")
    expect(Number(s.x2.toString())).toBeCloseTo(0, 10)
    expect(Number(s.y2.toString())).toBeCloseTo(5, 10)
  })

  test("turtle state accumulates across multiple commands", () => {
    const p = plotOf(
      ["PLOT p", "F 10", "R 90", "F 10", "R 90", "F 10"].join("\n"),
    )
    expect(p.shapes).toHaveLength(3)
    expect(p.shapes.every((s) => s.kind === "line")).toBe(true)
  })

  test("L is the inverse of R for direction", () => {
    const a = plotOf(["PLOT a", "R 90", "F 5"].join("\n"))
    const b = plotOf(["PLOT b", "L 90", "F 5"].join("\n"))
    const sa = a.shapes[0]!
    const sb = b.shapes[0]!
    if (sa.kind !== "line" || sb.kind !== "line") throw new Error("kind mismatch")
    // After R 90 heading is south (+y); after L 90 heading is north (-y).
    expect(Number(sa.y2.toString())).toBeCloseTo(5, 10)
    expect(Number(sb.y2.toString())).toBeCloseTo(-5, 10)
  })
})

describe("PLOT — validation", () => {
  test("unknown opcode is a runtime error", () => {
    const { diagnostics } = run("PLOT p\nFOO 1 2 3")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/unknown plot instruction/)
  })

  test("wrong arity is a runtime error", () => {
    const { diagnostics } = run("PLOT p\nLINE 1 2 3")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/'LINE' expects 4 argument/)
  })

  test("arguments must be dimensionless", () => {
    const src = ["UNIT Length m", "PLOT p", "LINE 0 0 5 m 10"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/dimensionless/)
  })

  test("duplicate plot name is a collect-time error", () => {
    const src = ["PLOT p", "LINE 0 0 1 1", "PLOT p", "CIRCLE 5 5 3"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/plot 'p' is already declared/)
  })

  test("plot name collides with a variable", () => {
    const src = ["10 p", "PLOT p", "LINE 0 0 1 1"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/already declared/)
  })
})

describe("PLOT — one-liner (auto-chart from series/range)", () => {
  test("series of N members yields N-1 LINE segments (Y is negated for renderer)", () => {
    const src = [
      "SERIES prices",
      "100",
      "120",
      "130",
      "",
      "PLOT chart prices",
    ].join("\n")
    const p = plotOf(src)
    expect(p.shapes).toHaveLength(2)
    const s0 = p.shapes[0]!
    const s1 = p.shapes[1]!
    if (s0.kind !== "line" || s1.kind !== "line") throw new Error("kind mismatch")
    expect(s0.x1.toString()).toBe("0")
    expect(s0.y1.toString()).toBe("-100")
    expect(s0.x2.toString()).toBe("1")
    expect(s0.y2.toString()).toBe("-120")
    expect(s1.x1.toString()).toBe("1")
    expect(s1.x2.toString()).toBe("2")
    expect(s1.y2.toString()).toBe("-130")
  })

  test("range works the same way", () => {
    const src = ["RANGE r 1 4", "PLOT chart r"].join("\n")
    const p = plotOf(src)
    expect(p.shapes).toHaveLength(3)
    expect(p.shapes.every((s) => s.kind === "line")).toBe(true)
  })

  test("singleton series degenerates to a POINT", () => {
    const src = ["SERIES s", "42", "", "PLOT chart s"].join("\n")
    const p = plotOf(src)
    expect(p.shapes).toHaveLength(1)
    expect(p.shapes[0]!.kind).toBe("point")
  })

  test("series units are stripped (renderer is unit-agnostic)", () => {
    const src = [
      "UNIT Currency rub",
      "SERIES prices",
      "100 rub",
      "120 rub",
      "",
      "PLOT chart prices",
    ].join("\n")
    const p = plotOf(src)
    expect(p.shapes).toHaveLength(1)
    const s = p.shapes[0]!
    if (s.kind !== "line") throw new Error("kind mismatch")
    expect(s.y1.toString()).toBe("-100")
    expect(s.y2.toString()).toBe("-120")
  })

  test("ref to a variable produces a clear error", () => {
    const src = ["10 x", "PLOT chart x"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/'x' is a variable/)
  })

  test("ref to a missing name suggests close matches", () => {
    const src = ["SERIES prices", "1", "2", "", "PLOT chart pries"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/undefined series or range/)
    expect(diagnostics[0]!.hint).toMatch(/prices/)
  })
})

describe("PLOT — first-class value", () => {
  test("identifier reference returns the PlotValue", () => {
    const { results, diagnostics } = run(
      ["PLOT pic", "LINE 0 0 1 1", "", "pic"].join("\n"),
    )
    expect(diagnostics).toEqual([])
    const last = results[results.length - 1]!
    expect(last.value).not.toBeNull()
    expect(isPlotValue(last.value!)).toBe(true)
  })

  test("readyPlots iterator exposes the plot", () => {
    const { tokens } = tokenize("PLOT pic\nLINE 0 0 1 1\n")
    const { program } = parseProgram(tokens)
    const ev = new (require("./evaluator.ts").Evaluator)()
    ev.feed(program)
    const plots = [...ev.readyPlots()]
    expect(plots).toHaveLength(1)
    expect(plots[0][0]).toBe("pic")
  })
})
