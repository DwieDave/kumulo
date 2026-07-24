import type { Effect } from "effect"

/** One diagnostic outcome, always actionable when it fails. */
export interface DoctorCheckResult {
  readonly name: string
  readonly status: "pass" | "fail"
  readonly message: string
}

/**
 * A single pluggable doctor check. `run` never fails (diagnostics report
 * problems as a `DoctorCheckResult`, they don't throw) so the registry can
 * run every check and collect results without a `catchAll` at each call
 * site.
 */
export interface DoctorCheck {
  readonly name: string
  readonly run: Effect.Effect<DoctorCheckResult>
}
