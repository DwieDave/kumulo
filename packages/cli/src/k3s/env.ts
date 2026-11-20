import { Layer } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import { makeSshLive } from "@kumulo/distro-k3s"
import type { Ssh } from "@kumulo/distro-k3s"
import type { AuthenticationFailed } from "@kumulo/core"
import type { VolumeProvider } from "@kumulo/core"
import type { ClusterConfig, K3sClusterConfig } from "../cluster-config.ts"
import { cinderVolumeProviderLive } from "@kumulo/volumes-cinder"
import type { VolumeProviderOptions , CinderAuth} from "@kumulo/volumes-cinder"
import { hetznerVolumeProviderLive } from "@kumulo/hetzner"
import { hcloudHttpClientLayer, providerFor } from "../provider/registry.ts"

// per-cluster known_hosts next to the cluster kubeconfig
export const k3sSshLayer = (args: { readonly configDir: string; readonly clusterName: string }): Layer.Layer<Ssh> =>
  makeSshLive({ knownHostsPath: `${args.configDir}/${args.clusterName}.known_hosts` })

export const secGroupRules = (config: K3sClusterConfig) => providerFor(config).secGroupRules(config)

export const k3sVolumeProviderLayer = (
  options: VolumeProviderOptions
): Layer.Layer<VolumeProvider, never, CinderAuth | HttpClient.HttpClient> => cinderVolumeProviderLive(options)

export const k3sHetznerVolumeProviderLayer = (
  config: ClusterConfig
): Layer.Layer<VolumeProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  hetznerVolumeProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(hcloudHttpClientLayer()))
