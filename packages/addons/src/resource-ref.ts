import type { K8sManifest, ResourceRef } from "@kumulo/core"
import { Result, Schema } from "effect"

// PLURALS only covers kinds we emit, not a full GVK->plural mapper
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

const K8sObjectMeta = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String)
})

const _metadata = (manifest: K8sManifest): { name: string; namespace?: string } => {
  const decoded = Result.getOrElse(
    Schema.decodeUnknownResult(K8sObjectMeta)(manifest.metadata),
    () => ({ name: undefined, namespace: undefined })
  )
  return { name: decoded.name ?? "", namespace: decoded.namespace }
}

export const refFor = (manifest: K8sManifest): ResourceRef => {
  const plural = PLURALS[manifest.kind] ?? manifest.kind.toLowerCase()
  const { name, namespace } = _metadata(manifest)
  const path = namespace === undefined
    ? `${_apiPrefix(manifest.apiVersion)}/${plural}/${name}`
    : `${_apiPrefix(manifest.apiVersion)}/namespaces/${namespace}/${plural}/${name}`
  return { path, kind: manifest.kind }
}
