import type { K8sManifest, ResourceRef } from "@kumulo/core"

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

const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

// kumulo: narrows without an `as` cast — manifests are ones we generated
// ourselves (see manifests/*.ts), all of which set metadata.name.
const _metadata = (manifest: K8sManifest): { name: string; namespace?: string } => {
  const metadata = manifest.metadata
  const name = _isRecord(metadata) && typeof metadata.name === "string" ? metadata.name : ""
  const namespace = _isRecord(metadata) && typeof metadata.namespace === "string" ? metadata.namespace : undefined
  return { name, namespace }
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
