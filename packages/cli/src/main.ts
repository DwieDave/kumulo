import { BunRuntime } from "@effect/platform-bun"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as BunServices from "@effect/platform-bun/BunServices"
import { Console, Effect, Layer } from "effect"
import { CliError, Command } from "effect/unstable/cli"
import { kumuloCli } from "./commands.ts"
import { OpenStackEnvLive } from "./doctor-openstack/env.ts"
import { renderCliError } from "./errors.ts"
import { MksEnvLive } from "./mks/env.ts"

// FR-3.2 — explicit Layer wiring at the composition root, no runtime module
// discovery. `ovh-mks` is the only live distro command path; `k3s` (M7) will
// add a sibling command path once its phase pipeline lands, reusing
// `OpenStackEnv` (T6.3) — already wired in here (never-failing, see its
// doc comment) so `doctor`'s OpenStack checks and the future k3s path share
// one Keystone auth/region source instead of each re-deriving it.
const MainLive = Layer.merge(MksEnvLive, OpenStackEnvLive).pipe(Layer.provide(BunHttpClient.layer))

const program = Command.run(kumuloCli, { version: "0.0.0" }).pipe(
  Effect.provide(MainLive),
  Effect.provide(BunServices.layer),
  Effect.matchEffect({
    onFailure: (error) =>
      Effect.gen(function*() {
        const message = CliError.isCliError(error) ? error.message : renderCliError(error)
        yield* Console.error(message)
        process.exitCode = 1
      }),
    onSuccess: () => Effect.void
  })
)

BunRuntime.runMain(program)
