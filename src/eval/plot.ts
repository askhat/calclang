import Decimal from "decimal.js"
import type { PlotInstr, Position } from "../parser/ast.ts"
import type { Quantity } from "../units/quantity.ts"
import { EvalError } from "./errors.ts"

/**
 * A single drawable primitive in a finished plot. The evaluator flattens
 * turtle moves (F/R/L) into LINE segments so a `PlotValue` is always a
 * simple list of these shapes — frontend rendering doesn't need to know
 * about turtle state.
 */
export type Shape =
  | { kind: "line"; x1: Decimal; y1: Decimal; x2: Decimal; y2: Decimal }
  | { kind: "rect"; x: Decimal; y: Decimal; w: Decimal; h: Decimal }
  | { kind: "circle"; cx: Decimal; cy: Decimal; r: Decimal }
  | { kind: "point"; x: Decimal; y: Decimal }

export type PlotValue = {
  readonly kind: "plot"
  readonly shapes: readonly Shape[]
  /**
   * Renderer hint. "preserve" — keep X/Y proportions (a 50×50 turtle square
   * stays square in the SVG). "stretch" — fill the widget on both axes
   * (line charts with `index × value` need this to be readable).
   */
  readonly aspect: "preserve" | "stretch"
}

/**
 * Known opcodes with their fixed argument arity. Anything not listed here is
 * a runtime error — keeps the parser permissive and the validation table tiny.
 */
const OPCODES: Readonly<Record<string, number>> = {
  LINE: 4,
  RECT: 4,
  CIRCLE: 3,
  POINT: 2,
  F: 1,
  R: 1,
  L: 1,
}

export function knownOpcodes(): string[] {
  return Object.keys(OPCODES)
}

/**
 * Materialize a list of PLOT instructions into a flat shape list. `evalArg`
 * is supplied by the evaluator so each argument is a full expression with
 * access to the surrounding variable scope.
 */
export function compilePlot(
  instructions: readonly PlotInstr[],
  evalArg: (e: PlotInstr["args"][number]) => Decimal,
): PlotValue {
  const shapes: Shape[] = []
  const turtle = { x: new Decimal(0), y: new Decimal(0), heading: new Decimal(0) }
  // Block form is for hand-drawn shapes; preserve aspect so squares stay square.

  for (const instr of instructions) {
    const arity = OPCODES[instr.op]
    if (arity === undefined) {
      throw new EvalError(
        `unknown plot instruction '${instr.op}'`,
        instr.pos,
        `known: ${knownOpcodes().join(", ")}`,
      )
    }
    if (instr.args.length !== arity) {
      throw new EvalError(
        `'${instr.op}' expects ${arity} argument${arity === 1 ? "" : "s"}, got ${instr.args.length}`,
        instr.pos,
      )
    }
    const a = instr.args.map(evalArg)
    switch (instr.op) {
      case "LINE":
        shapes.push({ kind: "line", x1: a[0]!, y1: a[1]!, x2: a[2]!, y2: a[3]! })
        break
      case "RECT":
        shapes.push({ kind: "rect", x: a[0]!, y: a[1]!, w: a[2]!, h: a[3]! })
        break
      case "CIRCLE":
        shapes.push({ kind: "circle", cx: a[0]!, cy: a[1]!, r: a[2]! })
        break
      case "POINT":
        shapes.push({ kind: "point", x: a[0]!, y: a[1]! })
        break
      case "F": {
        const dist = a[0]!
        const rad = headingToRadians(turtle.heading)
        const nx = turtle.x.plus(dist.times(Math.cos(rad)))
        const ny = turtle.y.plus(dist.times(Math.sin(rad)))
        shapes.push({ kind: "line", x1: turtle.x, y1: turtle.y, x2: nx, y2: ny })
        turtle.x = nx
        turtle.y = ny
        break
      }
      case "R":
        turtle.heading = turtle.heading.plus(a[0]!)
        break
      case "L":
        turtle.heading = turtle.heading.minus(a[0]!)
        break
      default:
        // Unreachable: arity check above already gate-keeps known opcodes.
        throw new EvalError(
          `unhandled plot opcode '${instr.op}'`,
          instr.pos,
        )
    }
  }
  return { kind: "plot", shapes, aspect: "preserve" }
}

/**
 * Turtle heading is in degrees, 0° pointing east (positive X), increasing
 * clockwise (so R 90 turns from east to south — matching screen coordinates
 * where Y grows downward, which is how SVG renders too).
 */
function headingToRadians(deg: Decimal): number {
  return (deg.toNumber() * Math.PI) / 180
}

export function isPlot(v: unknown): v is PlotValue {
  return typeof v === "object" && v !== null && "kind" in v &&
    (v as { kind: unknown }).kind === "plot"
}

/**
 * Auto-chart a series or range as a polyline: each member is one Y sample,
 * X is its index. Adjacent samples become LINE segments. Singleton input
 * degenerates to a POINT; empty input to an empty plot. Units on the members
 * are stripped — the renderer is unit-agnostic for now.
 *
 * Y values are stored NEGATED so an SVG renderer (Y-grows-downward) places
 * higher chart values higher on screen with no per-shape flip. Turtle and
 * geometric primitives keep raw screen-Y-down coords, so the renderer can
 * treat every PlotValue uniformly.
 */
export function dataPlotFromMembers(members: readonly Quantity[]): PlotValue {
  if (members.length === 0) {
    return { kind: "plot", shapes: [], aspect: "stretch" }
  }
  if (members.length === 1) {
    return {
      kind: "plot",
      shapes: [{ kind: "point", x: new Decimal(0), y: members[0]!.value.neg() }],
      aspect: "stretch",
    }
  }
  const shapes: Shape[] = []
  for (let i = 0; i < members.length - 1; i++) {
    shapes.push({
      kind: "line",
      x1: new Decimal(i),
      y1: members[i]!.value.neg(),
      x2: new Decimal(i + 1),
      y2: members[i + 1]!.value.neg(),
    })
  }
  return { kind: "plot", shapes, aspect: "stretch" }
}
