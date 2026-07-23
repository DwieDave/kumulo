import { describe, expect, it } from "@effect/vitest"
import { FastCheck } from "effect/testing"
import type { ServerInstallArgs } from "../../src/bootstrap/install-script.ts"
import { renderAgentInstallScript, renderServerInstallScript } from "../../src/bootstrap/install-script.ts"

const serverArgsArb: FastCheck.Arbitrary<ServerInstallArgs> = FastCheck.record({
  k3sVersion: FastCheck.constant("v1.31.4+k3s1"),
  token: FastCheck.string({ minLength: 8, maxLength: 16 }),
  isFirstMaster: FastCheck.boolean(),
  firstMasterIp: FastCheck.constant("10.0.0.1"),
  privateIp: FastCheck.constant("10.0.0.2"),
  publicIp: FastCheck.constant("203.0.113.2"),
  tlsSans: FastCheck.constant(["10.0.0.1", "10.0.0.2", "cluster.example.com"]),
  addons: FastCheck.record({
    cloudControllerManager: FastCheck.boolean(),
    cni: FastCheck.constantFrom("flannel", "cilium")
  }),
  extraServerArgs: FastCheck.constant(["--kube-apiserver-arg=foo=bar"])
})

describe("renderServerInstallScript", () => {
  it.prop("is stable — same input renders byte-identical output", [serverArgsArb], ([args]) => {
    const first = renderServerInstallScript(args)
    const second = renderServerInstallScript(args)
    expect(first).toBe(second)
  })

  it("uses --cluster-init on the first master, --server join on others", () => {
    const base = {
      k3sVersion: "v1.31.4+k3s1",
      token: "tok",
      firstMasterIp: "10.0.0.1",
      privateIp: "10.0.0.2",
      publicIp: "203.0.113.2",
      tlsSans: ["10.0.0.1", "10.0.0.2"],
      addons: { cloudControllerManager: false, cni: "flannel" as const },
      extraServerArgs: []
    }
    expect(renderServerInstallScript({ ...base, isFirstMaster: true })).toContain("--cluster-init")
    expect(renderServerInstallScript({ ...base, isFirstMaster: false })).toContain("--server https://10.0.0.1:6443")
  })

  it("includes all TLS SANs plus 127.0.0.1 and disables the cloud controller by default", () => {
    const script = renderServerInstallScript({
      k3sVersion: "v1.31.4+k3s1",
      token: "tok",
      isFirstMaster: true,
      firstMasterIp: "10.0.0.1",
      privateIp: "10.0.0.1",
      publicIp: "203.0.113.1",
      tlsSans: ["10.0.0.1", "10.0.0.2", "203.0.113.100", "api.example.com"],
      addons: { cloudControllerManager: false, cni: "flannel" },
      extraServerArgs: []
    })
    expect(script).toContain("--tls-san=127.0.0.1")
    expect(script).toContain("--tls-san=10.0.0.2")
    expect(script).toContain("--tls-san=api.example.com")
    expect(script).toContain("--disable-cloud-controller")
  })

  it("disables flannel and network-policy when cni is cilium", () => {
    const script = renderServerInstallScript({
      k3sVersion: "v1.31.4+k3s1",
      token: "tok",
      isFirstMaster: true,
      firstMasterIp: "10.0.0.1",
      privateIp: "10.0.0.1",
      publicIp: "203.0.113.1",
      tlsSans: ["10.0.0.1"],
      addons: { cloudControllerManager: false, cni: "cilium" },
      extraServerArgs: []
    })
    expect(script).toContain("--flannel-backend=none")
    expect(script).toContain("--disable-network-policy")
  })
})

describe("renderAgentInstallScript", () => {
  it("joins via master 1 and passes labels/taints/extra args", () => {
    const script = renderAgentInstallScript({
      k3sVersion: "v1.31.4+k3s1",
      token: "tok",
      firstMasterIp: "10.0.0.1",
      privateIp: "10.0.0.5",
      publicIp: "203.0.113.5",
      nodeLabels: { pool: "workers" },
      nodeTaints: ["dedicated=gpu:NoSchedule"],
      extraAgentArgs: ["--kubelet-arg=foo=bar"]
    })
    expect(script).toContain('K3S_URL="https://10.0.0.1:6443"')
    expect(script).toContain('--node-label "pool=workers"')
    expect(script).toContain('--node-taint "dedicated=gpu:NoSchedule"')
    expect(script).toContain("--kubelet-arg=foo=bar")
  })
})
