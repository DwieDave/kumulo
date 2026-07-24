import { Command, Flag } from "effect/unstable/cli"

const configFlag = Flag.string("config").pipe(
  Flag.withAlias("c"),
  Flag.withDescription("Path to the cluster YAML config")
)
const yesFlag = Flag.boolean("yes").pipe(
  Flag.withAlias("y"),
  Flag.withDescription("Skip the confirmation prompt")
)
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Print the plan without applying it")
)

/**
 * Root command; `--config`/`--yes`/`--dry-run` are shared by every
 * subcommand. Lives in its own module (not `commands.ts`) so subcommand
 * files can depend on it (`yield* kumulo`) without a circular import — a
 * subcommand must never redeclare its own `config`/`yes` flag, which the CLI
 * framework rejects as a parent/child name collision.
 */
export const kumulo = Command.make("kumulo").pipe(
  Command.withSharedFlags({ config: configFlag, yes: yesFlag, dryRun: dryRunFlag }),
  Command.withDescription("Provision and manage kumulo-managed Kubernetes clusters")
)
