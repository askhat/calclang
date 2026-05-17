import {
  FileExistsError,
  FileNotFoundError,
  type FileMeta,
  type FileSystem,
  validateName,
} from "./filesystem.ts"

/**
 * Minimal storage shape — just the three localStorage methods we use. Lets
 * tests inject an in-memory stub without faking the whole Web Storage API.
 */
export interface KvStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const KEY_INDEX = "calc.fs.index"
const KEY_FILE_PREFIX = "calc.fs.file:"

type IndexEntry = { name: string; modifiedAt: number; size: number }

export class LocalStorageFS implements FileSystem {
  constructor(
    private readonly storage: KvStorage = globalThis.localStorage,
  ) {}

  async list(): Promise<FileMeta[]> {
    return [...this.readIndex().values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }

  async read(name: string): Promise<string | null> {
    return this.storage.getItem(KEY_FILE_PREFIX + name)
  }

  async write(name: string, content: string): Promise<void> {
    validateName(name)
    this.storage.setItem(KEY_FILE_PREFIX + name, content)
    const idx = this.readIndex()
    idx.set(name, { name, modifiedAt: Date.now(), size: content.length })
    this.writeIndex(idx)
  }

  async rename(oldName: string, newName: string): Promise<void> {
    validateName(newName)
    if (oldName === newName) return
    const content = await this.read(oldName)
    if (content === null) throw new FileNotFoundError(oldName)
    if (await this.exists(newName)) throw new FileExistsError(newName)
    await this.write(newName, content)
    await this.delete(oldName)
  }

  async delete(name: string): Promise<void> {
    this.storage.removeItem(KEY_FILE_PREFIX + name)
    const idx = this.readIndex()
    idx.delete(name)
    this.writeIndex(idx)
  }

  async exists(name: string): Promise<boolean> {
    return this.readIndex().has(name)
  }

  /**
   * Synchronous escape hatch for `beforeunload`, where async handlers may
   * be killed before completing. Skips updating the index (the size /
   * mtime catches up on next interactive save).
   */
  writeContentSync(name: string, content: string): void {
    this.storage.setItem(KEY_FILE_PREFIX + name, content)
  }

  private readIndex(): Map<string, IndexEntry> {
    const json = this.storage.getItem(KEY_INDEX)
    if (!json) return new Map()
    try {
      const arr = JSON.parse(json) as IndexEntry[]
      if (!Array.isArray(arr)) return new Map()
      return new Map(arr.map((e) => [e.name, e]))
    } catch {
      return new Map()
    }
  }

  private writeIndex(idx: Map<string, IndexEntry>): void {
    this.storage.setItem(KEY_INDEX, JSON.stringify([...idx.values()]))
  }
}

// -- Active file tracking (not part of FileSystem; just a UI preference) --

const KEY_ACTIVE = "calc.active"

export function getActiveFile(
  storage: KvStorage = globalThis.localStorage,
): string | null {
  return storage.getItem(KEY_ACTIVE)
}

export function setActiveFile(
  name: string | null,
  storage: KvStorage = globalThis.localStorage,
): void {
  if (name === null) storage.removeItem(KEY_ACTIVE)
  else storage.setItem(KEY_ACTIVE, name)
}
