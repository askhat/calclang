import { describe, expect, test } from "bun:test"
import * as D from "./dimension.ts"

describe("equals", () => {
  test("same canonical form", () => {
    expect(D.equals({ mass: 1 }, { mass: 1 })).toBe(true)
  })

  test("explicit zero is treated as absence", () => {
    expect(D.equals({ mass: 1, time: 0 }, { mass: 1 })).toBe(true)
  })

  test("different exponents", () => {
    expect(D.equals({ mass: 1 }, { mass: 2 })).toBe(false)
  })

  test("different dimensions", () => {
    expect(D.equals({ mass: 1 }, { length: 1 })).toBe(false)
  })

  test("dimensionless equals empty", () => {
    expect(D.equals(D.DIMENSIONLESS, {})).toBe(true)
  })
})

describe("isDimensionless", () => {
  test("empty vector", () => {
    expect(D.isDimensionless({})).toBe(true)
  })

  test("all-zero vector", () => {
    expect(D.isDimensionless({ mass: 0, length: 0 })).toBe(true)
  })

  test("non-zero entry", () => {
    expect(D.isDimensionless({ mass: 1 })).toBe(false)
  })
})

describe("mul / div", () => {
  test("mul adds exponents and drops zeros", () => {
    expect(D.mul({ mass: 1, length: 1 }, { mass: 1, time: -1 })).toEqual({
      mass: 2,
      length: 1,
      time: -1,
    })
  })

  test("mul cancels matching opposites", () => {
    expect(D.mul({ mass: 1 }, { mass: -1 })).toEqual({})
  })

  test("div subtracts exponents", () => {
    expect(D.div({ length: 1 }, { time: 1 })).toEqual({
      length: 1,
      time: -1,
    })
  })

  test("div by same vector is dimensionless", () => {
    expect(D.div({ mass: 1, length: 1 }, { mass: 1, length: 1 })).toEqual({})
  })
})

describe("pow", () => {
  test("0 → dimensionless", () => {
    expect(D.pow({ mass: 1 }, 0)).toEqual({})
  })

  test("1 → identity", () => {
    expect(D.pow({ mass: 1, time: -1 }, 1)).toEqual({ mass: 1, time: -1 })
  })

  test("2 → exponents doubled", () => {
    expect(D.pow({ length: 1 }, 2)).toEqual({ length: 2 })
  })

  test("-1 → exponents negated", () => {
    expect(D.pow({ mass: 1, time: -1 }, -1)).toEqual({ mass: -1, time: 1 })
  })
})

describe("format", () => {
  test("dimensionless", () => {
    expect(D.format({})).toBe("dimensionless")
  })

  test("single positive", () => {
    expect(D.format({ mass: 1 })).toBe("mass")
  })

  test("single positive with exponent", () => {
    expect(D.format({ length: 2 })).toBe("length^2")
  })

  test("positives joined with ·", () => {
    expect(D.format({ mass: 1, length: 1 })).toBe("mass·length")
  })

  test("only negative", () => {
    expect(D.format({ time: -1 })).toBe("1/time")
  })

  test("mixed: kg·m/s^2", () => {
    expect(D.format({ mass: 1, length: 1, time: -2 })).toBe(
      "mass·length/time^2",
    )
  })
})
