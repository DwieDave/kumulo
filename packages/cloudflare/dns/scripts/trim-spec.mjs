// Cut Cloudflare's full v4 OpenAPI spec (about 2400 paths) down to the operations
// this package calls plus every component they reference, so the vendored copy stays reviewable.
// Usage: node trim-spec.mjs <full-openapi.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs"

const [input, output] = process.argv.slice(2)

if (input === undefined || output === undefined) {
  console.error("usage: node trim-spec.mjs <full-openapi.json> <out.json>")
  process.exit(2)
}

const operations = [
  ["/zones", "get"],
  ["/zones/{zone_id}/dns_records", "get"],
  ["/zones/{zone_id}/dns_records", "post"],
  ["/zones/{zone_id}/dns_records/{dns_record_id}", "put"],
  ["/zones/{zone_id}/dns_records/{dns_record_id}", "delete"]
]

const full = JSON.parse(readFileSync(input, "utf8"))
const paths = {}

for (const [path, method] of operations) {
  const operation = full.paths?.[path]?.[method]

  if (operation === undefined) {
    console.error(`${method.toUpperCase()} ${path} is missing from ${input}`)
    process.exit(1)
  }

  paths[path] = { ...paths[path], [method]: operation }
}

const components = {}
const pending = [paths]
const seen = new Set()

const _refsIn = (node) => [...JSON.stringify(node).matchAll(/"\$ref":"(#\/components\/[^"]+)"/g)].map((match) => match[1])

while (pending.length > 0) {
  for (const ref of _refsIn(pending.pop())) {
    if (seen.has(ref)) continue

    seen.add(ref)
    const [, , section, name] = ref.split("/")
    const target = full.components?.[section]?.[name]

    if (target === undefined) {
      console.error(`unresolved reference ${ref}`)
      process.exit(1)
    }

    components[section] = { ...components[section], [name]: target }
    pending.push(target)
  }
}

const sorted = Object.fromEntries(
  Object.keys(components).toSorted().map((section) => [
    section,
    Object.fromEntries(Object.keys(components[section]).toSorted().map((name) => [name, components[section][name]]))
  ])
)

writeFileSync(
  output,
  JSON.stringify({ openapi: full.openapi, info: full.info, servers: full.servers, paths, components: sorted }, null, 2) + "\n"
)
