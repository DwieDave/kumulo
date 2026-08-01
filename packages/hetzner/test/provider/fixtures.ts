// Fixtures decode through generated schemas that validate every required field, so each builder fills the boring ones and takes only the interesting ones.
export const meta = (nextPage: number | null = null) => ({
  pagination: { page: 1, per_page: 50, previous_page: null, next_page: nextPage, last_page: 1, total_entries: 1 }
})

const _created = "2026-01-01T00:00:00+00:00"

export const location = {
  id: 1,
  name: "fsn1",
  description: "Falkenstein DC Park 1",
  country: "DE",
  city: "Falkenstein",
  latitude: 50.476_12,
  longitude: 12.370_71,
  network_zone: "eu-central"
}

export const action = (
  { error = null, id, status = "success" }: {
    readonly id: number
    readonly status?: "running" | "success" | "error"
    readonly error?: { readonly code: string; readonly message: string } | null
  }
) => ({ id, command: "create_server", status, started: _created, finished: _created, progress: 100, resources: [], error })

export const image = ({ id, name }: { readonly id: number; readonly name: string }) => ({
  id,
  type: "system",
  status: "available",
  name,
  description: name,
  image_size: null,
  disk_size: 5,
  created: _created,
  created_from: null,
  bound_to: null,
  os_flavor: "ubuntu",
  os_version: "24.04",
  protection: { delete: false },
  deprecated: null,
  deleted: null,
  labels: {},
  architecture: "x86"
})

export const serverType = ({ id, name }: { readonly id: number; readonly name: string }) => ({
  id,
  name,
  description: name,
  cores: 2,
  memory: 4,
  disk: 40,
  deprecated: false,
  prices: [],
  storage_type: "local",
  cpu_type: "shared",
  architecture: "x86",
  locations: []
})

export const server = (
  { id, ip = "1.2.3.4", name, status = "running" }: {
    readonly id: number
    readonly name: string
    readonly status?: string
    readonly ip?: string | null
  }
) => ({
  id,
  name,
  status,
  created: _created,
  public_net: {
    ipv4: ip === null ? null : { ip, blocked: false, dns_ptr: "" },
    ipv6: null,
    floating_ips: []
  },
  private_net: [],
  server_type: serverType({ id: 1, name: "cx22" }),
  location,
  image: image({ id: 1, name: "ubuntu-24.04" }),
  iso: null,
  rescue_enabled: false,
  locked: false,
  backup_window: null,
  outgoing_traffic: null,
  ingoing_traffic: null,
  included_traffic: null,
  protection: { delete: false, rebuild: false },
  labels: {},
  primary_disk_size: 40
})

export const network = ({ id, name }: { readonly id: number; readonly name: string }) => ({
  id,
  name,
  ip_range: "10.0.0.0/24",
  subnets: [],
  routes: [],
  servers: [],
  protection: { delete: false },
  labels: {},
  created: _created,
  expose_routes_to_vswitch: false
})

export const firewall = ({ id, name }: { readonly id: number; readonly name: string }) => ({
  id,
  name,
  created: _created,
  rules: [],
  applied_to: []
})

export const placementGroup = ({ id, name }: { readonly id: number; readonly name: string }) => ({
  id,
  name,
  labels: {},
  type: "spread",
  created: _created,
  servers: []
})

export const loadBalancer = (
  { id, ip = "5.6.7.8", name }: { readonly id: number; readonly name: string; readonly ip?: string | null }
) => ({
  id,
  name,
  public_net: { enabled: true, ipv4: { ip, dns_ptr: null }, ipv6: { ip: null, dns_ptr: null } },
  private_net: [],
  location,
  load_balancer_type: {
    id: 1,
    name: "lb11",
    description: "LB11",
    max_connections: 10_000,
    max_services: 5,
    max_targets: 25,
    max_assigned_certificates: 10,
    deprecated: null,
    deprecation: null,
    prices: []
  },
  protection: { delete: false },
  labels: {},
  created: _created,
  services: [],
  targets: [],
  algorithm: { type: "round_robin" },
  outgoing_traffic: null,
  ingoing_traffic: null,
  included_traffic: 0
})

export const volume = ({ id, name, size }: { readonly id: number; readonly name: string; readonly size: number }) => ({
  id,
  created: _created,
  name,
  server: null,
  location,
  size,
  linux_device: `/dev/disk/by-id/scsi-0HC_Volume_${id}`,
  protection: { delete: false },
  labels: {},
  status: "available",
  format: null
})
