import { Argument, Command, Flag } from "effect/unstable/cli"

/**
 * Positional cluster-config argument (yaml or json), declared per subcommand —
 * the CLI framework only shares flags, not positionals.
 */
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

/**
 * Root command; `--yes`/`--dry-run` are shared by every subcommand; the
 * config file is a per-subcommand positional argument. Lives in its own
 * module (not `commands.ts`) so subcommand files can depend on it
 * (`yield* kumulo`) without a circular import — a subcommand must never
 * redeclare its own `yes` flag, which the CLI framework rejects as a
 * parent/child name collision.
 */
export const kumulo = Command.make("kumulo").pipe(
  Command.withSharedFlags({ yes: yesFlag, dryRun: dryRunFlag, showEnv: showEnvFlag, secretsFile: secretsFileFlag }),
  Command.withDescription("Provision and manage kumulo-managed Kubernetes clusters")
)
