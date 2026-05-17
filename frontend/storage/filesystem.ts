/**
 * Async file-system interface used by the editor UI. The localStorage-backed
 * implementation in local-fs.ts is the only one for now; an IndexedDB or
 * OPFS impl could slot in here without changes to the UI.
 */

export type FileMeta = {
  name: string
  /** epoch milliseconds */
  modifiedAt: number
  /** characters */
  size: number
}

export interface FileSystem {
  list(): Promise<FileMeta[]>
  read(name: string): Promise<string | null>
  write(name: string, content: string): Promise<void>
  rename(oldName: string, newName: string): Promise<void>
  delete(name: string): Promise<void>
  exists(name: string): Promise<boolean>
}

const NAME_RE = /^[A-Za-z0-9 ._-]+$/

export class InvalidNameError extends Error {
  constructor(name: string, reason: string) {
    super(`invalid filename '${name}': ${reason}`)
    this.name = "InvalidNameError"
  }
}

export class FileExistsError extends Error {
  constructor(name: string) {
    super(`file '${name}' already exists`)
    this.name = "FileExistsError"
  }
}

export class FileNotFoundError extends Error {
  constructor(name: string) {
    super(`file '${name}' not found`)
    this.name = "FileNotFoundError"
  }
}

export function validateName(name: string): void {
  if (!name) throw new InvalidNameError(name, "name is empty")
  if (name.length > 64) throw new InvalidNameError(name, "longer than 64 chars")
  if (name.startsWith(".")) {
    throw new InvalidNameError(name, "filenames can't start with '.'")
  }
  if (!NAME_RE.test(name)) {
    throw new InvalidNameError(
      name,
      "allowed chars: letters, digits, space, dot, dash, underscore",
    )
  }
}

/**
 * Picks the next unused name in the form `base-N.calc`, starting at the
 * first available index. Used when importing from a share link.
 */
export async function nextAvailableName(
  fs: FileSystem,
  base: string,
): Promise<string> {
  if (!(await fs.exists(base))) return base
  const dot = base.lastIndexOf(".")
  const stem = dot >= 0 ? base.slice(0, dot) : base
  const ext = dot >= 0 ? base.slice(dot) : ""
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!(await fs.exists(candidate))) return candidate
  }
  throw new Error(`couldn't find a free name based on '${base}'`)
}
