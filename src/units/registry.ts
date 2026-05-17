import Decimal from "decimal.js"
import { UnitError } from "./errors.ts"
import type { Quantity } from "./quantity.ts"
import { makeNamedUnit, type Unit } from "./unit.ts"

export class UnitRegistry {
  private readonly byName = new Map<string, Unit>()

  /** declare X base DIM — fresh dimension with unit factor 1. */
  registerBase(name: string, dimension: string): Unit {
    return this.add(
      makeNamedUnit(name, { [dimension]: 1 }, new Decimal(1)),
    )
  }

  /**
   * declare X DIM — placeholder for dynamic-rate units (currencies that
   * would consult an FX provider). In MVP this is identical to base; the
   * interface is in place so a future stage can attach a rate source.
   */
  registerAlias(name: string, dimension: string): Unit {
    return this.add(
      makeNamedUnit(name, { [dimension]: 1 }, new Decimal(1)),
    )
  }

  /**
   * declare X (expr) — the expression was already evaluated by the caller
   * to produce `value`. The factor of the new unit is `value.value *
   * value.unit.factor` (i.e. how many base units one of X is worth).
   */
  registerDerived(name: string, value: Quantity): Unit {
    if (!value.unit) {
      throw new UnitError(
        `cannot derive unit '${name}' from a dimensionless value`,
        `the body of 'declare ${name} (...)' must reference at least one declared unit`,
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
