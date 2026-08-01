import { Argument, Command, Flag } from "effect/unstable/cli"

export const configArgument = (): Argument.Argument<string> => Argument.file("config", { mustExist: true })

const yesFlag = Flag.boolean("yes").pipe(
  Flag.withAlias("y"),
  Flag.withDescription("Skip the confirmation prompt")
)
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Print the plan without applying it")
)
const showEnvFlag = Flag.boolean("show-env").pipe(
  Flag.withDescription("Print the provider env-var summary before the plan")
)
const secretsFileFlag = Flag.optional(Flag.file("secrets-file").pipe(
  Flag.withDescription("Sops-encrypted YAML file of credential env vars (fallback: KUMULO_SECRETS_FILE)")
))

// subcommand must never redeclare its own `yes` flag (parent/child name collision)
export const kumulo = Command.make("kumulo").pipe(
  Command.withSharedFlags({ yes: yesFlag, dryRun: dryRunFlag, showEnv: showEnvFlag, secretsFile: secretsFileFlag }),
  Command.withDescription("Provision and manage kumulo-managed Kubernetes clusters")
)
