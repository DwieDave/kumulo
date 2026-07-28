import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type Cloud_OperationStatusEnum = "canceled" | "completed" | "created" | "in-error" | "in-progress" | "unknown"
export const Cloud_OperationStatusEnum = Schema.Literals(["canceled", "completed", "created", "in-error", "in-progress", "unknown"]).annotate({ "identifier": "cloud.OperationStatusEnum" })
export type Union_1 = ReadonlyArray<string> | null
export const Union_1 = Schema.Union([Schema.Array(Schema.String), Schema.Null])
export type Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum = "AlwaysPullImages" | "NodeRestriction"
export const Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum = Schema.Literals(["AlwaysPullImages", "NodeRestriction"]).annotate({ "identifier": "cloud.ProjectKubeCustomizationAPIServerAdmissionPluginsEnum" })
export type Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum = "LoadBalancer" | "NodePort"
export const Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum = Schema.Literals(["LoadBalancer", "NodePort"]).annotate({ "identifier": "cloud.ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum" })
export type Cloud_ProjectKubeCustomizationCiliumHubbleRelay = { readonly "enabled"?: boolean | null }
export const Cloud_ProjectKubeCustomizationCiliumHubbleRelay = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationCiliumHubbleRelay" })
export type Cloud_ProjectKubeCustomizationKubeProxyIptables = { readonly "minSyncPeriod"?: string | null, readonly "syncPeriod"?: string | null }
export const Cloud_ProjectKubeCustomizationKubeProxyIptables = Schema.Struct({ "minSyncPeriod": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "duration" }), Schema.Null])), "syncPeriod": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "duration" }), Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationKubeProxyIptables" })
export type Cloud_ProjectKubeIpAllocationPolicy = { readonly "podsIpv4Cidr"?: string | null, readonly "servicesIpv4Cidr"?: string | null }
export const Cloud_ProjectKubeIpAllocationPolicy = Schema.Struct({ "podsIpv4Cidr": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "ipv4Block" }), Schema.Null])), "servicesIpv4Cidr": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "ipv4Block" }), Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeIpAllocationPolicy" })
export type Cloud_ProjectKubeNodePoolAttachFloatingIpsParams = { readonly "enabled"?: boolean }
export const Cloud_ProjectKubeNodePoolAttachFloatingIpsParams = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Boolean) }).annotate({ "identifier": "cloud.ProjectKubeNodePoolAttachFloatingIpsParams" })
export type Cloud_ProjectKubeNodePoolAutoscalingParams = { readonly "scaleDownUnneededTimeSeconds"?: number, readonly "scaleDownUnreadyTimeSeconds"?: number, readonly "scaleDownUtilizationThreshold"?: number }
export const Cloud_ProjectKubeNodePoolAutoscalingParams = Schema.Struct({ "scaleDownUnneededTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "scaleDownUnreadyTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "scaleDownUtilizationThreshold": Schema.optionalKey(Schema.Number.annotate({ "format": "double" }).check(Schema.isFinite().annotate({ "expected": "a finite number" }))) }).annotate({ "identifier": "cloud.ProjectKubeNodePoolAutoscalingParams" })
export type Cloud_ProjectKubeResources = { readonly "cpu"?: string | null, readonly "memory"?: string | null }
export const Cloud_ProjectKubeResources = Schema.Struct({ "cpu": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "memory": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeResources" })
export type Cloud_Vrack = { readonly "description"?: string, readonly "id"?: string, readonly "name"?: string }
export const Cloud_Vrack = Schema.Struct({ "description": Schema.optionalKey(Schema.String), "id": Schema.optionalKey(Schema.String), "name": Schema.optionalKey(Schema.String) }).annotate({ "identifier": "cloud.Vrack" })
export type Cloud_kube_ClusterStatusEnum = "DELETED" | "DELETING" | "ERROR" | "INSTALLING" | "MAINTENANCE" | "READY" | "REDEPLOYING" | "REOPENING" | "RESETTING" | "SUSPENDED" | "SUSPENDING" | "UNKNOWN" | "UPDATING" | "USER_ERROR" | "USER_QUOTA_ERROR" | "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"
export const Cloud_kube_ClusterStatusEnum = Schema.Literals(["DELETED", "DELETING", "ERROR", "INSTALLING", "MAINTENANCE", "READY", "REDEPLOYING", "REOPENING", "RESETTING", "SUSPENDED", "SUSPENDING", "UNKNOWN", "UPDATING", "USER_ERROR", "USER_QUOTA_ERROR", "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"]).annotate({ "identifier": "cloud.kube.ClusterStatusEnum" })
export type Cloud_kube_KubeProxyIpvsSchedulerEnum = "dh" | "lc" | "nq" | "rr" | "sed" | "sh"
export const Cloud_kube_KubeProxyIpvsSchedulerEnum = Schema.Literals(["dh", "lc", "nq", "rr", "sed", "sh"]).annotate({ "identifier": "cloud.kube.KubeProxyIpvsSchedulerEnum" })
export type Cloud_kube_KubeProxyModeEnum = "iptables" | "ipvs"
export const Cloud_kube_KubeProxyModeEnum = Schema.Literals(["iptables", "ipvs"]).annotate({ "identifier": "cloud.kube.KubeProxyModeEnum" })
export type Cloud_kube_Kubeconfig = { readonly "content"?: string }
export const Cloud_kube_Kubeconfig = Schema.Struct({ "content": Schema.optionalKey(Schema.String.annotate({ "format": "password" })) }).annotate({ "identifier": "cloud.kube.Kubeconfig" })
export type Cloud_kube_NodePoolAttachFloatingIps = { readonly "enabled"?: boolean }
export const Cloud_kube_NodePoolAttachFloatingIps = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Boolean) }).annotate({ "identifier": "cloud.kube.NodePoolAttachFloatingIps" })
export type Cloud_kube_NodePoolAutoscaling = { readonly "scaleDownUnneededTimeSeconds"?: number, readonly "scaleDownUnreadyTimeSeconds"?: number, readonly "scaleDownUtilizationThreshold"?: number }
export const Cloud_kube_NodePoolAutoscaling = Schema.Struct({ "scaleDownUnneededTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "scaleDownUnreadyTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "scaleDownUtilizationThreshold": Schema.optionalKey(Schema.Number.annotate({ "format": "double" }).check(Schema.isFinite().annotate({ "expected": "a finite number" }))) }).annotate({ "identifier": "cloud.kube.NodePoolAutoscaling" })
export type Cloud_kube_NodePoolSizeStatusEnum = "CAPACITY_OK" | "OVER_CAPACITY" | "UNDER_CAPACITY"
export const Cloud_kube_NodePoolSizeStatusEnum = Schema.Literals(["CAPACITY_OK", "OVER_CAPACITY", "UNDER_CAPACITY"]).annotate({ "identifier": "cloud.kube.NodePoolSizeStatusEnum" })
export type Cloud_kube_NodePoolStatusEnum = "DELETED" | "DELETING" | "DOWNSCALING" | "ERROR" | "INSTALLING" | "MAINTENANCE" | "READY" | "REDEPLOYING" | "REOPENING" | "RESETTING" | "SUSPENDED" | "SUSPENDING" | "UNKNOWN" | "UPDATING" | "UPSCALING" | "USER_ERROR" | "USER_NODE_NOT_FOUND_ERROR" | "USER_NODE_SUSPENDED_SERVICE" | "USER_QUOTA_ERROR" | "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"
export const Cloud_kube_NodePoolStatusEnum = Schema.Literals(["DELETED", "DELETING", "DOWNSCALING", "ERROR", "INSTALLING", "MAINTENANCE", "READY", "REDEPLOYING", "REOPENING", "RESETTING", "SUSPENDED", "SUSPENDING", "UNKNOWN", "UPDATING", "UPSCALING", "USER_ERROR", "USER_NODE_NOT_FOUND_ERROR", "USER_NODE_SUSPENDED_SERVICE", "USER_QUOTA_ERROR", "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"]).annotate({ "identifier": "cloud.kube.NodePoolStatusEnum" })
export type Cloud_kube_NodePoolTemplateMetadata = { readonly "annotations": { readonly [x: string]: string }, readonly "finalizers": ReadonlyArray<string>, readonly "labels": { readonly [x: string]: string } }
export const Cloud_kube_NodePoolTemplateMetadata = Schema.Struct({ "annotations": Schema.Record(Schema.String, Schema.String), "finalizers": Schema.Array(Schema.String), "labels": Schema.Record(Schema.String, Schema.String) }).annotate({ "identifier": "cloud.kube.NodePoolTemplateMetadata" })
export type Cloud_kube_PrivateNetworkConfiguration = { readonly "defaultVrackGateway"?: string, readonly "privateNetworkRoutingAsDefault"?: boolean | null }
export const Cloud_kube_PrivateNetworkConfiguration = Schema.Struct({ "defaultVrackGateway": Schema.optionalKey(Schema.String), "privateNetworkRoutingAsDefault": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])) }).annotate({ "identifier": "cloud.kube.PrivateNetworkConfiguration" })
export type Cloud_kube_TaintEffectEnum = "NoExecute" | "NoSchedule" | "PreferNoSchedule"
export const Cloud_kube_TaintEffectEnum = Schema.Literals(["NoExecute", "NoSchedule", "PreferNoSchedule"]).annotate({ "identifier": "cloud.kube.TaintEffectEnum" })
export type Cloud_kube_UpdatePolicyEnum = "ALWAYS_UPDATE" | "MINIMAL_DOWNTIME" | "NEVER_UPDATE"
export const Cloud_kube_UpdatePolicyEnum = Schema.Literals(["ALWAYS_UPDATE", "MINIMAL_DOWNTIME", "NEVER_UPDATE"]).annotate({ "identifier": "cloud.kube.UpdatePolicyEnum" })
export type Cloud_kube_UpdateStrategyEnum = "LATEST_PATCH" | "NEXT_MINOR"
export const Cloud_kube_UpdateStrategyEnum = Schema.Literals(["LATEST_PATCH", "NEXT_MINOR"]).annotate({ "identifier": "cloud.kube.UpdateStrategyEnum" })
export type Cloud_kube_VersionEnum = "1.31" | "1.32" | "1.33" | "1.34" | "1.35"
export const Cloud_kube_VersionEnum = Schema.Literals(["1.31", "1.32", "1.33", "1.34", "1.35"]).annotate({ "identifier": "cloud.kube.VersionEnum" })
export type Cloud_network_GatewayModelEnum = "2xl" | "3xl" | "l" | "m" | "s" | "xl"
export const Cloud_network_GatewayModelEnum = Schema.Literals(["2xl", "3xl", "l", "m", "s", "xl"]).annotate({ "identifier": "cloud.network.GatewayModelEnum" })
export type Cloud_SubOperation = { readonly "action"?: string, readonly "completedAt"?: string | null, readonly "id"?: string, readonly "progress"?: number, readonly "regions"?: ReadonlyArray<string> | null, readonly "resourceId"?: string | null, readonly "startedAt"?: string | null, readonly "status"?: Cloud_OperationStatusEnum }
export const Cloud_SubOperation = Schema.Struct({ "action": Schema.optionalKey(Schema.String), "completedAt": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date-time" }), Schema.Null])), "id": Schema.optionalKey(Schema.String), "progress": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "regions": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null])), "resourceId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "startedAt": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date-time" }), Schema.Null])), "status": Schema.optionalKey(Cloud_OperationStatusEnum) }).annotate({ "identifier": "cloud.SubOperation" })
export type Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins = { readonly "disabled"?: ReadonlyArray<Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum> | null, readonly "enabled"?: ReadonlyArray<Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum> | null }
export const Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins = Schema.Struct({ "disabled": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum), Schema.Null])), "enabled": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum), Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationAPIServerAdmissionPlugins" })
export type Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer = { readonly "nodePort"?: number | null, readonly "serviceType"?: Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum | null }
export const Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer = Schema.Struct({ "nodePort": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" })), Schema.Null])), "serviceType": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationCiliumClusterMeshApiServer" })
export type Union_ = Cloud_ProjectKubeNodePoolAttachFloatingIpsParams | null
export const Union_ = Schema.Union([Cloud_ProjectKubeNodePoolAttachFloatingIpsParams, Schema.Null])
export type Cloud_ProjectKubeCustomizationCiliumHubbleUIResources = { readonly "limits"?: Cloud_ProjectKubeResources | null, readonly "requests"?: Cloud_ProjectKubeResources | null }
export const Cloud_ProjectKubeCustomizationCiliumHubbleUIResources = Schema.Struct({ "limits": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeResources, Schema.Null])), "requests": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeResources, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationCiliumHubbleUIResources" })
export type Cloud_ProjectKubeCustomizationKubeProxyIpvs = { readonly "minSyncPeriod"?: string | null, readonly "scheduler"?: Cloud_kube_KubeProxyIpvsSchedulerEnum | null, readonly "syncPeriod"?: string | null, readonly "tcpFinTimeout"?: string | null, readonly "tcpTimeout"?: string | null, readonly "udpTimeout"?: string | null }
export const Cloud_ProjectKubeCustomizationKubeProxyIpvs = Schema.Struct({ "minSyncPeriod": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "duration" }), Schema.Null])), "scheduler": Schema.optionalKey(Schema.Union([Cloud_kube_KubeProxyIpvsSchedulerEnum, Schema.Null])), "syncPeriod": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "duration" }), Schema.Null])), "tcpFinTimeout": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "duration" }), Schema.Null])), "tcpTimeout": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "duration" }), Schema.Null])), "udpTimeout": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "duration" }), Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationKubeProxyIpvs" })
export type Cloud_kube_Taint = { readonly "effect": Cloud_kube_TaintEffectEnum, readonly "key": string, readonly "value": string }
export const Cloud_kube_Taint = Schema.Struct({ "effect": Cloud_kube_TaintEffectEnum, "key": Schema.String, "value": Schema.String }).annotate({ "identifier": "cloud.kube.Taint" })
export type Cloud_ProjectKubeUpdate = { readonly "name"?: string, readonly "updatePolicy"?: Cloud_kube_UpdatePolicyEnum }
export const Cloud_ProjectKubeUpdate = Schema.Struct({ "name": Schema.optionalKey(Schema.String), "updatePolicy": Schema.optionalKey(Cloud_kube_UpdatePolicyEnum) }).annotate({ "identifier": "cloud.ProjectKubeUpdate" })
export type Cloud_ProjectKubeUpdateCreation = { readonly "force"?: boolean | null, readonly "strategy"?: Cloud_kube_UpdateStrategyEnum }
export const Cloud_ProjectKubeUpdateCreation = Schema.Struct({ "force": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "strategy": Schema.optionalKey(Cloud_kube_UpdateStrategyEnum) }).annotate({ "identifier": "cloud.ProjectKubeUpdateCreation" })
export type Cloud_network_CreateGatewaySummary = { readonly "model": Cloud_network_GatewayModelEnum, readonly "name": string }
export const Cloud_network_CreateGatewaySummary = Schema.Struct({ "model": Cloud_network_GatewayModelEnum, "name": Schema.String }).annotate({ "identifier": "cloud.network.CreateGatewaySummary" })
export type Cloud_Operation = { readonly "action"?: string, readonly "completedAt"?: string | null, readonly "createdAt"?: string, readonly "id"?: string, readonly "progress"?: number, readonly "regions"?: ReadonlyArray<string> | null, readonly "resourceId"?: string | null, readonly "startedAt"?: string | null, readonly "status"?: Cloud_OperationStatusEnum, readonly "subOperations"?: ReadonlyArray<Cloud_SubOperation> | null }
export const Cloud_Operation = Schema.Struct({ "action": Schema.optionalKey(Schema.String), "completedAt": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date-time" }), Schema.Null])), "createdAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "id": Schema.optionalKey(Schema.String), "progress": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "regions": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null])), "resourceId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "startedAt": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date-time" }), Schema.Null])), "status": Schema.optionalKey(Cloud_OperationStatusEnum), "subOperations": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_SubOperation), Schema.Null])) }).annotate({ "identifier": "cloud.Operation" })
export type Cloud_ProjectKubeCustomizationAPIServer = { readonly "admissionPlugins"?: Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins | null }
export const Cloud_ProjectKubeCustomizationAPIServer = Schema.Struct({ "admissionPlugins": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationAPIServer" })
export type Cloud_ProjectKubeCustomizationCiliumClusterMesh = { readonly "apiServer"?: Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer | null, readonly "enabled"?: boolean | null }
export const Cloud_ProjectKubeCustomizationCiliumClusterMesh = Schema.Struct({ "apiServer": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer, Schema.Null])), "enabled": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationCiliumClusterMesh" })
export type Cloud_ProjectKubeCustomizationCiliumHubbleUI = { readonly "backendResources"?: Cloud_ProjectKubeCustomizationCiliumHubbleUIResources | null, readonly "enabled"?: boolean | null, readonly "frontendResources"?: Cloud_ProjectKubeCustomizationCiliumHubbleUIResources | null }
export const Cloud_ProjectKubeCustomizationCiliumHubbleUI = Schema.Struct({ "backendResources": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumHubbleUIResources, Schema.Null])), "enabled": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "frontendResources": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumHubbleUIResources, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationCiliumHubbleUI" })
export type Cloud_ProjectKubeCustomizationKubeProxy = { readonly "iptables"?: Cloud_ProjectKubeCustomizationKubeProxyIptables | null, readonly "ipvs"?: Cloud_ProjectKubeCustomizationKubeProxyIpvs | null }
export const Cloud_ProjectKubeCustomizationKubeProxy = Schema.Struct({ "iptables": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationKubeProxyIptables, Schema.Null])), "ipvs": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationKubeProxyIpvs, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationKubeProxy" })
export type Cloud_kube_NodePoolTemplateSpec = { readonly "taints": ReadonlyArray<Cloud_kube_Taint>, readonly "unschedulable": boolean }
export const Cloud_kube_NodePoolTemplateSpec = Schema.Struct({ "taints": Schema.Array(Cloud_kube_Taint), "unschedulable": Schema.Boolean }).annotate({ "identifier": "cloud.kube.NodePoolTemplateSpec" })
export type Cloud_ProjectKubeCustomizationCiliumHubble = { readonly "enabled"?: boolean | null, readonly "relay"?: Cloud_ProjectKubeCustomizationCiliumHubbleRelay | null, readonly "ui"?: Cloud_ProjectKubeCustomizationCiliumHubbleUI | null }
export const Cloud_ProjectKubeCustomizationCiliumHubble = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "relay": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumHubbleRelay, Schema.Null])), "ui": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumHubbleUI, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationCiliumHubble" })
export type Cloud_kube_NodePoolTemplate = { readonly "metadata": Cloud_kube_NodePoolTemplateMetadata, readonly "spec": Cloud_kube_NodePoolTemplateSpec }
export const Cloud_kube_NodePoolTemplate = Schema.Struct({ "metadata": Cloud_kube_NodePoolTemplateMetadata, "spec": Cloud_kube_NodePoolTemplateSpec }).annotate({ "identifier": "cloud.kube.NodePoolTemplate" })
export type Cloud_ProjectKubeCustomizationCilium = { readonly "clusterId"?: number | null, readonly "clusterMesh"?: Cloud_ProjectKubeCustomizationCiliumClusterMesh | null, readonly "hubble"?: Cloud_ProjectKubeCustomizationCiliumHubble | null }
export const Cloud_ProjectKubeCustomizationCilium = Schema.Struct({ "clusterId": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" })), Schema.Null])), "clusterMesh": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumClusterMesh, Schema.Null])), "hubble": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCiliumHubble, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomizationCilium" })
export type Cloud_ProjectKubeCreationNodePool = { readonly "antiAffinity"?: boolean | null, readonly "attachFloatingIps"?: Union_, readonly "autoscale"?: boolean | null, readonly "autoscaling"?: Cloud_ProjectKubeNodePoolAutoscalingParams, readonly "availabilityZones"?: Union_1, readonly "desiredNodes"?: number, readonly "flavorName": string, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "monthlyBilled"?: boolean | null, readonly "name"?: string, readonly "template"?: Cloud_kube_NodePoolTemplate }
export const Cloud_ProjectKubeCreationNodePool = Schema.Struct({ "antiAffinity": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "attachFloatingIps": Schema.optionalKey(Union_), "autoscale": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "autoscaling": Schema.optionalKey(Cloud_ProjectKubeNodePoolAutoscalingParams), "availabilityZones": Schema.optionalKey(Union_1), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "flavorName": Schema.String, "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "monthlyBilled": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "name": Schema.optionalKey(Schema.String), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate) }).annotate({ "identifier": "cloud.ProjectKubeCreationNodePool" })
export type Cloud_ProjectKubeNodePoolCreation = { readonly "antiAffinity"?: boolean | null, readonly "attachFloatingIps"?: Cloud_ProjectKubeNodePoolAttachFloatingIpsParams | null, readonly "autoscale"?: boolean | null, readonly "autoscaling"?: Cloud_ProjectKubeNodePoolAutoscalingParams, readonly "availabilityZones"?: ReadonlyArray<string> | null, readonly "desiredNodes"?: number, readonly "flavorName": string, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "monthlyBilled"?: boolean | null, readonly "name"?: string, readonly "template"?: Cloud_kube_NodePoolTemplate }
export const Cloud_ProjectKubeNodePoolCreation = Schema.Struct({ "antiAffinity": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "attachFloatingIps": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeNodePoolAttachFloatingIpsParams, Schema.Null])), "autoscale": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "autoscaling": Schema.optionalKey(Cloud_ProjectKubeNodePoolAutoscalingParams), "availabilityZones": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null])), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "flavorName": Schema.String, "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "monthlyBilled": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "name": Schema.optionalKey(Schema.String), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate) }).annotate({ "identifier": "cloud.ProjectKubeNodePoolCreation" })
export type Cloud_ProjectKubeNodePoolUpdate = { readonly "attachFloatingIps"?: Cloud_ProjectKubeNodePoolAttachFloatingIpsParams | null, readonly "autoscale"?: boolean | null, readonly "autoscaling"?: Cloud_ProjectKubeNodePoolAutoscalingParams, readonly "desiredNodes"?: number, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "nodesToRemove"?: ReadonlyArray<string>, readonly "template"?: Cloud_kube_NodePoolTemplate }
export const Cloud_ProjectKubeNodePoolUpdate = Schema.Struct({ "attachFloatingIps": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeNodePoolAttachFloatingIpsParams, Schema.Null])), "autoscale": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "autoscaling": Schema.optionalKey(Cloud_ProjectKubeNodePoolAutoscalingParams), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "nodesToRemove": Schema.optionalKey(Schema.Array(Schema.String)), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate) }).annotate({ "identifier": "cloud.ProjectKubeNodePoolUpdate" })
export type Cloud_kube_NodePool = { readonly "antiAffinity"?: boolean, readonly "attachFloatingIps"?: Cloud_kube_NodePoolAttachFloatingIps | null, readonly "autoscale"?: boolean, readonly "autoscaling"?: Cloud_kube_NodePoolAutoscaling, readonly "availabilityZones"?: ReadonlyArray<string> | null, readonly "availableNodes"?: number, readonly "createdAt"?: string, readonly "currentNodes"?: number, readonly "desiredNodes"?: number, readonly "flavor"?: string, readonly "id"?: string, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "monthlyBilled"?: boolean, readonly "name"?: string, readonly "projectId"?: string, readonly "sizeStatus"?: Cloud_kube_NodePoolSizeStatusEnum, readonly "status"?: Cloud_kube_NodePoolStatusEnum, readonly "template"?: Cloud_kube_NodePoolTemplate, readonly "upToDateNodes"?: number, readonly "updatedAt"?: string }
export const Cloud_kube_NodePool = Schema.Struct({ "antiAffinity": Schema.optionalKey(Schema.Boolean), "attachFloatingIps": Schema.optionalKey(Schema.Union([Cloud_kube_NodePoolAttachFloatingIps, Schema.Null])), "autoscale": Schema.optionalKey(Schema.Boolean), "autoscaling": Schema.optionalKey(Cloud_kube_NodePoolAutoscaling), "availabilityZones": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null])), "availableNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "createdAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "currentNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "flavor": Schema.optionalKey(Schema.String), "id": Schema.optionalKey(Schema.String), "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "monthlyBilled": Schema.optionalKey(Schema.Boolean), "name": Schema.optionalKey(Schema.String), "projectId": Schema.optionalKey(Schema.String), "sizeStatus": Schema.optionalKey(Cloud_kube_NodePoolSizeStatusEnum), "status": Schema.optionalKey(Cloud_kube_NodePoolStatusEnum), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate), "upToDateNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "updatedAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })) }).annotate({ "identifier": "cloud.kube.NodePool" })
export type Cloud_ProjectKubeCustomization = { readonly "apiServer"?: Cloud_ProjectKubeCustomizationAPIServer | null, readonly "cilium"?: Cloud_ProjectKubeCustomizationCilium | null, readonly "kubeProxy"?: Cloud_ProjectKubeCustomizationKubeProxy | null }
export const Cloud_ProjectKubeCustomization = Schema.Struct({ "apiServer": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationAPIServer, Schema.Null])), "cilium": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationCilium, Schema.Null])), "kubeProxy": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomizationKubeProxy, Schema.Null])) }).annotate({ "identifier": "cloud.ProjectKubeCustomization" })
export type Cloud_ProjectKubeCreation = { readonly "customization"?: Cloud_ProjectKubeCustomization | null, readonly "ipAllocationPolicy"?: Cloud_ProjectKubeIpAllocationPolicy | null, readonly "kubeProxyMode"?: Cloud_kube_KubeProxyModeEnum | null, readonly "loadBalancersSubnetId"?: string, readonly "name"?: string, readonly "nodepool"?: Cloud_ProjectKubeCreationNodePool, readonly "nodepools"?: ReadonlyArray<Cloud_ProjectKubeCreationNodePool>, readonly "nodesSubnetId"?: string, readonly "plan"?: string | null, readonly "privateNetworkConfiguration"?: Cloud_kube_PrivateNetworkConfiguration, readonly "privateNetworkId"?: string, readonly "region": string, readonly "updatePolicy"?: Cloud_kube_UpdatePolicyEnum | null, readonly "version"?: Cloud_kube_VersionEnum }
export const Cloud_ProjectKubeCreation = Schema.Struct({ "customization": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomization, Schema.Null])), "ipAllocationPolicy": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeIpAllocationPolicy, Schema.Null])), "kubeProxyMode": Schema.optionalKey(Schema.Union([Cloud_kube_KubeProxyModeEnum, Schema.Null])), "loadBalancersSubnetId": Schema.optionalKey(Schema.String.annotate({ "format": "uuid" })), "name": Schema.optionalKey(Schema.String), "nodepool": Schema.optionalKey(Cloud_ProjectKubeCreationNodePool), "nodepools": Schema.optionalKey(Schema.Array(Cloud_ProjectKubeCreationNodePool)), "nodesSubnetId": Schema.optionalKey(Schema.String), "plan": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "privateNetworkConfiguration": Schema.optionalKey(Cloud_kube_PrivateNetworkConfiguration), "privateNetworkId": Schema.optionalKey(Schema.String), "region": Schema.String, "updatePolicy": Schema.optionalKey(Schema.Union([Cloud_kube_UpdatePolicyEnum, Schema.Null])), "version": Schema.optionalKey(Cloud_kube_VersionEnum) }).annotate({ "identifier": "cloud.ProjectKubeCreation" })
export type Cloud_kube_Cluster = { readonly "auditLogsSubscribed"?: boolean, readonly "controlPlaneIsUpToDate"?: boolean, readonly "createdAt"?: string, readonly "customization"?: Cloud_ProjectKubeCustomization | null, readonly "id"?: string, readonly "ipAllocationPolicy"?: Cloud_ProjectKubeIpAllocationPolicy | null, readonly "isUpToDate"?: boolean, readonly "kubeProxyMode"?: Cloud_kube_KubeProxyModeEnum | null, readonly "loadBalancersSubnetId"?: string | null, readonly "name"?: string, readonly "nextUpgradeVersions"?: ReadonlyArray<string> | null, readonly "nodesSubnetId"?: string | null, readonly "nodesUrl"?: string, readonly "plan"?: string, readonly "privateNetworkConfiguration"?: Cloud_kube_PrivateNetworkConfiguration | null, readonly "privateNetworkId"?: string | null, readonly "region"?: string, readonly "status"?: Cloud_kube_ClusterStatusEnum, readonly "updatePolicy"?: string, readonly "updatedAt"?: string, readonly "url"?: string, readonly "version"?: string }
export const Cloud_kube_Cluster = Schema.Struct({ "auditLogsSubscribed": Schema.optionalKey(Schema.Boolean), "controlPlaneIsUpToDate": Schema.optionalKey(Schema.Boolean), "createdAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "customization": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeCustomization, Schema.Null])), "id": Schema.optionalKey(Schema.String), "ipAllocationPolicy": Schema.optionalKey(Schema.Union([Cloud_ProjectKubeIpAllocationPolicy, Schema.Null])), "isUpToDate": Schema.optionalKey(Schema.Boolean), "kubeProxyMode": Schema.optionalKey(Schema.Union([Cloud_kube_KubeProxyModeEnum, Schema.Null])), "loadBalancersSubnetId": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "uuid" }), Schema.Null])), "name": Schema.optionalKey(Schema.String), "nextUpgradeVersions": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null])), "nodesSubnetId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "nodesUrl": Schema.optionalKey(Schema.String), "plan": Schema.optionalKey(Schema.String), "privateNetworkConfiguration": Schema.optionalKey(Schema.Union([Cloud_kube_PrivateNetworkConfiguration, Schema.Null])), "privateNetworkId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "region": Schema.optionalKey(Schema.String), "status": Schema.optionalKey(Cloud_kube_ClusterStatusEnum), "updatePolicy": Schema.optionalKey(Schema.String), "updatedAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "url": Schema.optionalKey(Schema.String), "version": Schema.optionalKey(Schema.String) }).annotate({ "identifier": "cloud.kube.Cluster" })
// schemas
export type GetCloudProjectServiceNameKube200 = ReadonlyArray<string>
export const GetCloudProjectServiceNameKube200 = Schema.Array(Schema.String)
export type PostCloudProjectServiceNameKubeRequestJson = Cloud_ProjectKubeCreation
export const PostCloudProjectServiceNameKubeRequestJson = Cloud_ProjectKubeCreation
export type PostCloudProjectServiceNameKube200 = Cloud_kube_Cluster
export const PostCloudProjectServiceNameKube200 = Cloud_kube_Cluster
export type GetCloudProjectServiceNameKubeKubeId200 = Cloud_kube_Cluster
export const GetCloudProjectServiceNameKubeKubeId200 = Cloud_kube_Cluster
export type PutCloudProjectServiceNameKubeKubeIdRequestJson = Cloud_ProjectKubeUpdate
export const PutCloudProjectServiceNameKubeKubeIdRequestJson = Cloud_ProjectKubeUpdate
export type PostCloudProjectServiceNameKubeKubeIdKubeconfig200 = Cloud_kube_Kubeconfig
export const PostCloudProjectServiceNameKubeKubeIdKubeconfig200 = Cloud_kube_Kubeconfig
export type GetCloudProjectServiceNameKubeKubeIdNodepool200 = ReadonlyArray<Cloud_kube_NodePool>
export const GetCloudProjectServiceNameKubeKubeIdNodepool200 = Schema.Array(Cloud_kube_NodePool)
export type PostCloudProjectServiceNameKubeKubeIdNodepoolRequestJson = Cloud_ProjectKubeNodePoolCreation
export const PostCloudProjectServiceNameKubeKubeIdNodepoolRequestJson = Cloud_ProjectKubeNodePoolCreation
export type PostCloudProjectServiceNameKubeKubeIdNodepool200 = Cloud_kube_NodePool
export const PostCloudProjectServiceNameKubeKubeIdNodepool200 = Cloud_kube_NodePool
export type GetCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId200 = Cloud_kube_NodePool
export const GetCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId200 = Cloud_kube_NodePool
export type PutCloudProjectServiceNameKubeKubeIdNodepoolNodePoolIdRequestJson = Cloud_ProjectKubeNodePoolUpdate
export const PutCloudProjectServiceNameKubeKubeIdNodepoolNodePoolIdRequestJson = Cloud_ProjectKubeNodePoolUpdate
export type PostCloudProjectServiceNameKubeKubeIdUpdateRequestJson = Cloud_ProjectKubeUpdateCreation
export const PostCloudProjectServiceNameKubeKubeIdUpdateRequestJson = Cloud_ProjectKubeUpdateCreation
export type PostCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGatewayRequestJson = Cloud_network_CreateGatewaySummary
export const PostCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGatewayRequestJson = Cloud_network_CreateGatewaySummary
export type PostCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGateway200 = Cloud_Operation
export const PostCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGateway200 = Cloud_Operation
export type GetCloudProjectServiceNameVrack200 = Cloud_Vrack
export const GetCloudProjectServiceNameVrack200 = Cloud_Vrack

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse] : A

export const make = (
  httpClient: HttpClient.HttpClient,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => Effect.Effect<HttpClient.HttpClient>) | undefined
  } = {}
): Mks => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const decodeSuccess =
    <Schema extends Schema.Constraint>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Constraint>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response),
        (cause) => Effect.fail(MksError(tag, cause, response)),
      )
  return {
    httpClient,
    "getCloudProjectServiceNameKube": (serviceName, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/kube`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameKube200),
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameKube": (serviceName, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/kube`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PostCloudProjectServiceNameKube200),
      orElse: unexpectedStatus
    }))
  ),
    "getCloudProjectServiceNameKubeKubeId": (serviceName, kubeId, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/kube/${kubeId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameKubeKubeId200),
      orElse: unexpectedStatus
    }))
  ),
    "putCloudProjectServiceNameKubeKubeId": (serviceName, kubeId, options) => HttpClientRequest.put(`/cloud/project/${serviceName}/kube/${kubeId}`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "deleteCloudProjectServiceNameKubeKubeId": (serviceName, kubeId, options) => HttpClientRequest.delete(`/cloud/project/${serviceName}/kube/${kubeId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameKubeKubeIdKubeconfig": (serviceName, kubeId, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/kube/${kubeId}/kubeconfig`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PostCloudProjectServiceNameKubeKubeIdKubeconfig200),
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameKubeKubeIdKubeconfigReset": (serviceName, kubeId, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/kube/${kubeId}/kubeconfig/reset`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "getCloudProjectServiceNameKubeKubeIdNodepool": (serviceName, kubeId, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/kube/${kubeId}/nodepool`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameKubeKubeIdNodepool200),
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameKubeKubeIdNodepool": (serviceName, kubeId, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/kube/${kubeId}/nodepool`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PostCloudProjectServiceNameKubeKubeIdNodepool200),
      orElse: unexpectedStatus
    }))
  ),
    "getCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": (serviceName, kubeId, nodePoolId, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/kube/${kubeId}/nodepool/${nodePoolId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId200),
      orElse: unexpectedStatus
    }))
  ),
    "putCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": (serviceName, kubeId, nodePoolId, options) => HttpClientRequest.put(`/cloud/project/${serviceName}/kube/${kubeId}/nodepool/${nodePoolId}`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "deleteCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": (serviceName, kubeId, nodePoolId, options) => HttpClientRequest.delete(`/cloud/project/${serviceName}/kube/${kubeId}/nodepool/${nodePoolId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameKubeKubeIdUpdate": (serviceName, kubeId, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/kube/${kubeId}/update`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGateway": (serviceName, regionName, networkId, subnetId, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/region/${regionName}/network/${networkId}/subnet/${subnetId}/gateway`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PostCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGateway200),
      orElse: unexpectedStatus
    }))
  ),
    "getCloudProjectServiceNameVrack": (serviceName, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/vrack`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameVrack200),
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface Mks {
  readonly httpClient: HttpClient.HttpClient
  readonly "getCloudProjectServiceNameKube": <Config extends OperationConfig>(serviceName: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKube200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "postCloudProjectServiceNameKube": <Config extends OperationConfig>(serviceName: string, options: { readonly payload: typeof PostCloudProjectServiceNameKubeRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameKube200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "getCloudProjectServiceNameKubeKubeId": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKubeKubeId200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "putCloudProjectServiceNameKubeKubeId": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly payload: typeof PutCloudProjectServiceNameKubeKubeIdRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "deleteCloudProjectServiceNameKubeKubeId": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "postCloudProjectServiceNameKubeKubeIdKubeconfig": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameKubeKubeIdKubeconfig200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "postCloudProjectServiceNameKubeKubeIdKubeconfigReset": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "getCloudProjectServiceNameKubeKubeIdNodepool": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKubeKubeIdNodepool200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "postCloudProjectServiceNameKubeKubeIdNodepool": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly payload: typeof PostCloudProjectServiceNameKubeKubeIdNodepoolRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameKubeKubeIdNodepool200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "getCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": <Config extends OperationConfig>(serviceName: string, kubeId: string, nodePoolId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "putCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": <Config extends OperationConfig>(serviceName: string, kubeId: string, nodePoolId: string, options: { readonly payload: typeof PutCloudProjectServiceNameKubeKubeIdNodepoolNodePoolIdRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "deleteCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": <Config extends OperationConfig>(serviceName: string, kubeId: string, nodePoolId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "postCloudProjectServiceNameKubeKubeIdUpdate": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly payload: typeof PostCloudProjectServiceNameKubeKubeIdUpdateRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "postCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGateway": <Config extends OperationConfig>(serviceName: string, regionName: string, networkId: string, subnetId: string, options: { readonly payload: typeof PostCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGatewayRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGateway200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  readonly "getCloudProjectServiceNameVrack": <Config extends OperationConfig>(serviceName: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameVrack200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
}

export interface MksError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class MksErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const MksError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): MksError<Tag, E> =>
  new MksErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any