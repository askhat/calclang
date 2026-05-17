import { StateEffect, StateField } from "@codemirror/state"
import { runPipeline, type EngineRun } from "./calc-engine.ts"

/**
 * The latest pipeline run, recomputed on every doc change. Extensions read
 * from this for decorations, lint, hover, and the sidebar.
 */
export const engineState = StateField.define<EngineRun>({
  create(state) {
    return runPipeline(state.doc.toString())
  },
  update(value, tr) {
    if (!tr.docChanged) return value
    return runPipeline(tr.newDoc.toString())
  },
})

/**
 * The snapshot — captured by the user via the Snapshot button. Each line's
 * current result is compared against this for delta coloring.
 */
export const setSnapshot = StateEffect.define<EngineRun | null>()

export const snapshotState = StateField.define<EngineRun | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSnapshot)) return e.value
    }
    return value
  },
})
