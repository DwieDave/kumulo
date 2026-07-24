import { Data } from "effect"

/** The self-managed (k3s) phase pipeline isn't wired into the CLI yet. */
export class DistroNotWired extends Data.TaggedError("DistroNotWired")<{
  readonly distro: string
}> {}
