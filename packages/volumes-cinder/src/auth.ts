import type { AuthenticationFailed } from "@kumulo/core"
import { Context, Effect } from "effect"

// kumulo: mirrors openstack's KeystoneAuth shape but owned by this package —
// dep-lint forbids sibling-package imports (@kumulo/openstack -> here), so
// this module defines its own minimal transport contract. CLI wiring
// provides `CinderAuthLive` built from `@kumulo/openstack`'s real
// Keystone auth; that composition happens outside this package's boundary.
export class CinderAuth extends Context.Service<CinderAuth, {
  readonly token: Effect.Effect<string, AuthenticationFailed>
  readonly endpoint: Effect.Effect<string, AuthenticationFailed>
}>()("@kumulo/volumes-cinder/CinderAuth") {}
