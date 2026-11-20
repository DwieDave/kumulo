// Minimal cloud-init: hostname, packages, SSH hardening only.
// Deliberately no k3s install here (that happens over SSH — bootstrap/install-script.ts).
export interface CloudInitArgs {
  readonly hostname: string
  readonly sshPublicKey: string
  readonly packages?: ReadonlyArray<string>
}

// kumulo: must match the user the SSH layer connects as (ssh/live.ts)
export const SSH_USER = "root"

const DEFAULT_PACKAGES: ReadonlyArray<string> = ["curl", "open-iscsi"]

const _packagesYaml = (packages: ReadonlyArray<string>): string => packages.map((pkg) => `  - ${pkg}`).join("\n")

// kumulo: WHY prohibit-password/no-password-auth — key-only root login,
// no password fallback.
export const renderCloudInit = (args: CloudInitArgs): string => {
  const packages = args.packages ?? DEFAULT_PACKAGES

  return `#cloud-config
preserve_hostname: false
hostname: ${args.hostname}

users:
  - name: ${SSH_USER}
    ssh_authorized_keys:
      - ${args.sshPublicKey}

packages:
${_packagesYaml(packages)}

write_files:
  - path: /etc/ssh/sshd_config.d/60-kumulo.conf
    content: |
      PasswordAuthentication no
      PermitRootLogin prohibit-password

runcmd:
  - systemctl restart ssh || systemctl restart sshd
`
}
