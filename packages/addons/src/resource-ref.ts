import type { K8sManifest, ResourceRef } from "@kumulo/core"
import { Result, Schema } from "effect"

// kumulo: only the kinds our built-in addons actually emit — a full
// GVK->plural mapper is unneeded complexity (core's own K8sClient makes the
// same call, see packages/core/src/k8s/client.ts).
const PLURALS: Record<string, string> = {
  Namespace: "namespaces",
  ServiceAccount: "serviceaccounts",
  Secret: "secrets",
  ClusterRole: "clusterroles",
  ClusterRoleBinding: "clusterrolebindings",
  Deployment: "deployments",
  DaemonSet: "daemonsets",
  StorageClass: "storageclasses"
}

const _apiPrefix = (apiVersion: string): string => apiVersion === "v1" ? "/api/v1" : `/apis/${apiVersion}`

// kumulo: WHY lenient decode — manifests come from our own generators
// (manifests/*.ts) and may carry any other metadata fields (labels,
// annotations, ...) — only `name`/`namespace` are extracted, everything else
// passes through untouched.
const K8sObjectMeta = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String)
})

// kumulo: narrows without an `as` cast — manifests are ones we generated
// ourselves (see manifests/*.ts), all of which set metadata.name. A decode
// failure (missing/malformed metadata) falls back to the same defaults the
// old manual guard used, rather than throwing.
const _metadata = (manifest: K8sManifest): { name: string; namespace?: string } => {
  const decoded = Result.getOrElse(
    Schema.decodeUnknownResult(K8sObjectMeta)(manifest.metadata),
    () => ({ name: undefined, namespace: undefined })
  )
  return { name: decoded.name ?? "", namespace: decoded.namespace }
}

// Derives the REST path K8sClient.apply needs from a manifest we generated
// ourselves — safe because PLURALS only covers kinds we emit.
export const refFor = (manifest: K8sManifest): ResourceRef => {
  const plural = PLURALS[manifest.kind] ?? manifest.kind.toLowerCase()
  const { name, namespace } = _metadata(manifest)
  const path = namespace === undefined
    ? `${_apiPrefix(manifest.apiVersion)}/${plural}/${name}`
    : `${_apiPrefix(manifest.apiVersion)}/namespaces/${namespace}/${plural}/${name}`
  return { path, kind: manifest.kind }
}
