import { Match } from "effect"
import { ProviderApiError } from "@kumulo/core"
import type { DnsError } from "@kumulo/core"
import type { BunnyError } from "@kumulo/bunny"

export const toDnsError = (error: BunnyError): DnsError =>
  Match.value(error).pipe(
    Match.tag("CapabilityMissing", (missing) =>
      new ProviderApiError({ operation: missing.capability, status: 400, body: missing.workaround ?? missing.capability })),
    Match.orElse((other) => other)
  )
