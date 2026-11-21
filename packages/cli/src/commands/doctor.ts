import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { loadConfig } from "../config.ts"
import { onDistro } from "../distro/registry.ts"
import { dnsDoctorChecks } from "../doctor/dns.ts"
import { DoctorFailed } from "../doctor/failed.ts"
import { runChecks } from "../doctor/registry.ts"
import type { DoctorCheckResult } from "../doctor/types.ts"
import { green, red } from "../present.ts"
import { configArgument } from "../root.ts"

const _line = (result: DoctorCheckResult): string =>
  result.status === "pass" ? `${green("pass")} ${result.name}: ${result.message}` : `${red("fail")} ${result.name}: ${result.message}`

export const doctorFlow = Effect.fn(function*(configPath: string) {
  const config = yield* loadConfig(configPath)
  const checks = yield* onDistro(config)(({ config: cfg, entry }) => entry.doctorChecks({ config: cfg }))
  const dnsChecks = yield* dnsDoctorChecks(config)
  const results = yield* runChecks([...checks, ...dnsChecks])
  yield* Effect.forEach(results, (result) => Console.log(_line(result)), { discard: true })
  const failed = results.filter((result) => result.status === "fail").map((result) => result.name)

  if (failed.length > 0) return yield* new DoctorFailed({ failed })
})

export const doctor = Command.make("doctor", { config: configArgument() }, ({ config }) => doctorFlow(config)).pipe(
  Command.withDescription("Run the selected distro's preflight checks against its provider, then the DNS module's")
)
