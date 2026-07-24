import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, UrlParams } from "effect/unstable/http"
import { decodeConfig, makeK8sClient } from "@kumulo/core"
import type { ClusterConfigEncoded } from "@kumulo/core"
import { applyK3sUpgradeWith } from "../../src/commands/upgrade.ts"

const _encoded: ClusterConfigEncoded = {
  name: "test-k3s",
  provider: "generic",
  distro: "k3s",
  version: "v1.31.4+k3s1",
  auth: { method: "application_credential", region: "GRA11" },
  network: { cidr: "10.0.0.0/16", public_access: "bastionless" },
  api_server: { high_availability: true, allowed_cidrs: ["203.0.113.0/24"] },
  ssh: { public_key_path: "~/.ssh/id_ed25519.pub", allowed_cidrs: ["203.0.113.0/24"] },
  masters: { flavor: "b3-8", count: 3, image: "ubuntu-24.04" },
  worker_pools: [{ name: "general", flavor: "b3-16", count: 2 }],
  dns: { module: "none", zone: "example.com", ttl: 300, records: [] },
  volumes: { module: "none", retained: [] },
  addons: {
    cloud_controller_manager: false,
    cinder_csi: { enabled: false, default_volume_type: "high-speed" },
    system_upgrade_controller: true,
    cni: "flannel"
  },
  k3s: { extra_server_args: [], extra_agent_args: [] }
}
const _config = Effect.runSync(decodeConfig(_encoded))

// kumulo: local fixture-replay fake, same precedent as
// `core/test/k8s/fake-http-client.ts` (dep-lint scopes `test/` per-package).
// `sucDeploymentExists` gates the *first* GET only (the pre-apply existence
// check) — every GET after that reports Available so a "just installed"
// test doesn't need to sleep through the readiness poll's interval.
const _fakeHttpClient = (sucDeploymentExists: boolean) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = []
  let gets = 0
  const client = HttpClient.make((request) => {
    requests.push(request)
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname.endsWith("/system-upgrade-controller")) {
      gets++
      const notFound = gets === 1 && !sucDeploymentExists
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          notFound
            ? new Response("not found", { status: 404 })
            : new Response(
              JSON.stringify({
                apiVersion: "apps/v1",
                kind: "Deployment",
                status: { conditions: [{ type: "Available", status: "True" }] }
              }),
              { status: 200 }
            )
        )
      )
    }
    if (request.method === "PATCH") {
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ apiVersion: "v1", kind: "Ok" }), { status: 200 })))
    }
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 })))
  })
  return { client, requests: () => requests, gets: () => gets }
}

describe("upgrade command — SUC Plan apply", () => {
  it.effect("applies masters then workers Plans via SSA, skipping the SUC readiness wait when already installed", () =>
    Effect.gen(function*() {
      const { client, requests } = _fakeHttpClient(true)
      const k8sClient = makeK8sClient({ client, server: "https://127.0.0.1:6443" })

      yield* applyK3sUpgradeWith({ config: _config, workerConcurrency: 2, k8sClient })

      const patches = requests().filter((r) => r.method === "PATCH")
      expect(patches.length).toBeGreaterThan(0)
      for (const request of patches) {
        expect(request.headers["content-type"]).toBe("application/apply-patch+yaml")
        expect(UrlParams.toString(request.urlParams)).toContain("fieldManager=kumulo")
      }

      const planPatches = patches.filter((r) => new URL(r.url).pathname.includes("/plans/"))
      expect(planPatches).toHaveLength(2)
      expect(planPatches[0]?.url).toContain("/plans/k3s-server")
      expect(planPatches[1]?.url).toContain("/plans/k3s-agent")
    }))

  it.effect("waits for the SUC controller Deployment to become Available when it was just installed", () =>
    Effect.gen(function*() {
      const { client, gets } = _fakeHttpClient(false)
      const k8sClient = makeK8sClient({ client, server: "https://127.0.0.1:6443" })

      yield* applyK3sUpgradeWith({ config: _config, workerConcurrency: 1, k8sClient })

      // 1 pre-apply existence check (404) + at least 1 readiness poll (200/Available).
      expect(gets()).toBeGreaterThanOrEqual(2)
    }))
})
