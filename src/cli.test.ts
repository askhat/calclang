import { describe, expect, test } from "bun:test"
import { runFile } from "./cli.ts"

describe("scaffold", () => {
  test("runFile is callable", () => {
    expect(typeof runFile).toBe("function")
  })

  test("decimal.js arithmetic is exact", async () => {
    const { default: Decimal } = await import("decimal.js")
    const result = new Decimal("0.1").plus("0.2").toString()
    expect(result).toBe("0.3")
  })
})
