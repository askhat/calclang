# Calc

A text-based calculator language with first-class units, decimal arithmetic,
and lazy reference resolution. Aiming at the Soulver/Numi niche but with a
real dimensional type system on top — `kg + rub` is a compile-time error, not
a silent string concat.

```calc
UNIT Currency usd
UNIT (usd / 90,5) rub
UNIT Mass kg

35,5 rub salary
70 kg weight

salary + 10 = total           // = 45,5 rub
salary as usd                 // = 0,392265 usd
# see examples/physics.calc for kinematics with kg·m/s^2
```

## Running

```sh
bun install
bun run src/index.ts examples/budget.calc   # evaluate a file
bun run src/index.ts                        # REPL
bun run src/index.ts --tokens file.calc     # token dump
bun run src/index.ts --ast file.calc        # AST dump
bun test                                    # 460+ tests
```

In the REPL, `:help` lists commands; `:units` and `:vars` dump the current
environment; `:exit` (or Ctrl+D) quits.

## Syntax

A `.calc` file is a sequence of lines, one statement per line. There are
four kinds of statement and one kind of directive-comment.

**Comments.** `# anything to end of line.`

**Unit declarations.** `UNIT` is a case-sensitive uppercase keyword.
Dimensions are Capitalized (Mass, Length, Currency, …); unit and variable
names are lowercase. Two equivalent surface forms — pick the one that
reads better in context:

```calc
UNIT Mass kg                     # simple — factor 1 in dimension Mass
UNIT Mass gr (kg / 1_000)        # composite with explicit dim — body must match
UNIT (kg / 1_000) gr             # composite with inferred dim — body decides
UNIT Currency usd                # first decl creates the Currency dimension
UNIT Currency kzt                # second decl is a placeholder for dynamic FX
```

**Variable declarations.** `[+|-]? NUMBER [unit_expr] IDENT`. The trailing
identifier is the variable's name.

```calc
-10 minusTen                        # dimensionless
35,5 rub salary                     # with a simple unit
9,8 (m / s ^ 2) gravity             # with a composite unit
```

**Expression assignments.** `expression = IDENT`.

```calc
salary + minusTen = total
salary as kzt = salaryInKzt
```

**Bare expressions.** Anything that doesn't match the above. Useful as
anonymous one-offs.

```calc
100 rub + 5 usd                     # right unit wins → 6,10... usd
2 kg flour                          # var_decl, but in expression position it'd be a quantity literal
```

**Percentages.** Postfix `%` turns any primary expression into a fraction
(`20%` = 0,20). `of` is a multiplication synonym that reads naturally —
`20% of 1000` = 200. Two contextual rules:

```calc
100 + 20%                           # = 120  (Soulver-style: scale left by 1+p)
1000 - 13%                          # = 870
100 rub + 15%                       # = 115 rub
20% + 30%                           # = 50%  (both percents → percent)
20% of 50%                          # = 10%  (combine rates)
20% of 1000                         # = 200  (mixed → plain)
(1 + rate%)^years                   # rate% coerces to fraction in arithmetic
```

When both operands of `+`/`-` are percents, the result is a percent.
`<Quantity> ± <Percent>` is the Soulver "of left" rule. Everywhere else
percent silently collapses into its dimensionless fraction.

**Series and ranges.** Both are iterable collections with the same
aggregate methods (`.sum`, `.avg`, `.count`, `.min`, `.max`).

```calc
SERIES wallet                       # explicit members, one per line
100 rub
5 usd
wallet.sum                          # in series unit (last explicit)

1..10 days                          # inclusive: 1, 2, ..., 10
1...10                              # exclusive: 1, 2, ..., 9
10..1                               # walks down: 10, 9, ..., 1
1..10/3                             # custom step: {1, 3, 6, 9}
1..10/100                           # step past end: just {1} (start anchor)
1...10/100                          # exclusive + no inner multiples → {}
RANGE prices 1 usd 10 usd           # keyword form (inclusive)
prices.avg                          # 5,5 usd
(1..100).sum                        # inline parenthesized → 5 050
```

Range semantics is **snap-to-multiples**: `start` is always anchored, then
multiples of `step` within `(start, end]` (or `(start, end)` for exclusive)
are appended. So `1..10/5` is `{1, 5, 10}`, not the classic arithmetic
`{1, 6}`. To force division inside an endpoint, wrap in parens: `1..(10/3)`.

## Semantics in one minute

- **Numbers are `Decimal`,** not floating-point. `0,1 + 0,2 == 0,3` is true.
- **Decimal separator is locale-aware,** defaulting to `,` (RU/EU). `_` groups thousands in source: `1_000_000`.
- **Lazy reference resolution.** Line order doesn't matter — `salary` may be
  referenced on a line that comes before its declaration. Cycles are caught
  and reported as `cyclic dependency: a → b → a`.
- **Right operand's unit wins** in `+` / `-`. To force a unit, use `as`:
  `100 rub + 5 usd` is in `usd`; `100 rub + 5 usd as eur` would be in `eur`.
- **Mixed dimensionless + dimensioned** is allowed: `salary + 10` adds 10 in
  the same unit as `salary`. `salary > 0` is true.
- **Mismatched dimensions error.** `1 kg + 1 rub` →
  `cannot add kg (Mass) and rub (Currency)`.
- **Composite unit names are canonical.** `m * m` shows as `m^2`,
  `kg * m / s^2` shows as `kg·m/s^2` regardless of construction order.

## Output

Calc re-prints your source with `// = result` annotations to the right of
each line that produced a value. Pure declarations stay annotation-free.

```
salary + minusTen = total       # ...    // = 25,5 rub
salary as kzt = salaryInKzt              // = 183,284163 kzt
100 rub + 5 usd                          // = 6,104972 usd
```

Errors render inline as `// error: …` with an optional hint.

```
foo + 1                                  // error: undefined name 'foo' (did you mean 'flour'?)
1 / 0                                    // error: division by zero
```

## Architecture

- `src/lexer/` — locale-aware tokenizer; tokens carry line/col.
- `src/parser/` — hand-rolled recursive descent + Pratt for expressions, with
  a two-pass unit-name collection so primaries can recognize `35 rub`.
- `src/units/` — `Dimension`, `Unit` (with an atom map for canonical names),
  `Quantity` arithmetic, `UnitRegistry`.
- `src/eval/` — `Evaluator` with a lazy environment; cycle detection via a
  shared resolving stack.
- `src/format/` — locale-aware number formatting, ANSI color helpers,
  Soulver-style source annotation, REPL line rendering.
- `src/repl/` — `node:readline` REPL with `:help`, `:units`, `:vars`.
- `src/util/` — Levenshtein for "did you mean …?" suggestions.

The grammar lives in the original brief; the EBNF and the resolution-table
for `NUMBER WORD WORD` are the load-bearing parts. The parser dispatch is
purely structural — fixed-distance lookahead, no backtracking.

## Not in MVP

- `# locale en-US` and `# precision N` directives (scaffolding in place but
  not wired).
- Live FX rates for `unit X currency` aliases.
- Loops (recursion via `if/then/else` works; see `examples/functions.calc`).
- Running-total syntax (`+ 50` on its own line).
- Multi-line REPL input.
- LSP and editor integrations.

## Stage-by-stage commit history

Each commit on `main` covers one MVP stage. Walk back through them to see
the language take shape:

```
stage 0  scaffold              Bun + TS + decimal.js
stage 1  lexer                 locale-aware, collected diagnostics
stage 2  expression parser     recursive descent + Pratt
stage 3  declarations          unit + variable decls, two-pass NUMBER-WORD disambiguation
stage 4  units & quantities    DimensionVector + Quantity arithmetic
stage 5  evaluator              lazy env + Soulver-style annotated output
stage 6  REPL                   persistent env, colored diagnostics
stage 7  polish                 unit-name canonicalization, suggestions, golden tests
stage 8  percent                postfix '%' literal, 'of' operator, Soulver-style +/- rule
```
