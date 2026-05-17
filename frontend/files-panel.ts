import type { FileMeta, FileSystem } from "./storage/filesystem.ts"
import {
  FileExistsError,
  InvalidNameError,
} from "./storage/filesystem.ts"

export type FilesPanelHandlers = {
  onOpen: (name: string) => void | Promise<void>
  onCreate: () => void | Promise<void>
  onRename: (oldName: string, newName: string) => void | Promise<void>
  onDelete: (name: string) => void | Promise<void>
  toast: (message: string, kind?: "info" | "success" | "error") => void
}

export class FilesPanel {
  constructor(
    private readonly listEl: HTMLElement,
    private readonly newBtn: HTMLElement,
    private readonly fs: FileSystem,
    private readonly handlers: FilesPanelHandlers,
  ) {
    this.newBtn.addEventListener("click", () => this.handlers.onCreate())
  }

  async render(activeFile: string | null): Promise<void> {
    const files = await this.fs.list()
    this.listEl.innerHTML = ""
    if (files.length === 0) {
      const empty = document.createElement("li")
      empty.className = "empty"
      empty.textContent = "(no files)"
      this.listEl.appendChild(empty)
      return
    }
    for (const f of files) {
      this.listEl.appendChild(this.renderFileItem(f, activeFile))
    }
  }

  private renderFileItem(
    file: FileMeta,
    activeFile: string | null,
  ): HTMLLIElement {
    const li = document.createElement("li")
    li.className = "file-item"
    if (file.name === activeFile) li.classList.add("active")
    li.dataset["name"] = file.name

    const name = document.createElement("span")
    name.className = "file-name"
    name.textContent = file.name
    name.title = `${file.size} chars · modified ${new Date(file.modifiedAt).toLocaleString()}`
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation()
      this.beginRename(li, file.name)
    })

    const actions = document.createElement("span")
    actions.className = "file-actions"

    const renameBtn = iconButton("✎", "Rename (double-click name)", () => {
      this.beginRename(li, file.name)
    })
    const deleteBtn = iconButton("🗑", "Delete", () => {
      this.confirmDelete(file.name)
    })
    actions.append(renameBtn, deleteBtn)

    li.append(name, actions)
    li.addEventListener("click", () => {
      this.handlers.onOpen(file.name)
    })
    return li
  }

  private beginRename(li: HTMLLIElement, oldName: string): void {
    const nameEl = li.querySelector(".file-name") as HTMLElement | null
    if (!nameEl) return
    const input = document.createElement("input")
    input.type = "text"
    input.className = "file-rename-input"
    input.value = oldName
    nameEl.replaceWith(input)
    input.focus()
    input.select()

    const finish = async (commit: boolean) => {
      const newName = input.value.trim()
      input.replaceWith(nameEl)
      nameEl.textContent = oldName
      if (!commit || !newName || newName === oldName) return
      try {
        await this.handlers.onRename(oldName, newName)
      } catch (e) {
        if (e instanceof InvalidNameError || e instanceof FileExistsError) {
          this.handlers.toast(e.message, "error")
        } else {
          throw e
        }
      }
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        void finish(true)
      } else if (e.key === "Escape") {
        e.preventDefault()
        void finish(false)
      }
    })
    input.addEventListener("blur", () => void finish(true))
  }

  private confirmDelete(name: string): void {
    if (!confirm(`Delete '${name}'? This can't be undone.`)) return
    void this.handlers.onDelete(name)
  }
}

function iconButton(
  symbol: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "icon-btn"
  btn.textContent = symbol
  btn.title = title
  btn.addEventListener("click", (e) => {
    e.stopPropagation()
    onClick()
  })
  return btn
}
