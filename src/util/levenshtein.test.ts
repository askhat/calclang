import { describe, expect, test } from "bun:test"
import { levenshtein, suggest } from "./levenshtein.ts"

describe("levenshtein", () => {
  test("identical", () => {
    expect(levenshtein("kg", "kg")).toBe(0)
  })

  test("single substitution", () => {
    expect(levenshtein("kg", "kj")).toBe(1)
  })

  test("single insertion", () => {
    expect(levenshtein("kg", "kgg")).toBe(1)
  })

  test("single deletion", () => {
    expect(levenshtein("kgs", "kg")).toBe(1)
  })

  test("typo: salaty → salary", () => {
    expect(levenshtein("salaty", "salary")).toBe(1)
  })

  test("empty string distance is the other length", () => {
    expect(levenshtein("", "abc")).toBe(3)
    expect(levenshtein("abc", "")).toBe(3)
  })
})

describe("suggest", () => {
  test("returns the closest within distance 2", () => {
    expect(suggest("salray", ["salary", "rub", "kg"])).toBe("salary")
  })

  test("returns null when nothing is within distance", () => {
    expect(suggest("xyz", ["salary", "rub", "kg"])).toBeNull()
  })

  test("returns null on empty candidate set", () => {
    expect(suggest("foo", [])).toBeNull()
  })

  test("respects custom max distance", () => {
    expect(suggest("kg", ["kilogram"], 1)).toBeNull()
    expect(suggest("kg", ["kilogram"], 6)).toBe("kilogram")
  })

  test("picks the shortest distance among multiple candidates", () => {
    // 'usd' is distance 1 from 'usf'; 'rub' is distance 3.
    expect(suggest("usf", ["usd", "rub"])).toBe("usd")
  })
})
