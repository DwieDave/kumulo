import type { VolumeError } from "@kumulo/core"
import type { Effect } from "effect";
import { Context } from "effect"

export type CinderAuthError = VolumeError

export class CinderAuth extends Context.Service<CinderAuth, {
  readonly token: Effect.Effect<string, CinderAuthError>
  readonly endpoint: Effect.Effect<string, CinderAuthError>
}>()("@kumulo/volumes-cinder/CinderAuth") {}
