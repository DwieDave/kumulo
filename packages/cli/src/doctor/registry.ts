import { Effect } from "effect"
import type { DoctorCheck, DoctorCheckResult } from "./types.ts"

/**
 * Runs every registered check and collects all results — a failing check
 * never stops the others from running, so a `doctor` invocation always
 * reports the full picture in one pass. New checks (the OpenStack half,
 * T6.3) just append to the array passed in here; this file never changes.
 */
export const runChecks = (checks: ReadonlyArray<DoctorCheck>): Effect.Effect<ReadonlyArray<DoctorCheckResult>> =>
  Effect.forEach(checks, (check) => check.run)
