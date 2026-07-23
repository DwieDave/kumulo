import { Context, Effect } from "effect"
import type { AuthenticationFailed } from "@kumulo/core"

// kumulo: design's preferred placement was `packages/core/src/ports` (effect-only
// port, provider-specific impl in provider-ovh). `packages/core/src/index.ts` is
// explicitly off-limits to this task (owned by the integration step wiring
// barrels — see task instructions), and cross-package imports here are only
// allowed through a package's root `index.ts` (dependency-cruiser
// `no-deep-package-imports`), so a core-side port would be unreachable from
// provider-ovh without editing that barrel. Kept the port + implementation
// together in provider-ovh instead; still passes `bun run lint:deps` (OvhAuth
// is provider-ovh-specific, unlike the cross-cutting Distro/DnsProvider/
// CloudProvider ports every provider implements).
export interface OvhAuthShape {
  /** Bearer token for OVH API v1/v2 requests, cached with expiry skew and refreshed on demand. */
  readonly token: Effect.Effect<string, AuthenticationFailed>
}

export class OvhAuth extends Context.Service<OvhAuth, OvhAuthShape>()("@kumulo/provider-ovh/OvhAuth") {}
