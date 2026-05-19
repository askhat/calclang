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
    // PLOT args are strict: each is one primary expression (no top-level
    // binary operators). Wrap arithmetic in parens.
    const p = plotOf(
      [
        "10 cx",
        "PLOT p",
        "CIRCLE cx (cx + 5) 3",
      ].join("\n"),
    )
    expect(p.shapes).toHaveLength(1)
    const s = p.shapes[0]!
    if (s.kind !== "circle") throw new Error("kind mismatch")
    expect(s.cx.toString()).toBe("10")
    expect(s.cy.toString()).toBe("15")
    expect(s.r.toString()).toBe("3")
  })

  test("parenthesized expressions work as args", () => {
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

  test("U lifts the pen — subsequent F doesn't draw, D resumes", () => {
    const p = plotOf(
      ["PLOT p", "F 10", "U", "F 10", "D", "F 10"].join("\n"),
    )
    // Only the first and last F emit lines (pen down, pen down).
    expect(p.shapes).toHaveLength(2)
    expect(p.shapes.every((s) => s.kind === "line")).toBe(true)
  })

  test("M jumps to absolute coords without drawing", () => {
    const p = plotOf(["PLOT p", "F 10", "M 100 100", "F 10"].join("\n"))
    // Two F's, M itself doesn't draw → 2 lines.
    expect(p.shapes).toHaveLength(2)
    const second = p.shapes[1]!
    if (second.kind !== "line") throw new Error("kind mismatch")
    // Second F starts from where M placed us — x1 should be 100.
    expect(second.x1.toString()).toBe("100")
    expect(second.y1.toString()).toBe("100")
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

describe("PLOT — explicit viewport (SIZE)", () => {
  test("SIZE sets the viewport on the PlotValue", () => {
    const p = plotOf(["PLOT p", "SIZE 200 100", "LINE 0 0 50 50"].join("\n"))
    expect(p.viewport).toBeDefined()
    expect(p.viewport!.w.toString()).toBe("200")
    expect(p.viewport!.h.toString()).toBe("100")
  })

  test("SIZE doesn't emit a shape on its own", () => {
    const p = plotOf(["PLOT p", "SIZE 100 100"].join("\n"))
    expect(p.shapes).toHaveLength(0)
    expect(p.viewport).toBeDefined()
  })

  test("last SIZE wins when repeated", () => {
    const p = plotOf(
      ["PLOT p", "SIZE 100 100", "LINE 0 0 1 1", "SIZE 50 50"].join("\n"),
    )
    expect(p.viewport!.w.toString()).toBe("50")
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

  test("arguments must be dimensionless — unit-named ident is rejected", () => {
    // Use parens so the unit ident is a single primary expression (not split
    // into two args). `(m)` evaluates to a unit-bearing quantity; the eval
    // step catches it as non-dimensionless.
    const src = ["UNIT Length m", "PLOT p", "LINE 0 0 (m) 10"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/dimensionless/)
  })

  test("a bare `NUMBER unit` suffix is rejected at parse time as wrong arity", () => {
    // Inside PLOT args, NUMBER does NOT consume a trailing IDENT as a unit,
    // so `5 m 10` is three separate args rather than `<5 m>` and `10`.
    const src = ["UNIT Length m", "PLOT p", "LINE 0 0 5 m 10"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/'LINE' expects 4 argument/)
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

describe("PLOT — TEXT primitive + string literals", () => {
  test("TEXT emits a text shape with x, y, content", () => {
    const p = plotOf(['PLOT p', 'TEXT 10 20 "hello"'].join("\n"))
    expect(p.shapes).toHaveLength(1)
    const s = p.shapes[0]!
    if (s.kind !== "text") throw new Error("kind mismatch")
    expect(s.x.toString()).toBe("10")
    expect(s.y.toString()).toBe("20")
    expect(s.text).toBe("hello")
  })

  test("TEXT rejects non-string third arg", () => {
    const { diagnostics } = run("PLOT p\nTEXT 0 0 42")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/must be a string literal/)
  })

  test("string literal outside PLOT TEXT errors", () => {
    const { diagnostics } = run('"hello"')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/string literals/)
  })

  test('TEXT supports escapes \\" and \\\\', () => {
    const p = plotOf(['PLOT p', 'TEXT 0 0 "say \\"hi\\""'].join("\n"))
    const s = p.shapes[0]!
    if (s.kind !== "text") throw new Error("kind mismatch")
    expect(s.text).toBe('say "hi"')
  })
})

describe("PLOT — multi-series overlay", () => {
  test("two series overlay with palette colors", () => {
    const src = [
      "SERIES a",
      "1",
      "2",
      "3",
      "",
      "SERIES b",
      "5",
      "4",
      "3",
      "",
      "PLOT compare a b",
    ].join("\n")
    const p = plotOf(src)
    expect(p.shapes).toHaveLength(4)
    // Layers are distinguished by color.
    const colors = new Set(p.shapes.map((s) => s.color))
    expect(colors.size).toBe(2)
  })

  test("single ref still works (no palette color)", () => {
    const src = ["SERIES s", "1", "2", "", "PLOT chart s"].join("\n")
    const p = plotOf(src)
    expect(p.shapes).toHaveLength(1)
    // Single layer: leaves color undefined so renderer uses currentColor.
    expect(p.shapes[0]!.color).toBeUndefined()
  })

  test("invalid ref among multiple is reported", () => {
    const src = ["SERIES a", "1", "2", "", "PLOT bad a foo"].join("\n")
    const { diagnostics } = run(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]!.message).toMatch(/undefined series or range/)
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
