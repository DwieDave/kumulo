import { Argument, Command, Flag } from "effect/cli"

export const configArgument = (): Argument.Argument<string> => Argument.File("config", { mustExist: true })

const yesFlag = Flag.Boolean("yes").pipe(
  Flag.withAlias("y"),
  Flag.withDescription("Skip the confirmation prompt"),
  Flag.withDefault(false)
)

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print the plan without applying it"),
  Flag.withDefault(false)
)

const showEnvFlag = Flag.Boolean("show-env").pipe(
  Flag.withDescription("Print the provider env-var summary before the plan"),
  Flag.withDefault(false)
)

const secretsFileFlag = Flag.optional(Flag.File("secrets-file").pipe(
  Flag.withDescription("Sops-encrypted YAML file of credential env vars (fallback: KUMULO_SECRETS_FILE)")
))

// subcommand must never redeclare its own `yes` flag (parent/child name collision)
export const kumulo = Command.make("kumulo").pipe(
  Command.withSharedFlags({ yes: yesFlag, dryRun: dryRunFlag, showEnv: showEnvFlag, secretsFile: secretsFileFlag }),
  Command.withDescription("Provision and manage kumulo-managed Kubernetes clusters")
)
