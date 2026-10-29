import type { Effect } from "effect";
import { Context } from "effect"
import type { AuthenticationFailed } from "@kumulo/core"

export interface OvhAuthService {
  readonly token: Effect.Effect<string, AuthenticationFailed>
}

export class OvhAuth extends Context.Service<OvhAuth, OvhAuthService>()("@kumulo/provider-ovh/OvhAuth") {}
