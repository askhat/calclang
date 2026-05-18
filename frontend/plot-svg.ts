import type { PlotValue, Shape } from "../src/eval/plot.ts"

const NS = "http://www.w3.org/2000/svg"

export type PlotSVGOptions = {
  width: number
  height: number
  /** Padding in viewBox units, applied inside the computed bounds. */
  padding: number
}

const DEFAULTS: PlotSVGOptions = {
  width: 360,
  height: 220,
  padding: 0.08,
}

/**
 * Pure renderer: PlotValue → inline SVGSVGElement. Bounds are computed from
 * the shapes themselves and viewBox is sized to fit with a small relative
 * padding. Y is taken at face value — `dataPlotFromMembers` already negates
 * chart values so that "bigger is up" maps onto SVG's Y-grows-down convention.
 */
export function renderPlotSVG(
  plot: PlotValue,
  opts: Partial<PlotSVGOptions> = {},
): SVGSVGElement {
  const { width, height, padding } = { ...DEFAULTS, ...opts }
  const svg = document.createElementNS(NS, "svg")
  svg.setAttribute("width", String(width))
  svg.setAttribute("height", String(height))
  svg.setAttribute("class", "calc-plot")
  svg.setAttribute("xmlns", NS)

  if (plot.shapes.length === 0) {
    svg.setAttribute("viewBox", "0 0 1 1")
    svg.setAttribute(
      "preserveAspectRatio",
      plot.aspect === "stretch" ? "none" : "xMidYMid meet",
    )
    return svg
  }

  const bb = bbox(plot.shapes)
  // Zero-extent axes get a small visible span so the lone shape isn't lost
  // at a viewBox corner.
  const spanX = bb.maxX === bb.minX ? 1 : bb.maxX - bb.minX
  const spanY = bb.maxY === bb.minY ? 1 : bb.maxY - bb.minY
  const padX = spanX * padding
  const padY = spanY * padding
  svg.setAttribute(
    "viewBox",
    `${bb.minX - padX} ${bb.minY - padY} ${spanX + padX * 2} ${spanY + padY * 2}`,
  )
  // `stretch` plots (data charts) fill both axes for readability; `preserve`
  // plots (turtle/geometric) keep proportions so a 50×50 square stays square.
  svg.setAttribute(
    "preserveAspectRatio",
    plot.aspect === "stretch" ? "none" : "xMidYMid meet",
  )

  // With `preserveAspectRatio="none"` the X/Y scales differ, so a stroke set
  // in viewBox units would be uneven. `vector-effect: non-scaling-stroke`
  // (applied below per-shape) keeps the stroke pixel-true; we still need a
  // sensible viewBox-unit fallback for `pointRadius`, sized off the diagonal.
  const diag = Math.hypot(spanX + padX * 2, spanY + padY * 2)
  const strokeWidth = 1.5
  const pointRadius = diag * 0.012

  for (const shape of plot.shapes) {
    svg.appendChild(emit(shape, strokeWidth, pointRadius))
  }
  return svg
}

type BBox = { minX: number; minY: number; maxX: number; maxY: number }

function bbox(shapes: readonly Shape[]): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const seen = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const s of shapes) {
    switch (s.kind) {
      case "line":
        seen(s.x1.toNumber(), s.y1.toNumber())
        seen(s.x2.toNumber(), s.y2.toNumber())
        break
      case "rect": {
        const x = s.x.toNumber()
        const y = s.y.toNumber()
        seen(x, y)
        seen(x + s.w.toNumber(), y + s.h.toNumber())
        break
      }
      case "circle": {
        const cx = s.cx.toNumber()
        const cy = s.cy.toNumber()
        const r = s.r.toNumber()
        seen(cx - r, cy - r)
        seen(cx + r, cy + r)
        break
      }
      case "point":
        seen(s.x.toNumber(), s.y.toNumber())
        break
    }
  }
  return { minX, minY, maxX, maxY }
}

function emit(shape: Shape, strokeWidth: number, pointRadius: number): SVGElement {
  switch (shape.kind) {
    case "line": {
      const el = document.createElementNS(NS, "line")
      el.setAttribute("x1", shape.x1.toString())
      el.setAttribute("y1", shape.y1.toString())
      el.setAttribute("x2", shape.x2.toString())
      el.setAttribute("y2", shape.y2.toString())
      el.setAttribute("stroke", "currentColor")
      el.setAttribute("stroke-width", String(strokeWidth))
      el.setAttribute("vector-effect", "non-scaling-stroke")
      el.setAttribute("stroke-linecap", "round")
      return el
    }
    case "rect": {
      const el = document.createElementNS(NS, "rect")
      el.setAttribute("x", shape.x.toString())
      el.setAttribute("y", shape.y.toString())
      el.setAttribute("width", shape.w.toString())
      el.setAttribute("height", shape.h.toString())
      el.setAttribute("fill", "none")
      el.setAttribute("stroke", "currentColor")
      el.setAttribute("stroke-width", String(strokeWidth))
      el.setAttribute("vector-effect", "non-scaling-stroke")
      return el
    }
    case "circle": {
      const el = document.createElementNS(NS, "circle")
      el.setAttribute("cx", shape.cx.toString())
      el.setAttribute("cy", shape.cy.toString())
      el.setAttribute("r", shape.r.toString())
      el.setAttribute("fill", "none")
      el.setAttribute("stroke", "currentColor")
      el.setAttribute("stroke-width", String(strokeWidth))
      el.setAttribute("vector-effect", "non-scaling-stroke")
      return el
    }
    case "point": {
      const el = document.createElementNS(NS, "circle")
      el.setAttribute("cx", shape.x.toString())
      el.setAttribute("cy", shape.y.toString())
      el.setAttribute("r", String(pointRadius))
      el.setAttribute("fill", "currentColor")
      return el
    }
  }
}
