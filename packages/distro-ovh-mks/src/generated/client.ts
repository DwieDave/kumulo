import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum = "AlwaysPullImages" | "NodeRestriction"
export const Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum = Schema.Literals(["AlwaysPullImages", "NodeRestriction"])
export type Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum = "LoadBalancer" | "NodePort"
export const Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum = Schema.Literals(["LoadBalancer", "NodePort"])
export type Cloud_ProjectKubeCustomizationCiliumHubbleRelay = { readonly "enabled"?: boolean }
export const Cloud_ProjectKubeCustomizationCiliumHubbleRelay = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Boolean) })
export type Cloud_ProjectKubeCustomizationKubeProxyIptables = { readonly "minSyncPeriod"?: string, readonly "syncPeriod"?: string }
export const Cloud_ProjectKubeCustomizationKubeProxyIptables = Schema.Struct({ "minSyncPeriod": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })), "syncPeriod": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })) })
export type Cloud_ProjectKubeIpAllocationPolicy = { readonly "podsIpv4Cidr"?: string, readonly "servicesIpv4Cidr"?: string }
export const Cloud_ProjectKubeIpAllocationPolicy = Schema.Struct({ "podsIpv4Cidr": Schema.optionalKey(Schema.String.annotate({ "format": "ipv4Block" })), "servicesIpv4Cidr": Schema.optionalKey(Schema.String.annotate({ "format": "ipv4Block" })) })
export type Cloud_ProjectKubeNodePoolAttachFloatingIpsParams = { readonly "enabled"?: boolean }
export const Cloud_ProjectKubeNodePoolAttachFloatingIpsParams = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Boolean) })
export type Cloud_ProjectKubeNodePoolAutoscalingParams = { readonly "scaleDownUnneededTimeSeconds"?: number, readonly "scaleDownUnreadyTimeSeconds"?: number, readonly "scaleDownUtilizationThreshold"?: number }
export const Cloud_ProjectKubeNodePoolAutoscalingParams = Schema.Struct({ "scaleDownUnneededTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "scaleDownUnreadyTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "scaleDownUtilizationThreshold": Schema.optionalKey(Schema.Number.annotate({ "format": "double" }).check(Schema.isFinite())) })
export type Cloud_ProjectKubeResources = { readonly "cpu"?: string, readonly "memory"?: string }
export const Cloud_ProjectKubeResources = Schema.Struct({ "cpu": Schema.optionalKey(Schema.String), "memory": Schema.optionalKey(Schema.String) })
export type Cloud_kube_ClusterStatusEnum = "DELETED" | "DELETING" | "ERROR" | "INSTALLING" | "MAINTENANCE" | "READY" | "REDEPLOYING" | "REOPENING" | "RESETTING" | "SUSPENDED" | "SUSPENDING" | "UNKNOWN" | "UPDATING" | "USER_ERROR" | "USER_QUOTA_ERROR" | "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"
export const Cloud_kube_ClusterStatusEnum = Schema.Literals(["DELETED", "DELETING", "ERROR", "INSTALLING", "MAINTENANCE", "READY", "REDEPLOYING", "REOPENING", "RESETTING", "SUSPENDED", "SUSPENDING", "UNKNOWN", "UPDATING", "USER_ERROR", "USER_QUOTA_ERROR", "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"])
export type Cloud_kube_KubeProxyIpvsSchedulerEnum = "dh" | "lc" | "nq" | "rr" | "sed" | "sh"
export const Cloud_kube_KubeProxyIpvsSchedulerEnum = Schema.Literals(["dh", "lc", "nq", "rr", "sed", "sh"])
export type Cloud_kube_KubeProxyModeEnum = "iptables" | "ipvs"
export const Cloud_kube_KubeProxyModeEnum = Schema.Literals(["iptables", "ipvs"])
export type Cloud_kube_Kubeconfig = { readonly "content"?: string }
export const Cloud_kube_Kubeconfig = Schema.Struct({ "content": Schema.optionalKey(Schema.String.annotate({ "format": "password" })) })
export type Cloud_kube_NodePoolAttachFloatingIps = { readonly "enabled"?: boolean }
export const Cloud_kube_NodePoolAttachFloatingIps = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Boolean) })
export type Cloud_kube_NodePoolAutoscaling = { readonly "scaleDownUnneededTimeSeconds"?: number, readonly "scaleDownUnreadyTimeSeconds"?: number, readonly "scaleDownUtilizationThreshold"?: number }
export const Cloud_kube_NodePoolAutoscaling = Schema.Struct({ "scaleDownUnneededTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "scaleDownUnreadyTimeSeconds": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "scaleDownUtilizationThreshold": Schema.optionalKey(Schema.Number.annotate({ "format": "double" }).check(Schema.isFinite())) })
export type Cloud_kube_NodePoolSizeStatusEnum = "CAPACITY_OK" | "OVER_CAPACITY" | "UNDER_CAPACITY"
export const Cloud_kube_NodePoolSizeStatusEnum = Schema.Literals(["CAPACITY_OK", "OVER_CAPACITY", "UNDER_CAPACITY"])
export type Cloud_kube_NodePoolStatusEnum = "DELETED" | "DELETING" | "DOWNSCALING" | "ERROR" | "INSTALLING" | "MAINTENANCE" | "READY" | "REDEPLOYING" | "REOPENING" | "RESETTING" | "SUSPENDED" | "SUSPENDING" | "UNKNOWN" | "UPDATING" | "UPSCALING" | "USER_ERROR" | "USER_NODE_NOT_FOUND_ERROR" | "USER_NODE_SUSPENDED_SERVICE" | "USER_QUOTA_ERROR" | "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"
export const Cloud_kube_NodePoolStatusEnum = Schema.Literals(["DELETED", "DELETING", "DOWNSCALING", "ERROR", "INSTALLING", "MAINTENANCE", "READY", "REDEPLOYING", "REOPENING", "RESETTING", "SUSPENDED", "SUSPENDING", "UNKNOWN", "UPDATING", "UPSCALING", "USER_ERROR", "USER_NODE_NOT_FOUND_ERROR", "USER_NODE_SUSPENDED_SERVICE", "USER_QUOTA_ERROR", "USER_WEBHOOK_PREVENTING_OPERATIONS_ERROR"])
export type Cloud_kube_NodePoolTemplateMetadata = { readonly "annotations": {  }, readonly "finalizers": ReadonlyArray<string>, readonly "labels": {  } }
export const Cloud_kube_NodePoolTemplateMetadata = Schema.Struct({ "annotations": Schema.Struct({  }), "finalizers": Schema.Array(Schema.String), "labels": Schema.Struct({  }) })
export type Cloud_kube_PrivateNetworkConfiguration = { readonly "defaultVrackGateway"?: string, readonly "privateNetworkRoutingAsDefault"?: boolean }
export const Cloud_kube_PrivateNetworkConfiguration = Schema.Struct({ "defaultVrackGateway": Schema.optionalKey(Schema.String), "privateNetworkRoutingAsDefault": Schema.optionalKey(Schema.Boolean) })
export type Cloud_kube_TaintEffectEnum = "NoExecute" | "NoSchedule" | "PreferNoSchedule"
export const Cloud_kube_TaintEffectEnum = Schema.Literals(["NoExecute", "NoSchedule", "PreferNoSchedule"])
export type Cloud_kube_UpdatePolicyEnum = "ALWAYS_UPDATE" | "MINIMAL_DOWNTIME" | "NEVER_UPDATE"
export const Cloud_kube_UpdatePolicyEnum = Schema.Literals(["ALWAYS_UPDATE", "MINIMAL_DOWNTIME", "NEVER_UPDATE"])
export type Cloud_kube_UpdateStrategyEnum = "LATEST_PATCH" | "NEXT_MINOR"
export const Cloud_kube_UpdateStrategyEnum = Schema.Literals(["LATEST_PATCH", "NEXT_MINOR"])
export type Cloud_kube_VersionEnum = "1.31" | "1.32" | "1.33" | "1.34" | "1.35"
export const Cloud_kube_VersionEnum = Schema.Literals(["1.31", "1.32", "1.33", "1.34", "1.35"])
export type Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins = { readonly "disabled"?: ReadonlyArray<Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum>, readonly "enabled"?: ReadonlyArray<Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum> }
export const Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins = Schema.Struct({ "disabled": Schema.optionalKey(Schema.Array(Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum)), "enabled": Schema.optionalKey(Schema.Array(Cloud_ProjectKubeCustomizationAPIServerAdmissionPluginsEnum)) })
export type Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer = { readonly "nodePort"?: number, readonly "serviceType"?: Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum }
export const Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer = Schema.Struct({ "nodePort": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "serviceType": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServerServiceTypeEnum) })
export type Cloud_ProjectKubeCustomizationCiliumHubbleUIResources = { readonly "limits"?: Cloud_ProjectKubeResources, readonly "requests"?: Cloud_ProjectKubeResources }
export const Cloud_ProjectKubeCustomizationCiliumHubbleUIResources = Schema.Struct({ "limits": Schema.optionalKey(Cloud_ProjectKubeResources), "requests": Schema.optionalKey(Cloud_ProjectKubeResources) })
export type Cloud_ProjectKubeCustomizationKubeProxyIpvs = { readonly "minSyncPeriod"?: string, readonly "scheduler"?: Cloud_kube_KubeProxyIpvsSchedulerEnum, readonly "syncPeriod"?: string, readonly "tcpFinTimeout"?: string, readonly "tcpTimeout"?: string, readonly "udpTimeout"?: string }
export const Cloud_ProjectKubeCustomizationKubeProxyIpvs = Schema.Struct({ "minSyncPeriod": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })), "scheduler": Schema.optionalKey(Cloud_kube_KubeProxyIpvsSchedulerEnum), "syncPeriod": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })), "tcpFinTimeout": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })), "tcpTimeout": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })), "udpTimeout": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })) })
export type Cloud_kube_Taint = { readonly "effect": Cloud_kube_TaintEffectEnum, readonly "key": string, readonly "value": string }
export const Cloud_kube_Taint = Schema.Struct({ "effect": Cloud_kube_TaintEffectEnum, "key": Schema.String, "value": Schema.String })
export type Cloud_ProjectKubeUpdate = { readonly "name"?: string, readonly "updatePolicy"?: Cloud_kube_UpdatePolicyEnum }
export const Cloud_ProjectKubeUpdate = Schema.Struct({ "name": Schema.optionalKey(Schema.String), "updatePolicy": Schema.optionalKey(Cloud_kube_UpdatePolicyEnum) })
export type Cloud_ProjectKubeUpdateCreation = { readonly "force"?: boolean, readonly "strategy"?: Cloud_kube_UpdateStrategyEnum }
export const Cloud_ProjectKubeUpdateCreation = Schema.Struct({ "force": Schema.optionalKey(Schema.Boolean), "strategy": Schema.optionalKey(Cloud_kube_UpdateStrategyEnum) })
export type Cloud_ProjectKubeCustomizationAPIServer = { readonly "admissionPlugins"?: Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins }
export const Cloud_ProjectKubeCustomizationAPIServer = Schema.Struct({ "admissionPlugins": Schema.optionalKey(Cloud_ProjectKubeCustomizationAPIServerAdmissionPlugins) })
export type Cloud_ProjectKubeCustomizationCiliumClusterMesh = { readonly "apiServer"?: Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer, readonly "enabled"?: boolean }
export const Cloud_ProjectKubeCustomizationCiliumClusterMesh = Schema.Struct({ "apiServer": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumClusterMeshApiServer), "enabled": Schema.optionalKey(Schema.Boolean) })
export type Cloud_ProjectKubeCustomizationCiliumHubbleUI = { readonly "backendResources"?: Cloud_ProjectKubeCustomizationCiliumHubbleUIResources, readonly "enabled"?: boolean, readonly "frontendResources"?: Cloud_ProjectKubeCustomizationCiliumHubbleUIResources }
export const Cloud_ProjectKubeCustomizationCiliumHubbleUI = Schema.Struct({ "backendResources": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumHubbleUIResources), "enabled": Schema.optionalKey(Schema.Boolean), "frontendResources": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumHubbleUIResources) })
export type Cloud_ProjectKubeCustomizationKubeProxy = { readonly "iptables"?: Cloud_ProjectKubeCustomizationKubeProxyIptables, readonly "ipvs"?: Cloud_ProjectKubeCustomizationKubeProxyIpvs }
export const Cloud_ProjectKubeCustomizationKubeProxy = Schema.Struct({ "iptables": Schema.optionalKey(Cloud_ProjectKubeCustomizationKubeProxyIptables), "ipvs": Schema.optionalKey(Cloud_ProjectKubeCustomizationKubeProxyIpvs) })
export type Cloud_kube_NodePoolTemplateSpec = { readonly "taints": ReadonlyArray<Cloud_kube_Taint>, readonly "unschedulable": boolean }
export const Cloud_kube_NodePoolTemplateSpec = Schema.Struct({ "taints": Schema.Array(Cloud_kube_Taint), "unschedulable": Schema.Boolean })
export type Cloud_ProjectKubeCustomizationCiliumHubble = { readonly "enabled"?: boolean, readonly "relay"?: Cloud_ProjectKubeCustomizationCiliumHubbleRelay, readonly "ui"?: Cloud_ProjectKubeCustomizationCiliumHubbleUI }
export const Cloud_ProjectKubeCustomizationCiliumHubble = Schema.Struct({ "enabled": Schema.optionalKey(Schema.Boolean), "relay": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumHubbleRelay), "ui": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumHubbleUI) })
export type Cloud_kube_NodePoolTemplate = { readonly "metadata": Cloud_kube_NodePoolTemplateMetadata, readonly "spec": Cloud_kube_NodePoolTemplateSpec }
export const Cloud_kube_NodePoolTemplate = Schema.Struct({ "metadata": Cloud_kube_NodePoolTemplateMetadata, "spec": Cloud_kube_NodePoolTemplateSpec })
export type Cloud_ProjectKubeCustomizationCilium = { readonly "clusterId"?: number, readonly "clusterMesh"?: Cloud_ProjectKubeCustomizationCiliumClusterMesh, readonly "hubble"?: Cloud_ProjectKubeCustomizationCiliumHubble }
export const Cloud_ProjectKubeCustomizationCilium = Schema.Struct({ "clusterId": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "clusterMesh": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumClusterMesh), "hubble": Schema.optionalKey(Cloud_ProjectKubeCustomizationCiliumHubble) })
export type Cloud_ProjectKubeCreationNodePool = { readonly "antiAffinity"?: boolean, readonly "attachFloatingIps"?: Cloud_ProjectKubeNodePoolAttachFloatingIpsParams, readonly "autoscale"?: boolean, readonly "autoscaling"?: Cloud_ProjectKubeNodePoolAutoscalingParams, readonly "availabilityZones"?: ReadonlyArray<string>, readonly "desiredNodes"?: number, readonly "flavorName": string, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "monthlyBilled"?: boolean, readonly "name"?: string, readonly "template"?: Cloud_kube_NodePoolTemplate }
export const Cloud_ProjectKubeCreationNodePool = Schema.Struct({ "antiAffinity": Schema.optionalKey(Schema.Boolean), "attachFloatingIps": Schema.optionalKey(Cloud_ProjectKubeNodePoolAttachFloatingIpsParams), "autoscale": Schema.optionalKey(Schema.Boolean), "autoscaling": Schema.optionalKey(Cloud_ProjectKubeNodePoolAutoscalingParams), "availabilityZones": Schema.optionalKey(Schema.Array(Schema.String)), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "flavorName": Schema.String, "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "monthlyBilled": Schema.optionalKey(Schema.Boolean), "name": Schema.optionalKey(Schema.String), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate) })
export type Cloud_ProjectKubeNodePoolCreation = { readonly "antiAffinity"?: boolean, readonly "attachFloatingIps"?: Cloud_ProjectKubeNodePoolAttachFloatingIpsParams, readonly "autoscale"?: boolean, readonly "autoscaling"?: Cloud_ProjectKubeNodePoolAutoscalingParams, readonly "availabilityZones"?: ReadonlyArray<string>, readonly "desiredNodes"?: number, readonly "flavorName": string, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "monthlyBilled"?: boolean, readonly "name"?: string, readonly "template"?: Cloud_kube_NodePoolTemplate }
export const Cloud_ProjectKubeNodePoolCreation = Schema.Struct({ "antiAffinity": Schema.optionalKey(Schema.Boolean), "attachFloatingIps": Schema.optionalKey(Cloud_ProjectKubeNodePoolAttachFloatingIpsParams), "autoscale": Schema.optionalKey(Schema.Boolean), "autoscaling": Schema.optionalKey(Cloud_ProjectKubeNodePoolAutoscalingParams), "availabilityZones": Schema.optionalKey(Schema.Array(Schema.String)), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "flavorName": Schema.String, "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "monthlyBilled": Schema.optionalKey(Schema.Boolean), "name": Schema.optionalKey(Schema.String), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate) })
export type Cloud_ProjectKubeNodePoolUpdate = { readonly "attachFloatingIps"?: Cloud_ProjectKubeNodePoolAttachFloatingIpsParams, readonly "autoscale"?: boolean, readonly "autoscaling"?: Cloud_ProjectKubeNodePoolAutoscalingParams, readonly "desiredNodes"?: number, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "nodesToRemove"?: ReadonlyArray<string>, readonly "template"?: Cloud_kube_NodePoolTemplate }
export const Cloud_ProjectKubeNodePoolUpdate = Schema.Struct({ "attachFloatingIps": Schema.optionalKey(Cloud_ProjectKubeNodePoolAttachFloatingIpsParams), "autoscale": Schema.optionalKey(Schema.Boolean), "autoscaling": Schema.optionalKey(Cloud_ProjectKubeNodePoolAutoscalingParams), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "nodesToRemove": Schema.optionalKey(Schema.Array(Schema.String)), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate) })
export type Cloud_kube_NodePool = { readonly "antiAffinity"?: boolean, readonly "attachFloatingIps"?: Cloud_kube_NodePoolAttachFloatingIps, readonly "autoscale"?: boolean, readonly "autoscaling"?: Cloud_kube_NodePoolAutoscaling, readonly "availabilityZones"?: ReadonlyArray<string>, readonly "availableNodes"?: number, readonly "createdAt"?: string, readonly "currentNodes"?: number, readonly "desiredNodes"?: number, readonly "flavor"?: string, readonly "id"?: string, readonly "maxNodes"?: number, readonly "minNodes"?: number, readonly "monthlyBilled"?: boolean, readonly "name"?: string, readonly "projectId"?: string, readonly "sizeStatus"?: Cloud_kube_NodePoolSizeStatusEnum, readonly "status"?: Cloud_kube_NodePoolStatusEnum, readonly "template"?: Cloud_kube_NodePoolTemplate, readonly "upToDateNodes"?: number, readonly "updatedAt"?: string }
export const Cloud_kube_NodePool = Schema.Struct({ "antiAffinity": Schema.optionalKey(Schema.Boolean), "attachFloatingIps": Schema.optionalKey(Cloud_kube_NodePoolAttachFloatingIps), "autoscale": Schema.optionalKey(Schema.Boolean), "autoscaling": Schema.optionalKey(Cloud_kube_NodePoolAutoscaling), "availabilityZones": Schema.optionalKey(Schema.Array(Schema.String)), "availableNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "createdAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "currentNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "desiredNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "flavor": Schema.optionalKey(Schema.String), "id": Schema.optionalKey(Schema.String), "maxNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "minNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "monthlyBilled": Schema.optionalKey(Schema.Boolean), "name": Schema.optionalKey(Schema.String), "projectId": Schema.optionalKey(Schema.String), "sizeStatus": Schema.optionalKey(Cloud_kube_NodePoolSizeStatusEnum), "status": Schema.optionalKey(Cloud_kube_NodePoolStatusEnum), "template": Schema.optionalKey(Cloud_kube_NodePoolTemplate), "upToDateNodes": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "updatedAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })) })
export type Cloud_ProjectKubeCustomization = { readonly "apiServer"?: Cloud_ProjectKubeCustomizationAPIServer, readonly "cilium"?: Cloud_ProjectKubeCustomizationCilium, readonly "kubeProxy"?: Cloud_ProjectKubeCustomizationKubeProxy }
export const Cloud_ProjectKubeCustomization = Schema.Struct({ "apiServer": Schema.optionalKey(Cloud_ProjectKubeCustomizationAPIServer), "cilium": Schema.optionalKey(Cloud_ProjectKubeCustomizationCilium), "kubeProxy": Schema.optionalKey(Cloud_ProjectKubeCustomizationKubeProxy) })
export type Cloud_ProjectKubeCreation = { readonly "customization"?: Cloud_ProjectKubeCustomization, readonly "ipAllocationPolicy"?: Cloud_ProjectKubeIpAllocationPolicy, readonly "kubeProxyMode"?: Cloud_kube_KubeProxyModeEnum, readonly "loadBalancersSubnetId"?: string, readonly "name"?: string, readonly "nodepool"?: Cloud_ProjectKubeCreationNodePool, readonly "nodepools"?: ReadonlyArray<Cloud_ProjectKubeCreationNodePool>, readonly "nodesSubnetId"?: string, readonly "plan"?: string, readonly "privateNetworkConfiguration"?: Cloud_kube_PrivateNetworkConfiguration, readonly "privateNetworkId"?: string, readonly "region": string, readonly "updatePolicy"?: Cloud_kube_UpdatePolicyEnum, readonly "version"?: Cloud_kube_VersionEnum }
export const Cloud_ProjectKubeCreation = Schema.Struct({ "customization": Schema.optionalKey(Cloud_ProjectKubeCustomization), "ipAllocationPolicy": Schema.optionalKey(Cloud_ProjectKubeIpAllocationPolicy), "kubeProxyMode": Schema.optionalKey(Cloud_kube_KubeProxyModeEnum), "loadBalancersSubnetId": Schema.optionalKey(Schema.String.annotate({ "format": "uuid" })), "name": Schema.optionalKey(Schema.String), "nodepool": Schema.optionalKey(Cloud_ProjectKubeCreationNodePool), "nodepools": Schema.optionalKey(Schema.Array(Cloud_ProjectKubeCreationNodePool)), "nodesSubnetId": Schema.optionalKey(Schema.String), "plan": Schema.optionalKey(Schema.String), "privateNetworkConfiguration": Schema.optionalKey(Cloud_kube_PrivateNetworkConfiguration), "privateNetworkId": Schema.optionalKey(Schema.String), "region": Schema.String, "updatePolicy": Schema.optionalKey(Cloud_kube_UpdatePolicyEnum), "version": Schema.optionalKey(Cloud_kube_VersionEnum) })
export type Cloud_kube_Cluster = { readonly "auditLogsSubscribed"?: boolean, readonly "controlPlaneIsUpToDate"?: boolean, readonly "createdAt"?: string, readonly "customization"?: Cloud_ProjectKubeCustomization, readonly "id"?: string, readonly "ipAllocationPolicy"?: Cloud_ProjectKubeIpAllocationPolicy, readonly "isUpToDate"?: boolean, readonly "kubeProxyMode"?: Cloud_kube_KubeProxyModeEnum, readonly "loadBalancersSubnetId"?: string, readonly "name"?: string, readonly "nextUpgradeVersions"?: ReadonlyArray<string>, readonly "nodesSubnetId"?: string, readonly "nodesUrl"?: string, readonly "plan"?: string, readonly "privateNetworkConfiguration"?: Cloud_kube_PrivateNetworkConfiguration, readonly "privateNetworkId"?: string, readonly "region"?: string, readonly "status"?: Cloud_kube_ClusterStatusEnum, readonly "updatePolicy"?: string, readonly "updatedAt"?: string, readonly "url"?: string, readonly "version"?: string }
export const Cloud_kube_Cluster = Schema.Struct({ "auditLogsSubscribed": Schema.optionalKey(Schema.Boolean), "controlPlaneIsUpToDate": Schema.optionalKey(Schema.Boolean), "createdAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "customization": Schema.optionalKey(Cloud_ProjectKubeCustomization), "id": Schema.optionalKey(Schema.String), "ipAllocationPolicy": Schema.optionalKey(Cloud_ProjectKubeIpAllocationPolicy), "isUpToDate": Schema.optionalKey(Schema.Boolean), "kubeProxyMode": Schema.optionalKey(Cloud_kube_KubeProxyModeEnum), "loadBalancersSubnetId": Schema.optionalKey(Schema.String.annotate({ "format": "uuid" })), "name": Schema.optionalKey(Schema.String), "nextUpgradeVersions": Schema.optionalKey(Schema.Array(Schema.String)), "nodesSubnetId": Schema.optionalKey(Schema.String), "nodesUrl": Schema.optionalKey(Schema.String), "plan": Schema.optionalKey(Schema.String), "privateNetworkConfiguration": Schema.optionalKey(Cloud_kube_PrivateNetworkConfiguration), "privateNetworkId": Schema.optionalKey(Schema.String), "region": Schema.optionalKey(Schema.String), "status": Schema.optionalKey(Cloud_kube_ClusterStatusEnum), "updatePolicy": Schema.optionalKey(Schema.String), "updatedAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "url": Schema.optionalKey(Schema.String), "version": Schema.optionalKey(Schema.String) })
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
      orElse: unexpectedStatus
    }))
  ),
    "deleteCloudProjectServiceNameKubeKubeId": (serviceName, kubeId, options) => HttpClientRequest.delete(`/cloud/project/${serviceName}/kube/${kubeId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
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
      orElse: unexpectedStatus
    }))
  ),
    "deleteCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": (serviceName, kubeId, nodePoolId, options) => HttpClientRequest.delete(`/cloud/project/${serviceName}/kube/${kubeId}/nodepool/${nodePoolId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameKubeKubeIdUpdate": (serviceName, kubeId, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/kube/${kubeId}/update`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface Mks {
  readonly httpClient: HttpClient.HttpClient
  /**
* List your managed Kubernetes clusters
*/
readonly "getCloudProjectServiceNameKube": <Config extends OperationConfig>(serviceName: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKube200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Create a new managed Kubernetes cluster
*/
readonly "postCloudProjectServiceNameKube": <Config extends OperationConfig>(serviceName: string, options: { readonly payload: typeof PostCloudProjectServiceNameKubeRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameKube200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get information about your managed Kubernetes cluster
*/
readonly "getCloudProjectServiceNameKubeKubeId": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKubeKubeId200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Update information about your managed Kubernetes cluster
*/
readonly "putCloudProjectServiceNameKubeKubeId": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly payload: typeof PutCloudProjectServiceNameKubeKubeIdRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Delete your managed Kubernetes cluster
*/
readonly "deleteCloudProjectServiceNameKubeKubeId": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Generate kubeconfig file
*/
readonly "postCloudProjectServiceNameKubeKubeIdKubeconfig": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameKubeKubeIdKubeconfig200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Reset kubeconfig: Certificates will be regenerated, nodes will be reinstalled
*/
readonly "postCloudProjectServiceNameKubeKubeIdKubeconfigReset": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* List your nodepools
*/
readonly "getCloudProjectServiceNameKubeKubeIdNodepool": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKubeKubeIdNodepool200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Create a nodepool on your cluster
*/
readonly "postCloudProjectServiceNameKubeKubeIdNodepool": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly payload: typeof PostCloudProjectServiceNameKubeKubeIdNodepoolRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameKubeKubeIdNodepool200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get information on a specific nodepool on your cluster
*/
readonly "getCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": <Config extends OperationConfig>(serviceName: string, kubeId: string, nodePoolId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Update your nodepool information
*/
readonly "putCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": <Config extends OperationConfig>(serviceName: string, kubeId: string, nodePoolId: string, options: { readonly payload: typeof PutCloudProjectServiceNameKubeKubeIdNodepoolNodePoolIdRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Delete a nodepool from your cluster
*/
readonly "deleteCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId": <Config extends OperationConfig>(serviceName: string, kubeId: string, nodePoolId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Force cluster and node update to the latest patch within minor version or next minor version
*/
readonly "postCloudProjectServiceNameKubeKubeIdUpdate": <Config extends OperationConfig>(serviceName: string, kubeId: string, options: { readonly payload: typeof PostCloudProjectServiceNameKubeKubeIdUpdateRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
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