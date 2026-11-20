// No vendored capability endpoint for OVH MKS or UpCloud UKS, so both share one hand-kept list (minor-only).
export const SUPPORTED_KUBERNETES_VERSIONS: ReadonlySet<string> = new Set(["1.31", "1.32", "1.33", "1.34", "1.35"])
