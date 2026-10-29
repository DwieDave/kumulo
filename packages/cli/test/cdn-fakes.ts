import { Duration, Effect, Ref } from "effect"
import { makeBunnyPullZoneClient, makeBunnyShieldClient, makeFakePullZoneServer, makeFakeShield } from "@kumulo/bunny"
import { emptyCdnOutputs, makeBunnyCdnProvider, makeBunnyShield } from "@kumulo/cdn-bunny"
import type { CdnOutputsFile } from "@kumulo/cdn-bunny"
import type { CdnHandle } from "../src/cdn.ts"

export const makeFakeCdn = (
  options: {
    readonly outputs?: CdnOutputsFile
    readonly certificateTimeout?: Duration.Input
    readonly pullZone?: ReturnType<typeof makeFakePullZoneServer>
    readonly shield?: ReturnType<typeof makeFakeShield>
  } = {}
) => {
  const pullZone = options.pullZone ?? makeFakePullZoneServer()
  const shieldFake = options.shield ?? makeFakeShield()
  const state = Ref.makeUnsafe(options.outputs ?? emptyCdnOutputs("staging"))
  const warnings = Ref.makeUnsafe<ReadonlyArray<string>>([])
  const persisted: Array<CdnOutputsFile> = []

  const provider = makeBunnyCdnProvider({
    pullZone: makeBunnyPullZoneClient(pullZone.httpClient),
    ownedId: options.outputs?.pullZoneId,
    shield: makeBunnyShield({ shield: makeBunnyShieldClient(shieldFake.httpClient), outputs: state }),
    certificateTimeout: options.certificateTimeout ?? Duration.seconds(30),
    certificateBaseDelay: Duration.millis(5)
  })

  const handle: CdnHandle = {
    name: "stagingeu",
    provider,
    state,
    warnings,
    persist: Effect.flatMap(Ref.get(state), (file) => Effect.sync(() => void persisted.push(file)))
  }

  return { handle, pullZone, shield: shieldFake, state, persisted, warnings }
}

export const cdnYamlBlock = (extra = "") => `cdn:
  module: bunny
  name: stagingeu
  origin: ingress
  hostnames:
    - app.example.com
${extra}`

export const resumeFakeCdn = (previous: ReturnType<typeof makeFakeCdn>) =>
  makeFakeCdn({ outputs: previous.persisted.at(-1), pullZone: previous.pullZone, shield: previous.shield })
