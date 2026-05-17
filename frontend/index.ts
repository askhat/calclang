import { EditorView, basicSetup } from "codemirror"
import { calcLanguage } from "./calc-language.ts"
import { errorsExtension } from "./errors-extension.ts"
import { FilesPanel } from "./files-panel.ts"
import { hoverExtension } from "./hover-extension.ts"
import { numberNudgeKeymap } from "./number-nudge.ts"
import { resultsExtension } from "./results-extension.ts"
import { renderSidebar } from "./sidebar.ts"
import { decodeSourceFromHash, shareLink } from "./share.ts"
import { engineState, setSnapshot, snapshotState } from "./state.ts"
import {
  getActiveFile,
  LocalStorageFS,
  setActiveFile,
} from "./storage/local-fs.ts"
import {
  FileExistsError,
  InvalidNameError,
  nextAvailableName,
  type FileSystem,
} from "./storage/filesystem.ts"

const STARTER = `# Welcome to Calc! Edit anything and watch results update.
# Dimensions are Capitalized; unit and variable names are lowercase.
# Two forms for unit declarations:
#   UNIT <Dim> <name>            — simple, factor 1
#   UNIT (<expr>) <name>         — composite, dim inferred from body

UNIT Currency usd
UNIT (usd / 90,5) rub
UNIT (usd / 467,245543) kzt

35,5 rub salary
salary + 10 = total
salary as kzt = salaryInKzt
100 rub + 5 usd

# Try Alt+↑ / Alt+↓ on a number to nudge it.
# Hover an identifier for its value.
# Files persist in your browser; pick a different one in the sidebar.
`

const SAVE_DEBOUNCE_MS = 400

const fs = new LocalStorageFS()
let activeFile = await bootstrapFs(fs)
const initialContent = (await fs.read(activeFile)) ?? ""

async function bootstrapFs(fs: FileSystem): Promise<string> {
  // 1) Incoming share link → import as a new file, then clear the hash.
  const fromHash = decodeSourceFromHash(window.location.hash)
  if (fromHash !== null) {
    const stamp = new Date().toISOString().slice(0, 10)
    const name = await nextAvailableName(fs, `shared-${stamp}.calc`)
    await fs.write(name, fromHash)
    setActiveFile(name)
    history.replaceState(null, "", window.location.pathname)
    return name
  }

  // 2) Existing files: restore the previously active one, or pick the
  //    alphabetically-first if the saved name is stale.
  const files = await fs.list()
  if (files.length === 0) {
    await fs.write("welcome.calc", STARTER)
    setActiveFile("welcome.calc")
    return "welcome.calc"
  }
  const saved = getActiveFile()
  if (saved && files.some((f) => f.name === saved)) return saved
  const first = files[0]!.name
  setActiveFile(first)
  return first
}

const view = new EditorView({
  doc: initialContent,
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
      scheduleSave(update.state.doc.toString())
      renderSidebar(update.state.field(engineState))
    }),
  ],
})

renderSidebar(view.state.field(engineState))

// -- Auto-save --

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(content: string): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void fs.write(activeFile, content).then(() => filesPanel.render(activeFile))
  }, SAVE_DEBOUNCE_MS)
}

async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await fs.write(activeFile, view.state.doc.toString())
}

// -- File switching --

async function openFile(name: string): Promise<void> {
  if (name === activeFile) return
  await flushSave()
  const content = (await fs.read(name)) ?? ""
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    // A new file gets its own snapshot baseline.
    effects: setSnapshot.of(null),
    selection: { anchor: 0 },
  })
  activeFile = name
  setActiveFile(name)
  renderSidebar(view.state.field(engineState))
  await filesPanel.render(activeFile)
}

async function createFile(): Promise<void> {
  const proposed = window.prompt("New file name:", "untitled.calc")
  if (!proposed) return
  const name = proposed.trim()
  try {
    if (await fs.exists(name)) {
      toast(`File '${name}' already exists`, "error")
      return
    }
    await flushSave()
    await fs.write(name, "")
    await openFile(name)
  } catch (e) {
    if (e instanceof InvalidNameError || e instanceof FileExistsError) {
      toast(e.message, "error")
    } else {
      throw e
    }
  }
}

async function renameFile(oldName: string, newName: string): Promise<void> {
  await fs.rename(oldName, newName)
  if (oldName === activeFile) {
    activeFile = newName
    setActiveFile(newName)
  }
  await filesPanel.render(activeFile)
  toast(`Renamed to '${newName}'`, "success")
}

async function deleteFile(name: string): Promise<void> {
  await fs.delete(name)
  if (name === activeFile) {
    const remaining = await fs.list()
    if (remaining.length === 0) {
      await fs.write("untitled.calc", "")
      await openFile("untitled.calc")
      return
    }
    await openFile(remaining[0]!.name)
  } else {
    await filesPanel.render(activeFile)
  }
}

// -- Files panel --

const filesPanel = new FilesPanel(
  document.getElementById("files-list")!,
  document.getElementById("new-file-btn")!,
  fs,
  {
    onOpen: (name) => openFile(name),
    onCreate: () => createFile(),
    onRename: (oldName, newName) => renameFile(oldName, newName),
    onDelete: (name) => deleteFile(name),
    toast: (msg, kind) => toast(msg, kind),
  },
)
await filesPanel.render(activeFile)

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

// -- Save on tab close (sync escape hatch — async handlers may be cancelled) --

window.addEventListener("beforeunload", () => {
  fs.writeContentSync(activeFile, view.state.doc.toString())
})

// -- Keyboard shortcuts --

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

function toast(
  message: string,
  kind: "info" | "success" | "error" = "info",
): void {
  const el = document.createElement("div")
  el.className = `toast toast-${kind}`
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => {
    el.style.animation = "toast-out 200ms ease-in forwards"
    setTimeout(() => el.remove(), 220)
  }, 2400)
}
