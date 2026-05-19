import * as Dim from "../src/units/dimension.ts"
import { formatValue } from "../src/format/output.ts"
import type { EngineRun } from "./calc-engine.ts"

export type SidebarCallbacks = {
  /** Called when the user clicks a plot row — supplies the 1-based source line. */
  onPlotClick?: (line: number) => void
}

let callbacks: SidebarCallbacks = {}

export function setSidebarCallbacks(cb: SidebarCallbacks): void {
  callbacks = cb
}

const VARS_ID = "vars-list"
const SERIES_ID = "series-list"
const RANGES_ID = "ranges-list"
const FUNCTIONS_ID = "functions-list"
const PLOTS_ID = "plots-list"
const UNITS_ID = "units-list"
const DIAGS_ID = "diagnostics-list"

export function renderSidebar(run: EngineRun): void {
  renderVariables(run)
  renderSeries(run)
  renderRanges(run)
  renderFunctions(run)
  renderPlots(run)
  renderUnits(run)
  renderDiagnostics(run)
}

function renderVariables(run: EngineRun): void {
  const list = document.getElementById(VARS_ID)
  if (!list) return
  list.innerHTML = ""
  if (run.variables.length === 0) {
    list.appendChild(emptyItem("(none yet)"))
    return
  }
  for (const v of run.variables) {
    const li = document.createElement("li")
    const name = document.createElement("span")
    name.className = "kv-name"
    name.textContent = v.name
    const value = document.createElement("span")
    value.className = "kv-value"
    value.textContent = formatValue(v.value)
    li.append(name, value)
    list.appendChild(li)
  }
}

function renderSeries(run: EngineRun): void {
  const list = document.getElementById(SERIES_ID)
  if (!list) return
  list.innerHTML = ""
  if (run.series.length === 0) {
    list.appendChild(emptyItem("(none yet)"))
    return
  }
  for (const s of run.series) {
    const li = document.createElement("li")
    li.className = "series-item"
    li.title = "use .sum / .avg / .count / .min / .max"

    const head = document.createElement("div")
    head.className = "series-head"
    const name = document.createElement("span")
    name.className = "kv-name"
    name.textContent = s.name
    const count = document.createElement("span")
    count.className = "kv-value"
    count.textContent = `n=${s.count}`
    head.append(name, count)
    li.appendChild(head)

    if (s.count > 0) {
      const stats = document.createElement("dl")
      stats.className = "series-stats"
      for (const [label, value] of [
        ["sum", s.sum],
        ["avg", s.avg],
        ["min", s.min],
        ["max", s.max],
      ] as const) {
        const dt = document.createElement("dt")
        dt.textContent = label
        const dd = document.createElement("dd")
        dd.textContent = value ? formatValue(value) : "—"
        stats.append(dt, dd)
      }
      li.appendChild(stats)
    }

    list.appendChild(li)
  }
}

function renderRanges(run: EngineRun): void {
  const list = document.getElementById(RANGES_ID)
  if (!list) return
  list.innerHTML = ""
  if (run.ranges.length === 0) {
    list.appendChild(emptyItem("(none yet)"))
    return
  }
  for (const r of run.ranges) {
    const li = document.createElement("li")
    li.className = "series-item"
    li.title = "use .sum / .avg / .count / .min / .max"

    const head = document.createElement("div")
    head.className = "series-head"
    const name = document.createElement("span")
    name.className = "kv-name"
    const sep = r.inclusive ? ".." : "..."
    const step = r.step.eq(1) ? "" : `/${r.step.toString().replace(".", ",")}`
    name.textContent = `${r.name} = ${formatValue(r.start)}${sep}${formatValue(r.end)}${step}`
    const count = document.createElement("span")
    count.className = "kv-value"
    count.textContent = `n=${r.count}`
    head.append(name, count)
    li.appendChild(head)

    if (r.count > 0) {
      const stats = document.createElement("dl")
      stats.className = "series-stats"
      for (const [label, value] of [
        ["sum", r.sum],
        ["avg", r.avg],
        ["min", r.min],
        ["max", r.max],
      ] as const) {
        const dt = document.createElement("dt")
        dt.textContent = label
        const dd = document.createElement("dd")
        dd.textContent = value ? formatValue(value) : "—"
        stats.append(dt, dd)
      }
      li.appendChild(stats)
    }

    list.appendChild(li)
  }
}

function renderFunctions(run: EngineRun): void {
  const list = document.getElementById(FUNCTIONS_ID)
  if (!list) return
  list.innerHTML = ""
  if (run.functions.length === 0) {
    list.appendChild(emptyItem("(none yet)"))
    return
  }
  for (const f of run.functions) {
    const li = document.createElement("li")
    const name = document.createElement("span")
    name.className = "kv-name"
    name.textContent = f.name
    const sig = document.createElement("span")
    sig.className = "kv-value"
    sig.textContent = `(${f.params.join(", ")})`
    li.title = `call as ${f.name}(${f.params.join(", ")})`
    li.append(name, sig)
    list.appendChild(li)
  }
}

function renderPlots(run: EngineRun): void {
  const list = document.getElementById(PLOTS_ID)
  if (!list) return
  list.innerHTML = ""
  if (run.plots.length === 0) {
    list.appendChild(emptyItem("(none yet)"))
    return
  }
  // Index plotDecl statements by name so each row can carry its source line.
  const lineByName = new Map<string, number>()
  for (const r of run.results) {
    if (r.stmt.type === "plotDecl") lineByName.set(r.stmt.name, r.stmt.pos.line)
  }
  for (const p of run.plots) {
    const n = p.value.shapes.length
    const line = lineByName.get(p.name)
    const li = document.createElement("li")
    li.className = "plot-item"
    li.title =
      (p.value.aspect === "stretch"
        ? "auto-chart from a series/range"
        : "block plot — geometric / turtle primitives") +
      (line ? " — click to jump" : "")
    const name = document.createElement("span")
    name.className = "kv-name"
    name.textContent = p.name
    const count = document.createElement("span")
    count.className = "kv-value"
    count.textContent = `${n} shape${n === 1 ? "" : "s"}`
    li.append(name, count)
    if (line !== undefined) {
      li.style.cursor = "pointer"
      li.addEventListener("click", () => {
        callbacks.onPlotClick?.(line)
      })
    }
    list.appendChild(li)
  }
}

function renderUnits(run: EngineRun): void {
  const list = document.getElementById(UNITS_ID)
  if (!list) return
  list.innerHTML = ""
  if (run.units.length === 0) {
    list.appendChild(emptyItem("(none yet)"))
    return
  }
  for (const u of run.units) {
    const li = document.createElement("li")
    li.title = `factor: ${u.factor.toString()}`
    const name = document.createElement("span")
    name.className = "kv-name"
    name.textContent = u.name
    const dim = document.createElement("span")
    dim.className = "kv-value"
    dim.textContent = Dim.format(u.dimension)
    li.append(name, dim)
    list.appendChild(li)
  }
}

function renderDiagnostics(run: EngineRun): void {
  const list = document.getElementById(DIAGS_ID)
  if (!list) return
  list.innerHTML = ""
  if (run.allDiagnostics.length === 0) {
    list.appendChild(emptyItem("(none)"))
    return
  }
  for (const d of run.allDiagnostics) {
    const li = document.createElement("li")
    li.className = "diag-item"
    const loc = document.createElement("div")
    loc.className = "diag-loc"
    loc.textContent = `line ${d.line}, col ${d.col}`
    const msg = document.createElement("div")
    msg.className = "diag-msg"
    msg.textContent = d.message
    li.append(loc, msg)
    if (d.hint) {
      const hint = document.createElement("div")
      hint.className = "diag-hint"
      hint.textContent = `hint: ${d.hint}`
      li.appendChild(hint)
    }
    list.appendChild(li)
  }
}

function emptyItem(text: string): HTMLLIElement {
  const li = document.createElement("li")
  li.className = "empty"
  li.textContent = text
  return li
}
