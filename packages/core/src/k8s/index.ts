export { K8sClient, makeK8sClient } from "./client.ts"

export type { K8sClientOptions, ResourceRef } from "./client.ts"

export { parseKubeconfig } from "./kubeconfig.ts"

export type { ClientCertAuth, KubeconfigAuth, KubeconfigContext, TokenAuth } from "./kubeconfig.ts"

export { waitForDeploymentAvailable, waitForNodeReady } from "./readiness.ts"

export type { WaitOptions } from "./readiness.ts"

export { cordonNode, deleteNode, drainNode } from "./node-ops.ts"

export { installAddons } from "./addon.ts"

export type { Addon, AddonError } from "./addon.ts"

export { refFor } from "./resource-ref.ts"
