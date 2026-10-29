// No confirmed API exists yet for the CSI sub-account device-permission grant, so this degrades to a doctor-surfaced manual step.
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
