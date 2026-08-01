import { Effect, Schedule } from "effect"
import type { Context, Duration } from "effect"
import { BootstrapFailed, pollUntil } from "@kumulo/core"
import { Ssh } from "./port.ts"
import type { SshHost } from "./port.ts"

const CLOUD_INIT_POLL_INTERVAL = "5 seconds"
const CLOUD_INIT_TIMEOUT = "300 seconds"
const CLOUD_INIT_MARKER = "/var/lib/cloud/instance/boot-finished"

const SSH_READY_POLL_INTERVAL = "5 seconds"
const SSH_READY_TIMEOUT = "100 seconds"

const CLUSTER_INFO_MAX_ATTEMPTS = 3
const CLUSTER_INFO_ATTEMPT_TIMEOUT = "30 seconds"

const _asReady = <E>(effect: Effect.Effect<unknown, E>): Effect.Effect<boolean> =>
  effect.pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))

const _pollReady = (args: {
  readonly host: SshHost
  readonly check: Effect.Effect<boolean>
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
  readonly kind: string
  readonly phase: string
}): Effect.Effect<void, BootstrapFailed> =>
  pollUntil({
    check: args.check,
    isDone: (ready: boolean) => ready,
    interval: args.interval,
    timeout: args.timeout,
    kind: args.kind,
    ref: args.host.ip
  }).pipe(
    Effect.asVoid,
    Effect.mapError(() => new BootstrapFailed({ node: args.host.ip, phase: args.phase, log: `${args.kind} never became ready` }))
  )

export const cloudInitReady = (host: SshHost): Effect.Effect<void, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    yield* _pollReady({
      host,
      check: _asReady(ssh.exec(host, `test -f ${CLOUD_INIT_MARKER}`)),
      interval: CLOUD_INIT_POLL_INTERVAL,
      timeout: CLOUD_INIT_TIMEOUT,
      kind: "cloud-init",
      phase: "cloud-init"
    })
  })

export const sshReady = (host: SshHost): Effect.Effect<void, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    yield* _pollReady({
      host,
      check: _asReady(ssh.waitReady(host)),
      interval: SSH_READY_POLL_INTERVAL,
      timeout: SSH_READY_TIMEOUT,
      kind: "ssh",
      phase: "ssh-ready"
    })
  })

const _clusterInfoReady = (
  host: SshHost,
  ssh: Context.Service.Shape<typeof Ssh>,
  args: { readonly attempts: number; readonly attemptTimeout: Duration.Input }
): Effect.Effect<void, BootstrapFailed> =>
  ssh.exec(host, "kubectl cluster-info").pipe(
    Effect.timeoutOrElse({
      duration: args.attemptTimeout,
      orElse: () =>
        Effect.fail(new BootstrapFailed({ node: host.ip, phase: "cluster-info", log: "kubectl cluster-info timed out" }))
    }),
    Effect.retry(Schedule.recurs(args.attempts - 1)),
    Effect.asVoid,
    Effect.mapError((error) =>
      error instanceof BootstrapFailed
        ? error
        : new BootstrapFailed({ node: host.ip, phase: "cluster-info", log: "kubectl cluster-info never succeeded" })
    )
  )

export const controlPlaneReady = (host: SshHost): Effect.Effect<void, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    yield* _clusterInfoReady(host, ssh, { attempts: CLUSTER_INFO_MAX_ATTEMPTS, attemptTimeout: CLUSTER_INFO_ATTEMPT_TIMEOUT })
  })

export const _testPollReady = _pollReady
export const _testClusterInfoReady = _clusterInfoReady
