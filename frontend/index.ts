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
# Comments start with '#'. Decimal separator is ','. Underscore groups: 1_000.

# ─── Units ──────────────────────────────────────────────────────────────
# Dimensions are Capitalized; unit and variable names are lowercase.
#   UNIT <Dim> <name>             — simple, factor 1 in <Dim>
#   UNIT <Dim> <name> (<expr>)    — composite, body must match <Dim>
#   UNIT (<expr>) <name>          — composite, dim inferred from body

UNIT Currency usd
UNIT (usd / 90,5) rub
UNIT Currency kzt (usd / 467,245543)
UNIT Mass kg
UNIT Mass gr (kg / 1_000)
UNIT Length m
UNIT Time s

# ─── Variables ──────────────────────────────────────────────────────────
# [+|-]? NUMBER [unit] <name>

-10 minusTen
35,5 rub salary
9,8 (m / s ^ 2) gravity

# ─── Expressions ────────────────────────────────────────────────────────
# Bare expressions show their result on the right.
# 'expr = name' assigns. 'as <unit>' converts. Right operand's unit wins.

salary + minusTen = total
salary as kzt = salaryInKzt
100 rub + 5 usd                  # right unit wins → usd
2 ^ 10                           # power
(1 + 2) * 3                      # parens

# ─── Conditionals ───────────────────────────────────────────────────────
# Boolean ops: and / or / not. Comparisons: == != < > <= >=.
# Ternary: cond ? a : b, or if cond then a else b.

salary > 0 and salary < 100 rub
salary > 0 ? salary : -salary
if total > 0 then total else 0

# ─── Series ─────────────────────────────────────────────────────────────
# SERIES <name> then member lines. Blank line / EOF / next keyword end it.
# Members may be named: <expr> <name>. Access via '.'.
# Aggregates: .count .sum .avg .min .max

SERIES wallet
100 rub
5 usd
2_000 rub
50 usd

wallet.sum
wallet.avg
wallet.count

SERIES budget
500 usd salary
400 bonus              # no unit → inherits series unit (last explicit = rub)
-100 rub tax

budget.salary
budget.bonus
budget.sum

# ─── Ranges ─────────────────────────────────────────────────────────────
# Iterable with snap-to-multiples semantics:
#   <start>..<end>[/<step>]   — inclusive (1..10 → 1, 2, ..., 10)
#   <start>...<end>[/<step>]  — exclusive (1...10 → 1, 2, ..., 9)
#   <range> <name>            — bind a name (like a series)
#   RANGE <name> <start> <end> [<step>]   — keyword form (inclusive)
# Default step is 1. start is always anchored; then multiples of step
# within (start, end]. Exclusive drops start too when no inner multiples.
# start > end walks down. Same aggregates as SERIES: .sum .avg .count .min .max

1..10 onesToTen
onesToTen.sum
onesToTen.avg

1...5             # bare exclusive range

10..1 down        # reverse direction
down.sum

# Custom step: 1, 3, 6, 9 (start + multiples of 3 up to 10)
1..10/3 byThree
byThree.sum

# Step larger than the gap
1..10/100         # inclusive → just the anchor {1}
1...10/100        # exclusive → empty {}

RANGE prices 1 usd 10 usd
prices.sum
prices.avg

(1..100).sum      # inline parenthesized range

# ─── Functions ──────────────────────────────────────────────────────────
# FN <name>(<params>) <body>. Body is a single expression.

FN double(x) x * 2
FN avg2(a, b) (a + b) / 2
FN circleArea(r) 3,14159265 * r ^ 2

double(7)
avg2(10, 30)
circleArea(5)

# Functions with units
FN kinetic(m, v) m * v ^ 2 / 2
kinetic(70 kg, 10 m / s)

# Recursion via if/then/else
FN fact(n) if n < 2 then 1 else n * fact(n - 1)
fact(5)

# Functions can reach into series
SERIES temps
10
20
30

FN scaled(k) temps.sum * k
scaled(2)

# ─── Real-world: mortgage calculator ────────────────────────────────────
# Pull it all together — units + variables + assignments + FN + named-member
# series. Cost of an apartment, down payment, annuity, overpay, and a
# side-by-side rate comparison.

15_000_000 rub apartmentPrice
3_000_000 rub downPayment
apartmentPrice - downPayment = loanAmount        # сколько брать в ипотеку
240 termMonths                                    # срок 20 лет

# Аннуитетный платёж: P · r · (1+r)^n / ((1+r)^n − 1), где r = annual / 12.
FN payment(p, annual, n) p * (annual / 12) * (1 + annual / 12) ^ n / ((1 + annual / 12) ^ n - 1)

payment(loanAmount, 0,18, termMonths) = monthlyPayment
monthlyPayment * termMonths = totalPayments
totalPayments - loanAmount = overpayment         # переплата банку

loanAmount as usd                                # та же сумма в долларах
monthlyPayment as usd
overpayment as usd

# Сценарии разных ставок — series с FN-вызовами в членах:
SERIES scenarios
payment(loanAmount, 0,12, termMonths) dream
payment(loanAmount, 0,14, termMonths) good
payment(loanAmount, 0,16, termMonths) okRate
payment(loanAmount, 0,18, termMonths) baseRate

scenarios.dream                                  # платёж при 12%
scenarios.baseRate                               # платёж при 18%
scenarios.baseRate - scenarios.dream             # сколько съедает каждый "лишний" %

# ─── Tips ───────────────────────────────────────────────────────────────
# • Alt+↑ / Alt+↓ on a number nudges it.
# • Hover an identifier for its value.
# • Files persist in your browser; switch in the sidebar.
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
