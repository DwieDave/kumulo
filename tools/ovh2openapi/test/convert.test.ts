import { readFileSync } from "node:fs"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { convert, convertModels } from "../src/convert.ts"
import type { OvhSchema } from "../src/domain.ts"
import { ConversionUnsupported } from "../src/errors.ts"

function _loadFixture(name: string): OvhSchema {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", name), "utf8"))
  return raw
}

describe("convert", () => {
  it("converts the kube-route subset of cloud.json", () => {
    const doc = Effect.runSync(convert(_loadFixture("cloud-kube.json")))

    assert.strictEqual(doc.openapi, "3.1.0")
    const pathItem = doc.paths["/cloud/project/{serviceName}/kube"]
    assert.isDefined(pathItem)
    assert.strictEqual(pathItem?.get?.operationId, "get_cloud_project_serviceName_kube")
    assert.deepStrictEqual(pathItem?.post?.requestBody?.content["application/json"], {
      schema: { $ref: "#/components/schemas/cloud.ProjectKubeCreation" }
    })

    const creation = doc.components.schemas["cloud.ProjectKubeCreation"]
    assert.deepStrictEqual(creation, {
      type: "object",
      properties: {
        name: { type: "string" },
        region: { type: "string" },
        version: { $ref: "#/components/schemas/cloud.kube.VersionEnum" }
      },
      required: ["region"]
    })

    const versionEnum = doc.components.schemas["cloud.kube.VersionEnum"]
    assert.deepStrictEqual(versionEnum, { type: "string", enum: ["1.28", "1.29", "1.30"] })
  })

  it("converts the domain-zone record routes, preserving explicit operationIds", () => {
    const doc = Effect.runSync(convert(_loadFixture("domain-zone.json")))
    const pathItem = doc.paths["/domain/zone/{zoneName}/record"]
    assert.strictEqual(pathItem?.get?.operationId, "getRecords")
    assert.strictEqual(pathItem?.post?.operationId, "createRecord")

    const recordType = doc.components.schemas["domain.zone.RecordTypeEnum"]
    assert.deepStrictEqual(recordType, {
      type: "string",
      enum: [
        "A", "AAAA", "CAA", "CNAME", "DKIM", "DMARC", "DNAME", "HTTPS", "LOC",
        "MX", "NAPTR", "NS", "PTR", "RP", "SPF", "SRV", "SSHFP", "SVCB", "TLSA", "TXT"
      ]
    })
  })

  it("fails with ConversionUnsupported for a model property referencing an unknown type", () => {
    const schema: OvhSchema = {
      apis: [],
      models: {
        "x.Broken": {
          id: "Broken",
          namespace: "x",
          properties: { field: { fullType: "x.NotAModel", required: false } }
        }
      }
    }

    const error = Effect.runSync(Effect.flip(convert(schema)))
    assert.isTrue(error instanceof ConversionUnsupported)
    assert.strictEqual(error.detail, "x.NotAModel")
  })

  it("converts an OVH map[K]V type to an open object schema (OVH MKS labels/annotations)", () => {
    const schema = Effect.runSync(convertModels({
      "cloud.kube.NodePoolTemplateMetadata": {
        id: "NodePoolTemplateMetadata",
        namespace: "cloud.kube",
        properties: { labels: { fullType: "map[string]string", required: false } }
      }
    }))
    assert.deepStrictEqual(schema["cloud.kube.NodePoolTemplateMetadata"], {
      type: "object",
      properties: { labels: { type: "object", additionalProperties: { type: "string" } } },
      required: []
    })
  })

  it("converts uuid/duration-typed model properties to formatted string schemas (OVH MKS ids/timers)", () => {
    const doc = Effect.runSync(
      convert({
        apiVersion: "1.0",
        apis: [],
        models: {
          "cloud.kube.Cluster": {
            id: "Cluster",
            namespace: "cloud.kube",
            properties: {
              id: { fullType: "uuid", required: true },
              controlPlaneUpToDateGracePeriod: { fullType: "duration", required: false }
            }
          }
        }
      })
    )
    assert.deepStrictEqual(doc.components.schemas["cloud.kube.Cluster"], {
      type: "object",
      properties: {
        controlPlaneUpToDateGracePeriod: { type: "string", format: "duration" },
        id: { type: "string", format: "uuid" }
      },
      required: ["id"]
    })
  })

  it("converts a date-typed model property to a formatted string schema (OVH storage lifecycle rules)", () => {
    const schema = Effect.runSync(convertModels({
      "cloud.StorageLifecycleRuleExpiration": {
        id: "StorageLifecycleRuleExpiration",
        namespace: "cloud",
        properties: { date: { fullType: "date", required: false } }
      }
    }))
    assert.deepStrictEqual(schema["cloud.StorageLifecycleRuleExpiration"], {
      type: "object",
      properties: { date: { type: "string", format: "date" } },
      required: []
    })
  })

  it("fails with ConversionUnsupported for a non-string enum type", () => {
    const schema: OvhSchema = {
      apis: [],
      models: {
        "x.NumericEnum": { id: "NumericEnum", namespace: "x", enum: ["1", "2"], enumType: "long" }
      }
    }

    const error = Effect.runSync(Effect.flip(convert(schema)))
    assert.isTrue(error instanceof ConversionUnsupported)
  })
})
