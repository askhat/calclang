import * as Dim from "../src/units/dimension.ts"
import { formatValue } from "../src/format/output.ts"
import type { EngineRun } from "./calc-engine.ts"

const VARS_ID = "vars-list"
const SERIES_ID = "series-list"
const UNITS_ID = "units-list"
const DIAGS_ID = "diagnostics-list"

export function renderSidebar(run: EngineRun): void {
  renderVariables(run)
  renderSeries(run)
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
    const name = document.createElement("span")
    name.className = "kv-name"
    name.textContent = s.name
    const meta = document.createElement("span")
    meta.className = "kv-value"
    const unit = s.sumUnit ? ` ${s.sumUnit}` : ""
    meta.textContent = `${s.count}${unit}`
    li.title = "use .sum / .avg / .count / .min / .max"
    li.append(name, meta)
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
