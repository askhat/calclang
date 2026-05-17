import Decimal from "decimal.js"
import { UnitError } from "./errors.ts"
import type { Quantity } from "./quantity.ts"
import { makeNamedUnit, type Unit } from "./unit.ts"

export class UnitRegistry {
  private readonly byName = new Map<string, Unit>()

  /**
   * UNIT <Dim> <name> — factor 1 in the named dimension. The first such
   * declaration in a dimension creates the dimension and is the base;
   * subsequent ones are placeholders (factor 1 in MVP; would consult an
   * external rate source for currencies in a future stage).
   */
  registerSimple(name: string, dimension: string): Unit {
    return this.add(
      makeNamedUnit(name, { [dimension]: 1 }, new Decimal(1)),
    )
  }

  /**
   * UNIT <Dim> <name> (expr) — the body evaluated to `value`. The unit's
   * factor is `value.value * value.unit.factor` (how many base units one
   * of `name` is worth). The caller is expected to have already verified
   * that value.unit.dimension matches the declared dimension.
   */
  registerDerived(name: string, value: Quantity): Unit {
    if (!value.unit) {
      throw new UnitError(
        `cannot derive unit '${name}' from a dimensionless value`,
        `the body of 'UNIT <Dim> ${name} (...)' must reference at least one declared unit`,
      )
    }
    return this.add(
      makeNamedUnit(
        name,
        value.unit.dimension,
        value.value.times(value.unit.factor),
      ),
    )
  }

  private add(u: Unit): Unit {
    const existing = this.byName.get(u.name)
    if (existing) {
      throw new UnitError(
        `unit '${u.name}' already declared`,
        `each unit name can only be declared once`,
      )
    }
    this.byName.set(u.name, u)
    return u
  }

  get(name: string): Unit | undefined {
    return this.byName.get(name)
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  /** Iteration in declaration order — useful for the REPL and debug dumps. */
  *all(): IterableIterator<Unit> {
    yield* this.byName.values()
  }
}
