import type Decimal from "decimal.js"
import type { DimensionVector } from "./dimension.ts"

export type Unit = {
  readonly name: string
  readonly dimension: DimensionVector
  /** How many base units of this dimension equal one of this unit. */
  readonly factor: Decimal
}
