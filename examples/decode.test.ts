import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { parseConfigYaml } from "@kumulo/core"

// NFR-7/AC-1 — the example configs shipped in README/docs must actually
// decode against the real schema, not just look plausible.
const _load = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8")

describe("example configs", () => {
  it("k3s.yaml decodes to a valid ClusterConfig", () => {
    const config = Effect.runSync(parseConfigYaml(_load("k3s.yaml")))
    expect(config.distro).toBe("k3s")
    expect(config.name).toBe("prod-eu")
  })

  it("ovh-mks.yaml decodes to a valid ClusterConfig", () => {
    const config = Effect.runSync(parseConfigYaml(_load("ovh-mks.yaml")))
    expect(config.distro).toBe("ovh-mks")
    expect(config.name).toBe("staging-eu")
  })

  it("ovh-mks.json decodes to the same ClusterConfig as ovh-mks.yaml", () => {
    const fromJson = Effect.runSync(parseConfigYaml(_load("ovh-mks.json")))
    const fromYaml = Effect.runSync(parseConfigYaml(_load("ovh-mks.yaml")))
    expect(fromJson).toEqual(fromYaml)
  })

  it("k3s-hetzner.yaml decodes to a valid ClusterConfig", () => {
    const config = Effect.runSync(parseConfigYaml(_load("k3s-hetzner.yaml")))
    expect(config.distro).toBe("k3s")
    expect(config.provider).toBe("hetzner")
    expect(config.name).toBe("prod-fsn")
  })

  it("upcloud-uks.json decodes to a valid ClusterConfig", () => {
    const config = Effect.runSync(parseConfigYaml(_load("upcloud-uks.json")))
    expect(config.distro).toBe("upcloud-uks")
    expect(config.provider).toBe("upcloud")
    expect(config.name).toBe("staging-de")
  })
})
