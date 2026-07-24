import { Effect } from "effect"
import { BootstrapFailed } from "@kumulo/core"
import { Ssh } from "../ssh/port.ts"
import type { SshHost } from "../ssh/port.ts"
import { cloudInitReady, controlPlaneReady, sshReady } from "../ssh/readiness.ts"
import { renderAgentInstallScript, renderServerInstallScript } from "./install-script.ts"
import { installMasters, installWorkers } from "./orchestrate.ts"
import { resolveToken } from "./token.ts"
import type { NonEmptyMasters } from "./token.ts"

export interface RunBootstrapArgs {
  readonly masters: NonEmptyMasters
  readonly workers: ReadonlyArray<SshHost>
  readonly k3sVersion: string
  readonly tlsSans: ReadonlyArray<string>
  readonly cloudControllerManager: boolean
  readonly cni: "flannel" | "cilium"
  readonly extraServerArgs: ReadonlyArray<string>
  readonly extraAgentArgs: ReadonlyArray<string>
  readonly nodeLabels?: Readonly<Record<string, string>>
  readonly nodeTaints?: ReadonlyArray<string>
}

export interface BootstrapResult {
  readonly token: string
  readonly firstMaster: SshHost
}

// cloud-init/ssh readiness always gate an install; controlPlaneReady
// only gates master 1 (the others' `--server` join needs it already serving).
const _gateBefore = (host: SshHost): Effect.Effect<void, BootstrapFailed, Ssh> =>
  cloudInitReady(host).pipe(Effect.andThen(sshReady(host)))

const _exec = (host: SshHost, script: string, phase: string): Effect.Effect<void, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    yield* ssh.exec(host, script).pipe(
      Effect.mapError((cause) => new BootstrapFailed({ node: host.ip, phase, log: String(cause) }))
    )
  })

/** The real (executed, not merely rendered) master install path. */
const _installMaster = (
  args: RunBootstrapArgs,
  token: string,
  firstMaster: SshHost
) =>
(host: SshHost, isFirstMaster: boolean): Effect.Effect<void, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    yield* _gateBefore(host)
    const script = renderServerInstallScript({
      k3sVersion: args.k3sVersion,
      token,
      isFirstMaster,
      firstMasterIp: firstMaster.ip,
      privateIp: host.ip,
      publicIp: host.ip,
      tlsSans: args.tlsSans,
      addons: { cloudControllerManager: args.cloudControllerManager, cni: args.cni },
      extraServerArgs: args.extraServerArgs
    })
    yield* _exec(host, script, "install-master")
    if (isFirstMaster) yield* controlPlaneReady(host)
  })

/** The real (executed) worker install path. */
const _installWorker = (
  args: RunBootstrapArgs,
  token: string,
  firstMaster: SshHost
) =>
(host: SshHost): Effect.Effect<void, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    yield* _gateBefore(host)
    const script = renderAgentInstallScript({
      k3sVersion: args.k3sVersion,
      token,
      firstMasterIp: firstMaster.ip,
      privateIp: host.ip,
      publicIp: host.ip,
      nodeLabels: args.nodeLabels ?? {},
      nodeTaints: args.nodeTaints ?? [],
      extraAgentArgs: args.extraAgentArgs
    })
    yield* _exec(host, script, "install-worker")
  })

/**
 * The single production Bootstrap-phase entrypoint: resolve the
 * join token/first-master, then install masters (serial-first
 * then parallel) and workers, each gated by readiness and actually executed
 * over the `Ssh` port (not just rendered).
 */
export const runBootstrap = (args: RunBootstrapArgs): Effect.Effect<BootstrapResult, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const { firstMaster, token } = yield* resolveToken(args.masters)
    yield* installMasters({ masters: args.masters, installOne: _installMaster(args, token, firstMaster) })
    yield* installWorkers({ workers: args.workers, installOne: _installWorker(args, token, firstMaster) })
    return { token, firstMaster }
  })
