import { Redacted } from "effect"
import type { BucketInfo, CredentialEntry, S3Credentials } from "@kumulo/core"

export const credentialEntries = (
  { cluster, creds, buckets, withRegion }: {
    readonly cluster: string
    readonly creds: S3Credentials
    readonly buckets: ReadonlyArray<BucketInfo>
    readonly withRegion: boolean
  }
): ReadonlyArray<CredentialEntry> => {
  if (creds.bucketCredentials !== undefined) {
    return [
      { key: "cluster", value: Redacted.make(cluster) },
      ...creds.bucketCredentials.flatMap((bucket, index) => [
        { key: `s3.buckets.${index}.name`, value: Redacted.make(bucket.name) },
        { key: `s3.buckets.${index}.region`, value: Redacted.make(bucket.region) },
        { key: `s3.buckets.${index}.endpoint`, value: Redacted.make(bucket.endpoint) },
        { key: `s3.buckets.${index}.accessKey`, value: bucket.accessKey },
        { key: `s3.buckets.${index}.secretKey`, value: bucket.secretKey }
      ])
    ]
  }

  return [
    { key: "cluster", value: Redacted.make(cluster) },
    { key: "s3.user", value: Redacted.make(creds.user) },
    { key: "s3.accessKey", value: creds.accessKey },
    { key: "s3.secretKey", value: creds.secretKey },
    ...buckets.flatMap((bucket, index) => [
      { key: `s3.buckets.${index}.name`, value: Redacted.make(bucket.name) },
      ...(withRegion ? [{ key: `s3.buckets.${index}.region`, value: Redacted.make(bucket.region) }] : []),
      { key: `s3.buckets.${index}.endpoint`, value: Redacted.make(bucket.endpoint) }
    ])
  ]
}
