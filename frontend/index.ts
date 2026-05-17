import { EditorView, basicSetup } from "codemirror"
import { calcLanguage } from "./calc-language.ts"
import { errorsExtension } from "./errors-extension.ts"
import { hoverExtension } from "./hover-extension.ts"
import { numberNudgeKeymap } from "./number-nudge.ts"
import { resultsExtension } from "./results-extension.ts"
import { renderSidebar } from "./sidebar.ts"
import { decodeSourceFromHash, loadDraft, saveDraft, shareLink } from "./share.ts"
import { engineState, setSnapshot, snapshotState } from "./state.ts"

const STARTER = `# Welcome to Calc! Edit anything and watch results update.

unit usd base currency
unit rub (usd / 90,5)
unit kzt (usd / 467,245543)

35,5 rub salary
salary + 10 = total
salary as kzt = salaryInKzt
100 rub + 5 usd

# Try Alt+↑ / Alt+↓ on a number to nudge it.
# Hover an identifier for its value.
`

function initialSource(): string {
  const fromHash = decodeSourceFromHash(window.location.hash)
  if (fromHash !== null) return fromHash
  return loadDraft() ?? STARTER
}

const view = new EditorView({
  doc: initialSource(),
  parent: document.getElementById("editor")!,
  extensions: [
    basicSetup,
    calcLanguage(),
    engineState,
    snapshotState,
    resultsExtension,
    errorsExtension,
    hoverExtension,
    numberNudgeKeymap,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      const src = update.state.doc.toString()
      saveDraft(src)
      renderSidebar(update.state.field(engineState))
    }),
  ],
})

// Initial sidebar render — updateListener doesn't fire on creation.
renderSidebar(view.state.field(engineState))

// -- Header buttons --

document.getElementById("snapshot-btn")?.addEventListener("click", () => {
  const current = view.state.field(engineState)
  view.dispatch({ effects: setSnapshot.of(current) })
  toast("Snapshot captured. Edits will show deltas.", "success")
})

document.getElementById("share-btn")?.addEventListener("click", async () => {
  const link = shareLink(view.state.doc.toString())
  try {
    await navigator.clipboard.writeText(link)
    toast("Share link copied!", "success")
  } catch {
    toast(`Copy failed. Link: ${link}`)
  }
})

document.getElementById("help-btn")?.addEventListener("click", () => {
  const dialog = document.getElementById("help-dialog") as HTMLDialogElement | null
  dialog?.showModal()
})

// -- Keyboard shortcuts for header actions --

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return
  if (e.key.toLowerCase() === "s") {
    e.preventDefault()
    document.getElementById("snapshot-btn")?.click()
  } else if (e.key.toLowerCase() === "k") {
    e.preventDefault()
    document.getElementById("share-btn")?.click()
  }
})

// -- Toast helper --

function toast(message: string, kind: "info" | "success" = "info"): void {
  const el = document.createElement("div")
  el.className = `toast ${kind === "success" ? "toast-success" : ""}`
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => {
    el.style.animation = "toast-out 200ms ease-in forwards"
    setTimeout(() => el.remove(), 220)
  }, 2200)
}
