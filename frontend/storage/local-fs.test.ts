import { describe, expect, test } from "bun:test"
import {
  FileExistsError,
  FileNotFoundError,
  InvalidNameError,
  nextAvailableName,
  validateName,
} from "./filesystem.ts"
import { getActiveFile, LocalStorageFS, setActiveFile } from "./local-fs.ts"

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  size(): number {
    return this.map.size
  }
}

function newFs(): { fs: LocalStorageFS; storage: MemoryStorage } {
  const storage = new MemoryStorage()
  return { fs: new LocalStorageFS(storage), storage }
}

describe("validateName", () => {
  test("accepts simple names", () => {
    expect(() => validateName("budget.calc")).not.toThrow()
    expect(() => validateName("my note 1.calc")).not.toThrow()
    expect(() => validateName("a")).not.toThrow()
  })

  test("rejects empty / overly long names", () => {
    expect(() => validateName("")).toThrow(InvalidNameError)
    expect(() => validateName("a".repeat(65))).toThrow(InvalidNameError)
  })

  test("rejects dotfiles", () => {
    expect(() => validateName(".hidden")).toThrow(InvalidNameError)
  })

  test("rejects path separators and other punctuation", () => {
    expect(() => validateName("a/b")).toThrow(InvalidNameError)
    expect(() => validateName("a\\b")).toThrow(InvalidNameError)
    expect(() => validateName("a?b")).toThrow(InvalidNameError)
  })
})

describe("LocalStorageFS basics", () => {
  test("empty FS lists no files", async () => {
    const { fs } = newFs()
    expect(await fs.list()).toEqual([])
  })

  test("write then read round-trips", async () => {
    const { fs } = newFs()
    await fs.write("budget.calc", "1 + 2")
    expect(await fs.read("budget.calc")).toBe("1 + 2")
  })

  test("read of unknown file returns null", async () => {
    const { fs } = newFs()
    expect(await fs.read("nope.calc")).toBeNull()
  })

  test("list shows written files sorted by name", async () => {
    const { fs } = newFs()
    await fs.write("zeta.calc", "a")
    await fs.write("alpha.calc", "b")
    await fs.write("mu.calc", "c")
    const names = (await fs.list()).map((f) => f.name)
    expect(names).toEqual(["alpha.calc", "mu.calc", "zeta.calc"])
  })

  test("metadata: size + modifiedAt populated", async () => {
    const before = Date.now()
    const { fs } = newFs()
    await fs.write("x.calc", "abc")
    const [meta] = await fs.list()
    expect(meta?.size).toBe(3)
    expect(meta?.modifiedAt).toBeGreaterThanOrEqual(before)
  })

  test("write overwrites and bumps modifiedAt", async () => {
    const { fs } = newFs()
    await fs.write("x.calc", "first")
    const m1 = (await fs.list())[0]!.modifiedAt
    // small async gap; in real usage there's at least a tick between writes
    await new Promise((r) => setTimeout(r, 5))
    await fs.write("x.calc", "second")
    const m2 = (await fs.list())[0]!.modifiedAt
    expect(await fs.read("x.calc")).toBe("second")
    expect(m2).toBeGreaterThanOrEqual(m1)
  })

  test("exists reflects writes and deletes", async () => {
    const { fs } = newFs()
    expect(await fs.exists("x.calc")).toBe(false)
    await fs.write("x.calc", "")
    expect(await fs.exists("x.calc")).toBe(true)
    await fs.delete("x.calc")
    expect(await fs.exists("x.calc")).toBe(false)
  })

  test("delete drops content and index entry", async () => {
    const { fs } = newFs()
    await fs.write("x.calc", "v")
    await fs.delete("x.calc")
    expect(await fs.read("x.calc")).toBeNull()
    expect(await fs.list()).toEqual([])
  })

  test("write rejects invalid names", async () => {
    const { fs } = newFs()
    await expect(fs.write("", "")).rejects.toBeInstanceOf(InvalidNameError)
    await expect(fs.write("a/b", "")).rejects.toBeInstanceOf(InvalidNameError)
  })
})

describe("LocalStorageFS rename", () => {
  test("renames preserving content", async () => {
    const { fs } = newFs()
    await fs.write("old.calc", "hi")
    await fs.rename("old.calc", "new.calc")
    expect(await fs.exists("old.calc")).toBe(false)
    expect(await fs.read("new.calc")).toBe("hi")
  })

  test("no-op when source and target are equal", async () => {
    const { fs } = newFs()
    await fs.write("x.calc", "hi")
    await fs.rename("x.calc", "x.calc")
    expect(await fs.read("x.calc")).toBe("hi")
  })

  test("rejects when source is missing", async () => {
    const { fs } = newFs()
    await expect(fs.rename("nope.calc", "n.calc")).rejects.toBeInstanceOf(
      FileNotFoundError,
    )
  })

  test("rejects when target already exists", async () => {
    const { fs } = newFs()
    await fs.write("a.calc", "1")
    await fs.write("b.calc", "2")
    await expect(fs.rename("a.calc", "b.calc")).rejects.toBeInstanceOf(
      FileExistsError,
    )
    // Original kept intact on failure.
    expect(await fs.read("a.calc")).toBe("1")
  })

  test("rejects invalid target name", async () => {
    const { fs } = newFs()
    await fs.write("a.calc", "1")
    await expect(fs.rename("a.calc", "a/b")).rejects.toBeInstanceOf(
      InvalidNameError,
    )
  })
})

describe("writeContentSync escape hatch", () => {
  test("writes content but doesn't reorder the index", async () => {
    const { fs } = newFs()
    await fs.write("x.calc", "v1")
    fs.writeContentSync("x.calc", "v2")
    expect(await fs.read("x.calc")).toBe("v2")
  })
})

describe("active file helpers", () => {
  test("set / get round-trip", () => {
    const storage = new MemoryStorage()
    expect(getActiveFile(storage)).toBeNull()
    setActiveFile("a.calc", storage)
    expect(getActiveFile(storage)).toBe("a.calc")
    setActiveFile(null, storage)
    expect(getActiveFile(storage)).toBeNull()
  })
})

describe("nextAvailableName", () => {
  test("returns the base when free", async () => {
    const { fs } = newFs()
    expect(await nextAvailableName(fs, "shared.calc")).toBe("shared.calc")
  })

  test("appends -2 when base is taken", async () => {
    const { fs } = newFs()
    await fs.write("shared.calc", "")
    expect(await nextAvailableName(fs, "shared.calc")).toBe("shared-2.calc")
  })

  test("keeps incrementing past collisions", async () => {
    const { fs } = newFs()
    await fs.write("shared.calc", "")
    await fs.write("shared-2.calc", "")
    await fs.write("shared-3.calc", "")
    expect(await nextAvailableName(fs, "shared.calc")).toBe("shared-4.calc")
  })

  test("handles names without an extension", async () => {
    const { fs } = newFs()
    await fs.write("note", "")
    expect(await nextAvailableName(fs, "note")).toBe("note-2")
  })
})

describe("persistence across instances (same storage)", () => {
  test("two FS instances see the same files", async () => {
    const storage = new MemoryStorage()
    const fs1 = new LocalStorageFS(storage)
    const fs2 = new LocalStorageFS(storage)
    await fs1.write("hi.calc", "content")
    expect(await fs2.read("hi.calc")).toBe("content")
    expect((await fs2.list()).map((f) => f.name)).toEqual(["hi.calc"])
  })

  test("survives bogus index JSON in storage", async () => {
    const storage = new MemoryStorage()
    storage.setItem("calc.fs.index", "{not json")
    const fs = new LocalStorageFS(storage)
    expect(await fs.list()).toEqual([])
    // Writing recovers the index.
    await fs.write("x.calc", "v")
    expect(await fs.exists("x.calc")).toBe(true)
  })
})
