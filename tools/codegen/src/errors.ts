import { Data } from "effect"

/** An allowlisted operationId matched no operation in the spec — likely a typo, fail loudly instead of silently generating an empty client. */
export class AllowlistOperationNotFound extends Data.TaggedError("AllowlistOperationNotFound")<{
  readonly operationIds: ReadonlyArray<string>
}> {}

/** Regenerated source differs from the committed output — upstream spec/patch drift, per FR-4.4/AC-5. */
export class DriftDetected extends Data.TaggedError("DriftDetected")<{
  readonly committedPath: string
  readonly firstDiffLine: number
}> {}

export type CodegenError = AllowlistOperationNotFound | DriftDetected
