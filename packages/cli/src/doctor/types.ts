import type { Effect } from "effect"

export interface DoctorCheckResult {
  readonly name: string
  readonly status: "pass" | "fail"
  readonly message: string
}

export interface DoctorCheck {
  readonly name: string
  readonly run: Effect.Effect<DoctorCheckResult>
}
