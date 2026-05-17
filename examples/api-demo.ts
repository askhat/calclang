// Stage 4 demo: build the units and quantities from budget.calc by hand and
// run the computations the file describes. Stage 5 will wire this to the
// parser/evaluator and let `.calc` files drive it directly.

import Decimal from "decimal.js"
import * as Q from "../src/units/quantity.ts"
import { UnitRegistry } from "../src/units/registry.ts"

const reg = new UnitRegistry()

// unit usd base currency
const usd = reg.registerBase("usd", "currency")
// unit kzt (usd / 467,245543)
const kzt = reg.registerDerived(
  "kzt",
  Q.div(Q.ofUnit(1, usd), Q.dimensionless("467.245543")),
)
// unit rub (usd / 90,5)
const rub = reg.registerDerived(
  "rub",
  Q.div(Q.ofUnit(1, usd), Q.dimensionless("90.5")),
)

// -10 minusTen
const minusTen = Q.dimensionless(-10)
// 35,5 rub salary
const salary = Q.ofUnit("35.5", rub)

// salary + minusTen = total       # 25,5 rub
const total = Q.add(salary, minusTen)
console.log(`salary + minusTen = ${fmt(total)}     # expected: 25.5 rub`)

// salary as kzt = salaryInKzt
const salaryInKzt = Q.convert(salary, kzt)
console.log(`salary as kzt     = ${fmt(salaryInKzt)}`)

// 100 rub + 5 usd  (right operand wins, rubles convert to dollars)
const sum = Q.add(Q.ofUnit(100, rub), Q.ofUnit(5, usd))
console.log(`100 rub + 5 usd   = ${fmt(sum)}`)

// kg + rub → dimension mismatch
const kg = reg.registerBase("kg", "mass")
try {
  Q.add(Q.ofUnit(1, kg), Q.ofUnit(1, rub))
} catch (e) {
  console.log(`1 kg + 1 rub      → error: ${(e as Error).message}`)
}

function fmt(q: Q.Quantity): string {
  const value = q.value.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toString()
  return q.unit ? `${value} ${q.unit.name}` : value
}
