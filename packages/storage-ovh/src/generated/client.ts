import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type Cloud_StorageLifecycleRuleAbortIncompleteMultipartUpload = { readonly "daysAfterInitiation": number }
export const Cloud_StorageLifecycleRuleAbortIncompleteMultipartUpload = Schema.Struct({ "daysAfterInitiation": Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()) })
export type Cloud_StorageLifecycleRuleExpiration = { readonly "date"?: string | null, readonly "days"?: number | null, readonly "expiredObjectDeleteMarker"?: boolean | null }
export const Cloud_StorageLifecycleRuleExpiration = Schema.Struct({ "date": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date" }), Schema.Null])), "days": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "expiredObjectDeleteMarker": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])) })
export type Cloud_StorageLifecycleRuleFilter = { readonly "objectSizeGreaterThan"?: number | null, readonly "objectSizeLessThan"?: number | null, readonly "prefix"?: string | null, readonly "tags"?: {  } | null }
export const Cloud_StorageLifecycleRuleFilter = Schema.Struct({ "objectSizeGreaterThan": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "objectSizeLessThan": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "prefix": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "tags": Schema.optionalKey(Schema.Union([Schema.Struct({  }), Schema.Null])) })
export type Cloud_StorageLifecycleRuleNoncurrentVersionExpiration = { readonly "newerNoncurrentVersions"?: number | null, readonly "noncurrentDays"?: number | null }
export const Cloud_StorageLifecycleRuleNoncurrentVersionExpiration = Schema.Struct({ "newerNoncurrentVersions": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "noncurrentDays": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])) })
export type Cloud_StorageObjectRestoreStatus = { readonly "expireDate"?: string | null, readonly "inProgress"?: boolean }
export const Cloud_StorageObjectRestoreStatus = Schema.Struct({ "expireDate": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date-time" }), Schema.Null])), "inProgress": Schema.optionalKey(Schema.Boolean) })
export type Cloud_StorageReplicationRuleFilter = { readonly "prefix"?: string | null, readonly "tags"?: {  } | null }
export const Cloud_StorageReplicationRuleFilter = Schema.Struct({ "prefix": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "tags": Schema.optionalKey(Schema.Union([Schema.Struct({  }), Schema.Null])) })
export type Cloud_role_Role = { readonly "description"?: string, readonly "id"?: string, readonly "name"?: string, readonly "permissions"?: ReadonlyArray<string> }
export const Cloud_role_Role = Schema.Struct({ "description": Schema.optionalKey(Schema.String), "id": Schema.optionalKey(Schema.String), "name": Schema.optionalKey(Schema.String), "permissions": Schema.optionalKey(Schema.Array(Schema.String)) })
export type Cloud_storage_EncryptionAlgorithmEnum = "AES256" | "plaintext"
export const Cloud_storage_EncryptionAlgorithmEnum = Schema.Literals(["AES256", "plaintext"])
export type Cloud_storage_LifecycleRuleStatusEnum = "disabled" | "enabled"
export const Cloud_storage_LifecycleRuleStatusEnum = Schema.Literals(["disabled", "enabled"])
export type Cloud_storage_LifecycleRuleTransitionStorageClassEnum = "DEEP_ARCHIVE" | "GLACIER_IR" | "STANDARD" | "STANDARD_IA"
export const Cloud_storage_LifecycleRuleTransitionStorageClassEnum = Schema.Literals(["DEEP_ARCHIVE", "GLACIER_IR", "STANDARD", "STANDARD_IA"])
export type Cloud_storage_ObjectLockModeEnum = "compliance" | "governance"
export const Cloud_storage_ObjectLockModeEnum = Schema.Literals(["compliance", "governance"])
export type Cloud_storage_ObjectLockStatusEnum = "disabled" | "enabled"
export const Cloud_storage_ObjectLockStatusEnum = Schema.Literals(["disabled", "enabled"])
export type Cloud_storage_ReplicationRuleDeleteMarkerReplicationStatusEnum = "disabled" | "enabled"
export const Cloud_storage_ReplicationRuleDeleteMarkerReplicationStatusEnum = Schema.Literals(["disabled", "enabled"])
export type Cloud_storage_ReplicationRuleStatusEnum = "disabled" | "enabled"
export const Cloud_storage_ReplicationRuleStatusEnum = Schema.Literals(["disabled", "enabled"])
export type Cloud_storage_StorageClassEnum = "DEEP_ARCHIVE" | "GLACIER_IR" | "HIGH_PERF" | "STANDARD" | "STANDARD_IA"
export const Cloud_storage_StorageClassEnum = Schema.Literals(["DEEP_ARCHIVE", "GLACIER_IR", "HIGH_PERF", "STANDARD", "STANDARD_IA"])
export type Cloud_storage_StorageClassReplicationEnum = "DEEP_ARCHIVE" | "GLACIER" | "GLACIER_IR" | "HIGH_PERF" | "INTELLIGENT_TIERING" | "ONEZONE_IA" | "STANDARD" | "STANDARD_IA"
export const Cloud_storage_StorageClassReplicationEnum = Schema.Literals(["DEEP_ARCHIVE", "GLACIER", "GLACIER_IR", "HIGH_PERF", "INTELLIGENT_TIERING", "ONEZONE_IA", "STANDARD", "STANDARD_IA"])
export type Cloud_storage_VersioningStatusEnum = "disabled" | "enabled" | "suspended"
export const Cloud_storage_VersioningStatusEnum = Schema.Literals(["disabled", "enabled", "suspended"])
export type Cloud_user_RoleEnum = "administrator" | "ai_training_operator" | "ai_training_read" | "authentication" | "backup_operator" | "compute_operator" | "image_operator" | "infrastructure_supervisor" | "key-manager_operator" | "key-manager_read" | "load-balancer_operator" | "network_operator" | "network_security_operator" | "objectstore_operator" | "quantum_operator" | "quantum_reader" | "share_operator" | "volume_operator"
export const Cloud_user_RoleEnum = Schema.Literals(["administrator", "ai_training_operator", "ai_training_read", "authentication", "backup_operator", "compute_operator", "image_operator", "infrastructure_supervisor", "key-manager_operator", "key-manager_read", "load-balancer_operator", "network_operator", "network_security_operator", "objectstore_operator", "quantum_operator", "quantum_reader", "share_operator", "volume_operator"])
export type Cloud_user_S3Credentials = { readonly "access"?: string, readonly "tenantId"?: string, readonly "userId"?: string }
export const Cloud_user_S3Credentials = Schema.Struct({ "access": Schema.optionalKey(Schema.String), "tenantId": Schema.optionalKey(Schema.String), "userId": Schema.optionalKey(Schema.String) })
export type Cloud_user_S3CredentialsWithSecret = { readonly "access"?: string, readonly "secret"?: string, readonly "tenantId"?: string, readonly "userId"?: string }
export const Cloud_user_S3CredentialsWithSecret = Schema.Struct({ "access": Schema.optionalKey(Schema.String), "secret": Schema.optionalKey(Schema.String.annotate({ "format": "password" })), "tenantId": Schema.optionalKey(Schema.String), "userId": Schema.optionalKey(Schema.String) })
export type Cloud_user_UserStatusEnum = "creating" | "deleted" | "deleting" | "disabled" | "ok" | "updating"
export const Cloud_user_UserStatusEnum = Schema.Literals(["creating", "deleted", "deleting", "disabled", "ok", "updating"])
export type Cloud_StorageEncryptionObject = { readonly "sseAlgorithm"?: Cloud_storage_EncryptionAlgorithmEnum | null }
export const Cloud_StorageEncryptionObject = Schema.Struct({ "sseAlgorithm": Schema.optionalKey(Schema.Union([Cloud_storage_EncryptionAlgorithmEnum, Schema.Null])) })
export type Cloud_StorageLifecycleRuleTransition = { readonly "date"?: string | null, readonly "days"?: number | null, readonly "storageClass"?: Cloud_storage_LifecycleRuleTransitionStorageClassEnum }
export const Cloud_StorageLifecycleRuleTransition = Schema.Struct({ "date": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date" }), Schema.Null])), "days": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "storageClass": Schema.optionalKey(Cloud_storage_LifecycleRuleTransitionStorageClassEnum) })
export type Cloud_StorageLockConfigurationRule = { readonly "mode"?: Cloud_storage_ObjectLockModeEnum, readonly "period"?: string }
export const Cloud_StorageLockConfigurationRule = Schema.Struct({ "mode": Schema.optionalKey(Cloud_storage_ObjectLockModeEnum), "period": Schema.optionalKey(Schema.String.annotate({ "format": "duration" })) })
export type Cloud_StorageLifecycleRuleNoncurrentVersionTransition = { readonly "newerNoncurrentVersions"?: number | null, readonly "noncurrentDays"?: number | null, readonly "storageClass"?: Cloud_storage_StorageClassEnum | null }
export const Cloud_StorageLifecycleRuleNoncurrentVersionTransition = Schema.Struct({ "newerNoncurrentVersions": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "noncurrentDays": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "storageClass": Schema.optionalKey(Schema.Union([Cloud_storage_StorageClassEnum, Schema.Null])) })
export type Cloud_StorageObjectList = { readonly "etag"?: string | null, readonly "isCommonPrefix"?: boolean | null, readonly "isDeleteMarker"?: boolean | null, readonly "isLatest"?: boolean | null, readonly "key"?: string, readonly "lastModified"?: string | null, readonly "restoreStatus"?: Cloud_StorageObjectRestoreStatus | null, readonly "size"?: number, readonly "storageClass"?: Cloud_storage_StorageClassEnum | null, readonly "versionId"?: string | null }
export const Cloud_StorageObjectList = Schema.Struct({ "etag": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "isCommonPrefix": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "isDeleteMarker": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "isLatest": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])), "key": Schema.optionalKey(Schema.String), "lastModified": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "date-time" }), Schema.Null])), "restoreStatus": Schema.optionalKey(Schema.Union([Cloud_StorageObjectRestoreStatus, Schema.Null])), "size": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "storageClass": Schema.optionalKey(Schema.Union([Cloud_storage_StorageClassEnum, Schema.Null])), "versionId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])) })
export type Cloud_StorageReplicationRuleDestination = { readonly "name"?: string, readonly "region"?: string | null, readonly "storageClass"?: Cloud_storage_StorageClassReplicationEnum | null }
export const Cloud_StorageReplicationRuleDestination = Schema.Struct({ "name": Schema.optionalKey(Schema.String), "region": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "storageClass": Schema.optionalKey(Schema.Union([Cloud_storage_StorageClassReplicationEnum, Schema.Null])) })
export type Cloud_StorageReplicationRuleDestinationIn = { readonly "name"?: string, readonly "region": string, readonly "storageClass"?: Cloud_storage_StorageClassReplicationEnum | null }
export const Cloud_StorageReplicationRuleDestinationIn = Schema.Struct({ "name": Schema.optionalKey(Schema.String), "region": Schema.String, "storageClass": Schema.optionalKey(Schema.Union([Cloud_storage_StorageClassReplicationEnum, Schema.Null])) })
export type Cloud_StorageVersioningObject = { readonly "status"?: Cloud_storage_VersioningStatusEnum | null }
export const Cloud_StorageVersioningObject = Schema.Struct({ "status": Schema.optionalKey(Schema.Union([Cloud_storage_VersioningStatusEnum, Schema.Null])) })
export type Cloud_ProjectUserCreation = { readonly "description"?: string | null, readonly "role"?: Cloud_user_RoleEnum | null, readonly "roles"?: ReadonlyArray<Cloud_user_RoleEnum> | null }
export const Cloud_ProjectUserCreation = Schema.Struct({ "description": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "role": Schema.optionalKey(Schema.Union([Cloud_user_RoleEnum, Schema.Null])), "roles": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_user_RoleEnum), Schema.Null])) })
export type Cloud_user_User = { readonly "creationDate"?: string, readonly "description"?: string, readonly "id"?: number, readonly "openstackId"?: string | null, readonly "roles"?: ReadonlyArray<Cloud_role_Role>, readonly "status"?: Cloud_user_UserStatusEnum, readonly "username"?: string }
export const Cloud_user_User = Schema.Struct({ "creationDate": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "description": Schema.optionalKey(Schema.String), "id": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "openstackId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "roles": Schema.optionalKey(Schema.Array(Cloud_role_Role)), "status": Schema.optionalKey(Cloud_user_UserStatusEnum), "username": Schema.optionalKey(Schema.String) })
export type Cloud_user_UserDetail = { readonly "creationDate"?: string, readonly "description"?: string, readonly "id"?: number, readonly "openstackId"?: string | null, readonly "password"?: string, readonly "roles"?: ReadonlyArray<Cloud_role_Role>, readonly "status"?: Cloud_user_UserStatusEnum, readonly "username"?: string }
export const Cloud_user_UserDetail = Schema.Struct({ "creationDate": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "description": Schema.optionalKey(Schema.String), "id": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "openstackId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "password": Schema.optionalKey(Schema.String), "roles": Schema.optionalKey(Schema.Array(Cloud_role_Role)), "status": Schema.optionalKey(Cloud_user_UserStatusEnum), "username": Schema.optionalKey(Schema.String) })
export type Cloud_StorageLockConfiguration = { readonly "rule"?: Cloud_StorageLockConfigurationRule | null, readonly "status"?: Cloud_storage_ObjectLockStatusEnum }
export const Cloud_StorageLockConfiguration = Schema.Struct({ "rule": Schema.optionalKey(Schema.Union([Cloud_StorageLockConfigurationRule, Schema.Null])), "status": Schema.optionalKey(Cloud_storage_ObjectLockStatusEnum) })
export type Cloud_storage_LifecycleRule = { readonly "abortIncompleteMultipartUpload"?: Cloud_StorageLifecycleRuleAbortIncompleteMultipartUpload | null, readonly "expiration"?: Cloud_StorageLifecycleRuleExpiration | null, readonly "filter"?: Cloud_StorageLifecycleRuleFilter | null, readonly "id"?: string, readonly "noncurrentVersionExpiration"?: Cloud_StorageLifecycleRuleNoncurrentVersionExpiration | null, readonly "noncurrentVersionTransitions"?: ReadonlyArray<Cloud_StorageLifecycleRuleNoncurrentVersionTransition> | null, readonly "status": Cloud_storage_LifecycleRuleStatusEnum, readonly "transitions"?: ReadonlyArray<Cloud_StorageLifecycleRuleTransition> | null }
export const Cloud_storage_LifecycleRule = Schema.Struct({ "abortIncompleteMultipartUpload": Schema.optionalKey(Schema.Union([Cloud_StorageLifecycleRuleAbortIncompleteMultipartUpload, Schema.Null])), "expiration": Schema.optionalKey(Schema.Union([Cloud_StorageLifecycleRuleExpiration, Schema.Null])), "filter": Schema.optionalKey(Schema.Union([Cloud_StorageLifecycleRuleFilter, Schema.Null])), "id": Schema.optionalKey(Schema.String), "noncurrentVersionExpiration": Schema.optionalKey(Schema.Union([Cloud_StorageLifecycleRuleNoncurrentVersionExpiration, Schema.Null])), "noncurrentVersionTransitions": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_StorageLifecycleRuleNoncurrentVersionTransition), Schema.Null])), "status": Cloud_storage_LifecycleRuleStatusEnum, "transitions": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_StorageLifecycleRuleTransition), Schema.Null])) })
export type Cloud_StorageContainerList = { readonly "createdAt"?: string, readonly "name"?: string, readonly "objects"?: ReadonlyArray<Cloud_StorageObjectList>, readonly "objectsCount"?: number, readonly "objectsSize"?: number, readonly "ownerId"?: number, readonly "region"?: string, readonly "virtualHost"?: string }
export const Cloud_StorageContainerList = Schema.Struct({ "createdAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "name": Schema.optionalKey(Schema.String), "objects": Schema.optionalKey(Schema.Array(Cloud_StorageObjectList)), "objectsCount": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "objectsSize": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "ownerId": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "region": Schema.optionalKey(Schema.String), "virtualHost": Schema.optionalKey(Schema.String) })
export type Cloud_storage_ReplicationRule = { readonly "deleteMarkerReplication"?: Cloud_storage_ReplicationRuleDeleteMarkerReplicationStatusEnum, readonly "destination"?: Cloud_StorageReplicationRuleDestination | null, readonly "filter"?: Cloud_StorageReplicationRuleFilter | null, readonly "id"?: string, readonly "priority"?: number, readonly "status"?: Cloud_storage_ReplicationRuleStatusEnum }
export const Cloud_storage_ReplicationRule = Schema.Struct({ "deleteMarkerReplication": Schema.optionalKey(Cloud_storage_ReplicationRuleDeleteMarkerReplicationStatusEnum), "destination": Schema.optionalKey(Schema.Union([Cloud_StorageReplicationRuleDestination, Schema.Null])), "filter": Schema.optionalKey(Schema.Union([Cloud_StorageReplicationRuleFilter, Schema.Null])), "id": Schema.optionalKey(Schema.String), "priority": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "status": Schema.optionalKey(Cloud_storage_ReplicationRuleStatusEnum) })
export type Cloud_storage_ReplicationRuleIn = { readonly "deleteMarkerReplication"?: Cloud_storage_ReplicationRuleDeleteMarkerReplicationStatusEnum, readonly "destination"?: Cloud_StorageReplicationRuleDestinationIn | null, readonly "filter"?: Cloud_StorageReplicationRuleFilter | null, readonly "id"?: string, readonly "priority"?: number, readonly "status"?: Cloud_storage_ReplicationRuleStatusEnum }
export const Cloud_storage_ReplicationRuleIn = Schema.Struct({ "deleteMarkerReplication": Schema.optionalKey(Cloud_storage_ReplicationRuleDeleteMarkerReplicationStatusEnum), "destination": Schema.optionalKey(Schema.Union([Cloud_StorageReplicationRuleDestinationIn, Schema.Null])), "filter": Schema.optionalKey(Schema.Union([Cloud_StorageReplicationRuleFilter, Schema.Null])), "id": Schema.optionalKey(Schema.String), "priority": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "status": Schema.optionalKey(Cloud_storage_ReplicationRuleStatusEnum) })
export type Cloud_StorageLifecycleConfiguration = { readonly "rules": ReadonlyArray<Cloud_storage_LifecycleRule> | null }
export const Cloud_StorageLifecycleConfiguration = Schema.Struct({ "rules": Schema.Union([Schema.Array(Cloud_storage_LifecycleRule), Schema.Null]) })
export type Cloud_StorageReplicationObject = { readonly "rules"?: ReadonlyArray<Cloud_storage_ReplicationRule> | null }
export const Cloud_StorageReplicationObject = Schema.Struct({ "rules": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_storage_ReplicationRule), Schema.Null])) })
export type Cloud_StorageReplicationObjectIn = { readonly "rules"?: ReadonlyArray<Cloud_storage_ReplicationRuleIn> | null }
export const Cloud_StorageReplicationObjectIn = Schema.Struct({ "rules": Schema.optionalKey(Schema.Union([Schema.Array(Cloud_storage_ReplicationRuleIn), Schema.Null])) })
export type Cloud_StorageContainer = { readonly "createdAt"?: string, readonly "encryption"?: Cloud_StorageEncryptionObject | null, readonly "lifecycle"?: Cloud_StorageLifecycleConfiguration | null, readonly "name"?: string, readonly "objectLock"?: Cloud_StorageLockConfiguration | null, readonly "objects"?: ReadonlyArray<Cloud_StorageObjectList>, readonly "objectsCount"?: number, readonly "objectsSize"?: number, readonly "ownerId"?: number, readonly "region"?: string, readonly "replication"?: Cloud_StorageReplicationObject | null, readonly "tags"?: {  } | null, readonly "versioning"?: Cloud_StorageVersioningObject | null, readonly "virtualHost"?: string }
export const Cloud_StorageContainer = Schema.Struct({ "createdAt": Schema.optionalKey(Schema.String.annotate({ "format": "date-time" })), "encryption": Schema.optionalKey(Schema.Union([Cloud_StorageEncryptionObject, Schema.Null])), "lifecycle": Schema.optionalKey(Schema.Union([Cloud_StorageLifecycleConfiguration, Schema.Null])), "name": Schema.optionalKey(Schema.String), "objectLock": Schema.optionalKey(Schema.Union([Cloud_StorageLockConfiguration, Schema.Null])), "objects": Schema.optionalKey(Schema.Array(Cloud_StorageObjectList)), "objectsCount": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "objectsSize": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "ownerId": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "region": Schema.optionalKey(Schema.String), "replication": Schema.optionalKey(Schema.Union([Cloud_StorageReplicationObject, Schema.Null])), "tags": Schema.optionalKey(Schema.Union([Schema.Struct({  }), Schema.Null])), "versioning": Schema.optionalKey(Schema.Union([Cloud_StorageVersioningObject, Schema.Null])), "virtualHost": Schema.optionalKey(Schema.String) })
export type Cloud_StorageContainerCreation = { readonly "encryption"?: Cloud_StorageEncryptionObject | null, readonly "lifecycle"?: Cloud_StorageLifecycleConfiguration | null, readonly "name": string, readonly "objectLock"?: Cloud_StorageLockConfiguration | null, readonly "ownerId"?: number | null, readonly "replication"?: Cloud_StorageReplicationObjectIn | null, readonly "tags"?: {  } | null, readonly "versioning"?: Cloud_StorageVersioningObject | null }
export const Cloud_StorageContainerCreation = Schema.Struct({ "encryption": Schema.optionalKey(Schema.Union([Cloud_StorageEncryptionObject, Schema.Null])), "lifecycle": Schema.optionalKey(Schema.Union([Cloud_StorageLifecycleConfiguration, Schema.Null])), "name": Schema.String, "objectLock": Schema.optionalKey(Schema.Union([Cloud_StorageLockConfiguration, Schema.Null])), "ownerId": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "replication": Schema.optionalKey(Schema.Union([Cloud_StorageReplicationObjectIn, Schema.Null])), "tags": Schema.optionalKey(Schema.Union([Schema.Struct({  }), Schema.Null])), "versioning": Schema.optionalKey(Schema.Union([Cloud_StorageVersioningObject, Schema.Null])) })
export type Cloud_StorageContainerUpdate = { readonly "encryption"?: Cloud_StorageEncryptionObject | null, readonly "lifecycle"?: Cloud_StorageLifecycleConfiguration | null, readonly "objectLock"?: Cloud_StorageLockConfiguration | null, readonly "replication"?: Cloud_StorageReplicationObjectIn | null, readonly "tags"?: {  } | null, readonly "versioning"?: Cloud_StorageVersioningObject | null }
export const Cloud_StorageContainerUpdate = Schema.Struct({ "encryption": Schema.optionalKey(Schema.Union([Cloud_StorageEncryptionObject, Schema.Null])), "lifecycle": Schema.optionalKey(Schema.Union([Cloud_StorageLifecycleConfiguration, Schema.Null])), "objectLock": Schema.optionalKey(Schema.Union([Cloud_StorageLockConfiguration, Schema.Null])), "replication": Schema.optionalKey(Schema.Union([Cloud_StorageReplicationObjectIn, Schema.Null])), "tags": Schema.optionalKey(Schema.Union([Schema.Struct({  }), Schema.Null])), "versioning": Schema.optionalKey(Schema.Union([Cloud_StorageVersioningObject, Schema.Null])) })
// schemas
export type GetStorageContainersOnRegion200 = ReadonlyArray<Cloud_StorageContainerList>
export const GetStorageContainersOnRegion200 = Schema.Array(Cloud_StorageContainerList)
export type CreateStorageContainerOnRegionRequestJson = Cloud_StorageContainerCreation
export const CreateStorageContainerOnRegionRequestJson = Cloud_StorageContainerCreation
export type CreateStorageContainerOnRegion200 = Cloud_StorageContainer
export const CreateStorageContainerOnRegion200 = Cloud_StorageContainer
export type GetStorageContainerOnRegionParams = { readonly "limit"?: number, readonly "marker"?: string, readonly "noObjects"?: boolean, readonly "prefix"?: string }
export const GetStorageContainerOnRegionParams = Schema.Struct({ "limit": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "marker": Schema.optionalKey(Schema.String), "noObjects": Schema.optionalKey(Schema.Boolean), "prefix": Schema.optionalKey(Schema.String) })
export type GetStorageContainerOnRegion200 = Cloud_StorageContainer
export const GetStorageContainerOnRegion200 = Cloud_StorageContainer
export type UpdateStorageContainerOnRegionRequestJson = Cloud_StorageContainerUpdate
export const UpdateStorageContainerOnRegionRequestJson = Cloud_StorageContainerUpdate
export type UpdateStorageContainerOnRegion200 = Cloud_StorageContainer
export const UpdateStorageContainerOnRegion200 = Cloud_StorageContainer
export type GetObjectsInformationOnContainerOnRegionParams = { readonly "delimiter"?: string, readonly "keyMarker"?: string, readonly "limit"?: number, readonly "prefix"?: string, readonly "versionIdMarker"?: string, readonly "withVersions"?: boolean }
export const GetObjectsInformationOnContainerOnRegionParams = Schema.Struct({ "delimiter": Schema.optionalKey(Schema.String), "keyMarker": Schema.optionalKey(Schema.String), "limit": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "prefix": Schema.optionalKey(Schema.String), "versionIdMarker": Schema.optionalKey(Schema.String), "withVersions": Schema.optionalKey(Schema.Boolean) })
export type GetObjectsInformationOnContainerOnRegion200 = ReadonlyArray<Cloud_StorageObjectList>
export const GetObjectsInformationOnContainerOnRegion200 = Schema.Array(Cloud_StorageObjectList)
export type GetCloudProjectServiceNameUser200 = ReadonlyArray<Cloud_user_User>
export const GetCloudProjectServiceNameUser200 = Schema.Array(Cloud_user_User)
export type PostCloudProjectServiceNameUserRequestJson = Cloud_ProjectUserCreation
export const PostCloudProjectServiceNameUserRequestJson = Cloud_ProjectUserCreation
export type PostCloudProjectServiceNameUser200 = Cloud_user_UserDetail
export const PostCloudProjectServiceNameUser200 = Cloud_user_UserDetail
export type GetCloudProjectServiceNameUserUserId200 = Cloud_user_User
export const GetCloudProjectServiceNameUserUserId200 = Cloud_user_User
export type GetCloudProjectServiceNameUserUserIdS3Credentials200 = ReadonlyArray<Cloud_user_S3Credentials>
export const GetCloudProjectServiceNameUserUserIdS3Credentials200 = Schema.Array(Cloud_user_S3Credentials)
export type PostCloudProjectServiceNameUserUserIdS3Credentials200 = Cloud_user_S3CredentialsWithSecret
export const PostCloudProjectServiceNameUserUserIdS3Credentials200 = Cloud_user_S3CredentialsWithSecret

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
): Storage => {
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
        (cause) => Effect.fail(StorageError(tag, cause, response)),
      )
  return {
    httpClient,
    "getStorageContainersOnRegion": (serviceName, regionName, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/region/${regionName}/storage`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetStorageContainersOnRegion200),
      orElse: unexpectedStatus
    }))
  ),
    "createStorageContainerOnRegion": (serviceName, regionName, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/region/${regionName}/storage`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateStorageContainerOnRegion200),
      orElse: unexpectedStatus
    }))
  ),
    "getStorageContainerOnRegion": (serviceName, regionName, name, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/region/${regionName}/storage/${name}`).pipe(
    HttpClientRequest.setUrlParams({ "limit": options?.params?.["limit"] as any, "marker": options?.params?.["marker"] as any, "noObjects": options?.params?.["noObjects"] as any, "prefix": options?.params?.["prefix"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetStorageContainerOnRegion200),
      orElse: unexpectedStatus
    }))
  ),
    "updateStorageContainerOnRegion": (serviceName, regionName, name, options) => HttpClientRequest.put(`/cloud/project/${serviceName}/region/${regionName}/storage/${name}`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(UpdateStorageContainerOnRegion200),
      orElse: unexpectedStatus
    }))
  ),
    "deteteStorageContainerOnRegion": (serviceName, regionName, name, options) => HttpClientRequest.delete(`/cloud/project/${serviceName}/region/${regionName}/storage/${name}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "getObjectsInformationOnContainerOnRegion": (serviceName, regionName, name, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/region/${regionName}/storage/${name}/object`).pipe(
    HttpClientRequest.setUrlParams({ "delimiter": options?.params?.["delimiter"] as any, "keyMarker": options?.params?.["keyMarker"] as any, "limit": options?.params?.["limit"] as any, "prefix": options?.params?.["prefix"] as any, "versionIdMarker": options?.params?.["versionIdMarker"] as any, "withVersions": options?.params?.["withVersions"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetObjectsInformationOnContainerOnRegion200),
      orElse: unexpectedStatus
    }))
  ),
    "getCloudProjectServiceNameUser": (serviceName, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/user`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameUser200),
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameUser": (serviceName, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/user`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PostCloudProjectServiceNameUser200),
      orElse: unexpectedStatus
    }))
  ),
    "getCloudProjectServiceNameUserUserId": (serviceName, userId, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/user/${userId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameUserUserId200),
      orElse: unexpectedStatus
    }))
  ),
    "deleteCloudProjectServiceNameUserUserId": (serviceName, userId, options) => HttpClientRequest.delete(`/cloud/project/${serviceName}/user/${userId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "getCloudProjectServiceNameUserUserIdS3Credentials": (serviceName, userId, options) => HttpClientRequest.get(`/cloud/project/${serviceName}/user/${userId}/s3Credentials`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCloudProjectServiceNameUserUserIdS3Credentials200),
      orElse: unexpectedStatus
    }))
  ),
    "postCloudProjectServiceNameUserUserIdS3Credentials": (serviceName, userId, options) => HttpClientRequest.post(`/cloud/project/${serviceName}/user/${userId}/s3Credentials`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PostCloudProjectServiceNameUserUserIdS3Credentials200),
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface Storage {
  readonly httpClient: HttpClient.HttpClient
  /**
* Get S3™* compatible storage containers
*/
readonly "getStorageContainersOnRegion": <Config extends OperationConfig>(serviceName: string, regionName: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetStorageContainersOnRegion200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Create S3™* compatible storage container
*/
readonly "createStorageContainerOnRegion": <Config extends OperationConfig>(serviceName: string, regionName: string, options: { readonly payload: typeof CreateStorageContainerOnRegionRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateStorageContainerOnRegion200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get S3™* compatible storage container
*/
readonly "getStorageContainerOnRegion": <Config extends OperationConfig>(serviceName: string, regionName: string, name: string, options: { readonly params?: typeof GetStorageContainerOnRegionParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetStorageContainerOnRegion200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Update S3™* compatible storage container
*/
readonly "updateStorageContainerOnRegion": <Config extends OperationConfig>(serviceName: string, regionName: string, name: string, options: { readonly payload: typeof UpdateStorageContainerOnRegionRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof UpdateStorageContainerOnRegion200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Delete S3™* compatible storage container
*/
readonly "deteteStorageContainerOnRegion": <Config extends OperationConfig>(serviceName: string, regionName: string, name: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get objects of S3™* compatible storage containers
*/
readonly "getObjectsInformationOnContainerOnRegion": <Config extends OperationConfig>(serviceName: string, regionName: string, name: string, options: { readonly params?: typeof GetObjectsInformationOnContainerOnRegionParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetObjectsInformationOnContainerOnRegion200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get all users
*/
readonly "getCloudProjectServiceNameUser": <Config extends OperationConfig>(serviceName: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameUser200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Create user
*/
readonly "postCloudProjectServiceNameUser": <Config extends OperationConfig>(serviceName: string, options: { readonly payload: typeof PostCloudProjectServiceNameUserRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameUser200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get user details
*/
readonly "getCloudProjectServiceNameUserUserId": <Config extends OperationConfig>(serviceName: string, userId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameUserUserId200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Delete user
*/
readonly "deleteCloudProjectServiceNameUserUserId": <Config extends OperationConfig>(serviceName: string, userId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* List your S3™* compatible storage credentials
*/
readonly "getCloudProjectServiceNameUserUserIdS3Credentials": <Config extends OperationConfig>(serviceName: string, userId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCloudProjectServiceNameUserUserIdS3Credentials200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Create a new S3™* compatible storage credentials for an user
*/
readonly "postCloudProjectServiceNameUserUserIdS3Credentials": <Config extends OperationConfig>(serviceName: string, userId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof PostCloudProjectServiceNameUserUserIdS3Credentials200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
}

export interface StorageError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class StorageErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const StorageError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): StorageError<Tag, E> =>
  new StorageErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any