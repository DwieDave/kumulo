import type { VolumeError } from "@kumulo/core"
import type { Effect } from "effect";
import { Context } from "effect"

// The auth transport fails for the same reasons every other Cinder call does
// — a Keystone outage, a 429 or a malformed catalog is not "bad credentials".
// Reusing `VolumeError` keeps those tags intact through the port instead of
// flattening them into `AuthenticationFailed`.
export type CinderAuthError = VolumeError

// kumulo: mirrors openstack's KeystoneAuth shape but owned by this package —
// dep-lint forbids sibling-package imports (@kumulo/openstack -> here), so
// this module defines its own minimal transport contract. CLI wiring
// provides `CinderAuthLive` built from `@kumulo/openstack`'s real
// Keystone auth; that composition happens outside this package's boundary.
export class CinderAuth extends Context.Service<CinderAuth, {
  readonly token: Effect.Effect<string, CinderAuthError>
  readonly endpoint: Effect.Effect<string, CinderAuthError>
}>()("@kumulo/volumes-cinder/CinderAuth") {}
