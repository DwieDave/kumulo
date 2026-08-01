/**
 * R7/Q1: the CSI sub-account device-permission grant UpCloud's block-storage
 * CSI driver needs before a PV backed by a sub-account-created volume is
 * usable has no confirmed API (plan.md Q1, needs a live probe). Until that
 * probe lands, R7 degrades to this doctor-surfaced manual step instead of an
 * automated grant call — exported plainly (not as a `DoctorCheck`, a `cli`
 * package type this lower-level package must not depend on) for the CLI's
 * doctor module to wrap.
 */
export interface DoctorNote {
  readonly name: string
  readonly message: string
}

export const csiDevicePermissionNote: DoctorNote = {
  name: "upcloud-csi-device-permission",
  message:
    "UpCloud's block-storage CSI driver may need a device-permission grant for volumes created under a sub-account " +
    "before they can be attached. No confirmed API exists for this yet (kumulo tracks it as an open question) — " +
    "verify the grant manually in the UpCloud control panel if pods using kumulo-managed volumes fail to mount."
}
