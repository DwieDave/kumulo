import { Data } from "effect"

/** Raised when the converter meets an OVH schema construct it doesn't (yet) mechanically translate. */
export class ConversionUnsupported extends Data.TaggedError("ConversionUnsupported")<{
  readonly construct: string
  readonly detail: string
}> {}
