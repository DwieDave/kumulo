import { Data } from "effect"

/** FR-2.3 — the self-managed (k3s) phase pipeline isn't wired into the CLI yet (M7). */
export class DistroNotWired extends Data.TaggedError("DistroNotWired")<{
  readonly distro: string
}> {}
