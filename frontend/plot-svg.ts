import Decimal from "decimal.js"
import type { PlotValue, Shape } from "../src/eval/plot.ts"
import { formatDecimal } from "../src/format/output.ts"

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

  if (plot.shapes.length === 0 && !plot.viewport) {
    svg.setAttribute("viewBox", "0 0 1 1")
    svg.setAttribute(
      "preserveAspectRatio",
      plot.aspect === "stretch" ? "none" : "xMidYMid meet",
    )
    return svg
  }

  // Explicit viewport from a `SIZE w h` directive wins over auto-fit. With
  // no shapes but a SIZE set, we still render an empty canvas of the chosen
  // dimensions.
  let viewMinX: number
  let viewMinY: number
  let viewW: number
  let viewH: number
  if (plot.viewport) {
    viewMinX = plot.viewport.minX.toNumber()
    viewMinY = plot.viewport.minY.toNumber()
    viewW = plot.viewport.w.toNumber()
    viewH = plot.viewport.h.toNumber()
  } else {
    const bb = bbox(plot.shapes)
    // Zero-extent axes get a small visible span so the lone shape isn't lost
    // at a viewBox corner.
    const spanX = bb.maxX === bb.minX ? 1 : bb.maxX - bb.minX
    const spanY = bb.maxY === bb.minY ? 1 : bb.maxY - bb.minY
    const padX = spanX * padding
    const padY = spanY * padding
    viewMinX = bb.minX - padX
    viewMinY = bb.minY - padY
    viewW = spanX + padX * 2
    viewH = spanY + padY * 2
  }
  svg.setAttribute("viewBox", `${viewMinX} ${viewMinY} ${viewW} ${viewH}`)
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
  const diag = Math.hypot(viewW, viewH)
  const strokeWidth = 1.5
  const pointRadius = diag * 0.012

  for (const shape of plot.shapes) {
    svg.appendChild(emit(shape, strokeWidth, pointRadius))
  }
  // Data charts: attach invisible "hit circles" at each vertex (line endpoint
  // or POINT) so the user can hover to see `(index, value)`. Y is stored
  // negated for stretch plots (see dataPlotFromMembers); un-negate for the
  // tooltip label.
  if (plot.aspect === "stretch") {
    for (const v of vertices(plot.shapes)) {
      svg.appendChild(makeHitCircle(v, pointRadius * 1.6))
    }
  }
  return svg
}

type Vertex = { x: Decimal; y: Decimal }

function vertices(shapes: readonly Shape[]): Vertex[] {
  const seen = new Set<string>()
  const out: Vertex[] = []
  const push = (x: Decimal, y: Decimal) => {
    const key = `${x.toString()}|${y.toString()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ x, y })
  }
  for (const s of shapes) {
    if (s.kind === "line") {
      push(s.x1, s.y1)
      push(s.x2, s.y2)
    } else if (s.kind === "point") {
      push(s.x, s.y)
    }
  }
  return out
}

function makeHitCircle(v: Vertex, radius: number): SVGElement {
  const el = document.createElementNS(NS, "circle")
  el.setAttribute("cx", v.x.toString())
  el.setAttribute("cy", v.y.toString())
  el.setAttribute("r", String(radius))
  el.setAttribute("fill", "transparent")
  el.setAttribute("class", "calc-plot-vertex")
  el.style.cursor = "pointer"
  el.addEventListener("mouseenter", (ev) => {
    // Index = X (as written); value = -Y (we negated at construction time).
    const label = `(${v.x.toString()}, ${formatDecimal(v.y.neg())})`
    showTooltip(label, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY)
  })
  el.addEventListener("mousemove", (ev) => {
    const tooltip = getTooltip()
    tooltip.style.left = `${(ev as MouseEvent).clientX + 12}px`
    tooltip.style.top = `${(ev as MouseEvent).clientY + 12}px`
  })
  el.addEventListener("mouseleave", () => hideTooltip())
  return el
}

let _tooltipEl: HTMLElement | null = null

function getTooltip(): HTMLElement {
  if (_tooltipEl && _tooltipEl.isConnected) return _tooltipEl
  const el = document.createElement("div")
  el.className = "cm-plot-tooltip"
  el.style.position = "fixed"
  el.style.display = "none"
  document.body.appendChild(el)
  _tooltipEl = el
  return el
}

function showTooltip(text: string, x: number, y: number): void {
  const t = getTooltip()
  t.textContent = text
  t.style.left = `${x + 12}px`
  t.style.top = `${y + 12}px`
  t.style.display = "block"
}

function hideTooltip(): void {
  if (_tooltipEl) _tooltipEl.style.display = "none"
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
      case "text":
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
      el.setAttribute("stroke", shape.color ?? "currentColor")
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
      el.setAttribute("stroke", shape.color ?? "currentColor")
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
      el.setAttribute("stroke", shape.color ?? "currentColor")
      el.setAttribute("stroke-width", String(strokeWidth))
      el.setAttribute("vector-effect", "non-scaling-stroke")
      return el
    }
    case "point": {
      const el = document.createElementNS(NS, "circle")
      el.setAttribute("cx", shape.x.toString())
      el.setAttribute("cy", shape.y.toString())
      el.setAttribute("r", String(pointRadius))
      el.setAttribute("fill", shape.color ?? "currentColor")
      return el
    }
    case "text": {
      const el = document.createElementNS(NS, "text")
      el.setAttribute("x", shape.x.toString())
      el.setAttribute("y", shape.y.toString())
      el.setAttribute("fill", shape.color ?? "currentColor")
      // Font sized in viewBox units off the diagonal so labels stay legible
      // at any plot scale. `non-scaling-stroke` doesn't apply to text fill.
      el.setAttribute("font-size", String(pointRadius * 2))
      el.setAttribute("dominant-baseline", "middle")
      el.setAttribute("text-anchor", "middle")
      el.style.fontFamily = "inherit"
      el.textContent = shape.text
      return el
    }
  }
}
