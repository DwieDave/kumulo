import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeConfig } from "../../src/config/decode.ts"
import { validConfig } from "./fixtures.ts"

// kumulo: a config satisfying every hetzner cross-field rule at once —
// provider/auth/volumes/addons all consistently "hetzner"
const hetznerConfig = {
  ...validConfig,
  provider: "hetzner" as const,
  auth: { method: "api_token" as const, region: "fsn1" },
  volumes: { module: "hcloud" as const, managed: [] },
  addons: {
    ...validConfig.addons,
    cinder_csi: { enabled: false, default_volume_type: "high-speed" },
    hcloud_csi: { enabled: true }
  }
}

describe("ClusterConfig — hetzner fields", () => {
  it.effect("decodes provider: hetzner with a fully-consistent hetzner config", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeConfig(hetznerConfig)
      expect(decoded.provider).toBe("hetzner")
      expect(decoded.auth.method).toBe("api_token")
      expect(decoded.volumes.module).toBe("hcloud")
      expect(decoded.distro === "k3s" && decoded.addons.hcloud_csi.enabled).toBe(true)
    }))

  it.effect("decodes dns.module: hetzner", () =>
    Effect.gen(function* () {
      const candidate = { ...validConfig, dns: { ...validConfig.dns, module: "hetzner" as const } }
      const decoded = yield* decodeConfig(candidate)
      expect(decoded.dns.module).toBe("hetzner")
    }))

  it.effect("rejects provider: hetzner with a non-api_token auth.method", () =>
    Effect.gen(function* () {
      const candidate = { ...hetznerConfig, auth: { ...hetznerConfig.auth, method: "application_credential" as const } }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects auth.method: api_token on a non-hetzner provider", () =>
    Effect.gen(function* () {
      const candidate = { ...validConfig, auth: { ...validConfig.auth, method: "api_token" as const } }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  // The ovh-mks variant fixes provider to ovh but still spells auth.method from
  // the full enum, so the provider<->auth gate has to run there too.
  it.effect("rejects auth.method: api_token on the ovh-mks variant", () =>
    Effect.gen(function* () {
      const candidate = {
        ...validConfig,
        distro: "ovh-mks" as const,
        version: "v1.31.4",
        auth: { ...validConfig.auth, method: "api_token" as const }
      }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects volumes.module: hcloud on a non-hetzner provider", () =>
    Effect.gen(function* () {
      const candidate = { ...validConfig, volumes: { module: "hcloud" as const, managed: [] } }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects volumes.module: cinder on provider: hetzner", () =>
    Effect.gen(function* () {
      const candidate = {
        ...hetznerConfig,
        volumes: { module: "cinder" as const, managed: [] }
      }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects addons.hcloud_csi.enabled on a non-hetzner provider", () =>
    Effect.gen(function* () {
      const candidate = {
        ...validConfig,
        addons: { ...validConfig.addons, hcloud_csi: { enabled: true } }
      }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects addons.cinder_csi.enabled on provider: hetzner", () =>
    Effect.gen(function* () {
      const candidate = {
        ...hetznerConfig,
        addons: { ...hetznerConfig.addons, cinder_csi: { enabled: true, default_volume_type: "high-speed" } }
      }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))
})
