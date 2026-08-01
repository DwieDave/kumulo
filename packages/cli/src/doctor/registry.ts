import { Effect } from "effect"
import type { DoctorCheck, DoctorCheckResult } from "./types.ts"

export const runChecks = (checks: ReadonlyArray<DoctorCheck>): Effect.Effect<ReadonlyArray<DoctorCheckResult>> =>
  Effect.forEach(checks, (check) => check.run)
