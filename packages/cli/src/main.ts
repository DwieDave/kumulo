import { BunRuntime } from "@effect/platform-bun"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as BunServices from "@effect/platform-bun/BunServices"
import { Console, Effect, Layer } from "effect"
import { CliError, Command } from "effect/unstable/cli"
import { kumuloCli } from "./commands.ts"
import { OpenStackEnvLive } from "./doctor-openstack/env.ts"
import { exitCodeFor } from "./exit-codes.ts"
import { renderCliError } from "./errors.ts"
import { MksEnvLive } from "./mks/env.ts"
import { CinderAuthLive } from "./volumes/env.ts"

// FR-3.2 — explicit Layer wiring at the composition root, no runtime module
// discovery. `ovh-mks` is the only live distro command path; `k3s` (M7) will
// add a sibling command path once its phase pipeline lands, reusing
// `OpenStackEnv` (T6.3) — already wired in here (never-failing, see its
// doc comment) so `doctor`'s OpenStack checks and the future k3s path share
// one Keystone auth/region source instead of each re-deriving it.
// `CinderAuthLive` (T10.1, AC-7) is derived from that same `OpenStackEnv`
// (`Layer.provideMerge` keeps `OpenStackEnv` itself exposed too, since the
// doctor checks still need it directly) — volumes (Cinder) are a plain
// OpenStack service shared by both distros, no separate credential set.
// `HttpClient.HttpClient` stays in the exposed environment too (not just
// consumed while building the other layers) — `VolumeProvider` is composed
// per-cluster at command runtime (T10.1's `reconcileVolumesOnDelete`), not
// at Layer-build time, so it still needs an ambient `HttpClient` to reach.
const MainLive = Layer.mergeAll(
  MksEnvLive,
  CinderAuthLive.pipe(Layer.provideMerge(OpenStackEnvLive)),
  BunHttpClient.layer
).pipe(Layer.provide(BunHttpClient.layer))

const program = Command.run(kumuloCli, { version: "0.0.0" }).pipe(
  Effect.provide(MainLive),
  Effect.provide(BunServices.layer),
  Effect.matchEffect({
    onFailure: (error) =>
      Effect.gen(function*() {
        const message = CliError.isCliError(error) ? error.message : renderCliError(error)
        yield* Console.error(message)
        process.exitCode = CliError.isCliError(error) ? 64 : exitCodeFor(error)
      }),
    onSuccess: () => Effect.void
  })
)

BunRuntime.runMain(program)
