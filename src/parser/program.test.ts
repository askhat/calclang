import { describe, expect, test } from "bun:test"
import { tokenize } from "../lexer/lexer.ts"
import { showProgram, showStatement } from "./ast.ts"
import { parseProgram } from "./parser.ts"

function parse(src: string) {
  const { tokens } = tokenize(src)
  return parseProgram(tokens)
}

function show(src: string): string {
  const { program } = parse(src)
  return showProgram(program)
}

describe("declarations", () => {
  test("base unit", () => {
    expect(show("unit kg base mass")).toBe("(unit kg (base mass))")
  })

  test("composite unit (body is an Expr, not a unit_expr)", () => {
    expect(show("unit gr (kg / 1_000)")).toBe(
      "(unit gr (composite (div kg 1000)))",
    )
  })

  test("alias (dimension-only, for dynamic-rate currencies)", () => {
    expect(show("unit kzt currency")).toBe("(unit kzt (alias currency))")
  })

  test("composite with multi-token expression", () => {
    expect(show("unit rub (usd / 90,5)")).toBe(
      "(unit rub (composite (div usd 90.5)))",
    )
  })

  test("malformed unit reports a diagnostic", () => {
    const { diagnostics } = parse("unit")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("unit expecting unit_def body", () => {
    const { diagnostics } = parse("unit kg")
    expect(diagnostics.length).toBeGreaterThan(0)
  })
})

describe("variable declarations", () => {
  test("dimensionless", () => {
    expect(show("42 answer")).toBe("(var answer 42)")
  })

  test("with leading minus sign (sign folded into value)", () => {
    expect(show("-10 minusTen")).toBe("(var minusTen -10)")
  })

  test("with leading plus sign", () => {
    expect(show("+10 plusTen")).toBe("(var plusTen 10)")
  })

  test("with simple unit (unit must be declared first)", () => {
    expect(show("unit kg base mass\n35,5 kg flour")).toBe(
      "(unit kg (base mass))\n(var flour 35.5 kg)",
    )
  })

  test("with composite unit", () => {
    expect(
      show(
        "unit m base length\nunit s base time\n9,8 (m / s ^ 2) gravity",
      ),
    ).toBe(
      [
        "(unit m (base length))",
        "(unit s (base time))",
        "(var gravity 9.8 (div m (pow s 2)))",
      ].join("\n"),
    )
  })

  test("simple unit not declared yields a diagnostic", () => {
    const { diagnostics, program } = parse("35,5 foo salary")
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("unknown unit 'foo'")
    expect(diagnostics[0]?.hint).toContain("unit foo")
    // Still produces an AST so parsing can continue
    expect(program.statements).toHaveLength(1)
  })

  test("'35,5 kg' (no name) is dimensionless var named 'kg' per the spec table", () => {
    // NUMBER IDENT NEWLINE → IDENT is the variable name, regardless of
    // whether it happens to match a declared unit. Per spec's resolution
    // table, this is unambiguous.
    expect(show("unit kg base mass\n35,5 kg")).toBe(
      "(unit kg (base mass))\n(var kg 35.5)",
    )
  })
})

describe("expression assignments", () => {
  test("simple", () => {
    expect(show("a + b = total")).toBe("(= total (add a b))")
  })

  test("with conversion via 'as'", () => {
    expect(show("unit kzt currency\nsalary as kzt = salaryInKzt")).toBe(
      "(unit kzt (alias currency))\n(= salaryInKzt (as salary kzt))",
    )
  })
})

describe("bare expressions", () => {
  test("simple", () => {
    expect(show("1 + 2 * 3")).toBe("(add 1 (mul 2 3))")
  })

  test("quantity literals (right operand wins later in eval)", () => {
    const src = ["unit usd base currency", "unit rub currency", "100 rub + 5 usd"].join("\n")
    expect(show(src)).toBe(
      [
        "(unit usd (base currency))",
        "(unit rub (alias currency))",
        "(add (qty 100 rub) (qty 5 usd))",
      ].join("\n"),
    )
  })

  test("conversion in expression", () => {
    const src = "unit kzt currency\n100 rub + 5 usd as eur"
    const { program } = parse(src)
    expect(showStatement(program.statements[2] ?? program.statements[1]!)).toContain("(as ")
  })

  test("quantity used in arithmetic", () => {
    const src = "unit kg base mass\n2 kg * 3"
    expect(show(src)).toBe(
      "(unit kg (base mass))\n(mul (qty 2 kg) 3)",
    )
  })
})

describe("unit expressions", () => {
  test("simple ref", () => {
    expect(show("unit gr (kg)")).toBe("(unit gr (composite kg))")
  })

  test("power", () => {
    expect(show("unit hz (1 / s ^ 1)")).toBe(
      "(unit hz (composite (div 1 (pow s 1))))",
    )
  })

  test("composite with mul and div", () => {
    const src = "unit a base x\nunit b base y\nunit ab (a * b / 2)"
    expect(show(src)).toBe(
      [
        "(unit a (base x))",
        "(unit b (base y))",
        "(unit ab (composite (div (mul a b) 2)))",
      ].join("\n"),
    )
  })

  test("negative integer exponent in unit_expr (inside as conversion)", () => {
    // s^-2 appears in unit_expr — the rhs of `as` is unit_expr, not Expr
    const src = "unit m base length\nunit s base time\n9,8 (m / s ^ 2) g\ng as m * s ^ -2"
    const { program } = parse(src)
    const conversion = showStatement(program.statements[3]!)
    expect(conversion).toBe("(as g (mul m (pow s -2)))")
  })
})

describe("program structure and recovery", () => {
  test("blank lines and comments are ignored between statements", () => {
    const src = ["# header", "", "unit kg base mass", "", "# done"].join("\n")
    expect(show(src)).toBe("(unit kg (base mass))")
  })

  test("error in one line does not stop later lines", () => {
    const src = ["bad +", "unit kg base mass"].join("\n")
    const { program, diagnostics } = parse(src)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(program.statements.length).toBe(1)
    expect(showStatement(program.statements[0]!)).toBe("(unit kg (base mass))")
  })

  test("extra tokens after a statement get a diagnostic", () => {
    const { diagnostics } = parse("42 answer extraJunk")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  test("dispatch is purely structural — does not depend on token semantics", () => {
    // `35,5 kg + 1` is an expression, not a var_decl, because `+` follows kg.
    const src = "unit kg base mass\n35,5 kg + 1"
    expect(show(src)).toBe(
      "(unit kg (base mass))\n(add (qty 35.5 kg) 1)",
    )
  })
})

describe("budget.calc round-trip", () => {
  test("full file parses without diagnostics", async () => {
    const file = Bun.file(`${import.meta.dir}/../../examples/budget.calc`)
    const src = await file.text()
    const { program, diagnostics } = parse(src)
    expect(diagnostics).toEqual([])
    // 7 unit decls + 3 variable_decl + 2 expr_assignment + 1 bare expression
    const kinds = program.statements.map((s) => s.type)
    expect(kinds.filter((k) => k === "unitDecl")).toHaveLength(7)
    expect(kinds.filter((k) => k === "variableDecl")).toHaveLength(3)
    expect(kinds.filter((k) => k === "exprAssignment")).toHaveLength(2)
    expect(kinds.filter((k) => k === "exprStatement")).toHaveLength(1)
  })
})
