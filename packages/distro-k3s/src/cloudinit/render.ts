// FR-5.1 — minimal cloud-init: hostname, packages, SSH hardening only.
// Deliberately no k3s install here (that happens over SSH — bootstrap/install-script.ts).
export interface CloudInitArgs {
  readonly hostname: string
  readonly sshPublicKey: string
  readonly packages?: ReadonlyArray<string>
}

const DEFAULT_PACKAGES: ReadonlyArray<string> = ["curl", "open-iscsi"]

const _packagesYaml = (packages: ReadonlyArray<string>): string => packages.map((pkg) => `  - ${pkg}`).join("\n")

// kumulo: WHY prohibit-password/no-password-auth — matches hetzner-k3s's
// ssh/configure_ssh.sh hardening (key-only root login, no password fallback).
export const renderCloudInit = (args: CloudInitArgs): string => {
  const packages = args.packages ?? DEFAULT_PACKAGES
  return `#cloud-config
preserve_hostname: false
hostname: ${args.hostname}

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
