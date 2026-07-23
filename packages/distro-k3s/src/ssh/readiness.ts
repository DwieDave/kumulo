import { Effect, Schedule } from "effect"
import type { Context, Duration } from "effect"
import { BootstrapFailed, pollUntil } from "@kumulo/core"
import { Ssh } from "./port.ts"
import type { SshHost } from "./port.ts"

// kumulo: WHY 300s cap — hetzner-k3s's cloud_init_wait_script.sh polls
// /var/lib/cloud/instance/boot-finished for MAX_WAIT=300 (1s steps); we poll
// less often over SSH instead of embedding a wait loop in cloud-init itself.
const CLOUD_INIT_POLL_INTERVAL = "5 seconds"
const CLOUD_INIT_TIMEOUT = "300 seconds"
const CLOUD_INIT_MARKER = "/var/lib/cloud/instance/boot-finished"

// kumulo: WHY 100s cap — hetzner-k3s's Util::SSH::DEFAULT_MAX_ATTEMPTS (20)
// * DEFAULT_RETRY_DELAY (5s) = 100s of polling for a session to open.
const SSH_READY_POLL_INTERVAL = "5 seconds"
const SSH_READY_TIMEOUT = "100 seconds"

// kumulo: WHY retry x3 / 30s each — hetzner-k3s's control_plane/setup.cr
// wraps `kubectl cluster-info` in Retriable.retry(max_attempts: 3) with a
// per-attempt Tasker.timeout(30.seconds).
const CLUSTER_INFO_MAX_ATTEMPTS = 3
const CLUSTER_INFO_ATTEMPT_TIMEOUT = "30 seconds"

const _asReady = <E>(effect: Effect.Effect<unknown, E>): Effect.Effect<boolean> =>
  effect.pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))

// Generic poll-for-readiness shared by cloud-init/ssh-ready — durations
// parametrized so tests can drive it under a virtual `TestClock` without
// waiting out the real 300s/100s caps; the public gates below pin the real ones.
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

/** Poll until cloud-init reports boot-finished, capped at 300s (FR-5.4). */
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

/** Poll until an SSH session can be opened, capped at 100s (FR-5.4). */
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

// Durations parametrized for the same reason as `_pollReady` — tests drive
// this in milliseconds instead of the real 3x/30s caps.
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

/** Retry `kubectl cluster-info` on the control plane up to 3x, 30s each (FR-5.4). */
export const controlPlaneReady = (host: SshHost): Effect.Effect<void, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    yield* _clusterInfoReady(host, ssh, { attempts: CLUSTER_INFO_MAX_ATTEMPTS, attemptTimeout: CLUSTER_INFO_ATTEMPT_TIMEOUT })
  })

// Exposed for tests only — same generic gates, injectable durations/attempts
// so tests exercise real timeout/retry paths in milliseconds, not minutes.
export const _testPollReady = _pollReady
export const _testClusterInfoReady = _clusterInfoReady
