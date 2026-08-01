// one module rather than five two-line files; split per service the day one of them needs more than a base URL.
import { Effect } from "effect"
import { HttpApiClient } from "effect/unstable/httpapi"
import { KeystoneAuth } from "../auth/keystone-auth.ts"
import { Glance } from "../generated/glance.ts"
import { Neutron } from "../generated/neutron.ts"
import { Nova } from "../generated/nova.ts"
import { Octavia } from "../generated/octavia.ts"
import { failNon2xx } from "../transport/http-client.ts"

const _base = (service: string, region: string) =>
  Effect.gen(function*() {
    const auth = yield* KeystoneAuth
    const url = yield* auth.endpoint({ service, region })
    return url.replace(/\/+$/, "")
  })

export const novaClient = (region: string) =>
  Effect.flatMap(
    _base("compute", region),
    (baseUrl) => HttpApiClient.make(Nova, { baseUrl, transformClient: failNon2xx })
  )

export const neutronClient = (region: string) =>
  Effect.flatMap(
    _base("network", region),
    (baseUrl) => HttpApiClient.make(Neutron, { baseUrl, transformClient: failNon2xx })
  )

export const glanceClient = (region: string) =>
  Effect.flatMap(
    _base("image", region),
    (baseUrl) => HttpApiClient.make(Glance, { baseUrl, transformClient: failNon2xx })
  )

export const octaviaClient = (region: string) =>
  Effect.flatMap(
    _base("load-balancer", region),
    (baseUrl) => HttpApiClient.make(Octavia, { baseUrl, transformClient: failNon2xx })
  )
