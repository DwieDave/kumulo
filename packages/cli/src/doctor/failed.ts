import { Data } from "effect"

export class DoctorFailed extends Data.TaggedError("DoctorFailed")<{
  readonly failed: ReadonlyArray<string>
}> {}
