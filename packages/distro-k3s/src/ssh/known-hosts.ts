import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

export type HostKeyCheck = "trusted" | "recorded" | "mismatch"

const _entryHost = (host: { readonly ip: string; readonly port: number }): string => `[${host.ip}]:${host.port}`

// first-use records the key, afterwards it must match
export const checkHostKey = (args: {
  readonly path: string
  readonly host: { readonly ip: string; readonly port: number }
  readonly key: Buffer
}): HostKeyCheck => {
  const name = _entryHost(args.host)
  const encoded = args.key.toString("base64")
  const lines = existsSync(args.path) ? readFileSync(args.path, "utf8").split("\n") : []
  const known = lines.map((line) => line.split(" ")).find((parts) => parts[0] === name)

  if (known) return known[1] === encoded ? "trusted" : "mismatch"

  mkdirSync(dirname(args.path), { recursive: true })
  appendFileSync(args.path, `${name} ${encoded}\n`, { mode: 0o600 })

  return "recorded"
}
