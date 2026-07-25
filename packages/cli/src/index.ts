/** @kumulo/cli — package barrel; `main.ts` is the executable entry (see "bin"). */
export const packageName = "@kumulo/cli"

export { kumulo, kumuloCli } from "./commands.ts"
export { loadConfig } from "./config.ts"
export { renderCliError } from "./errors.ts"
export { exitCodeFor } from "./exit-codes.ts"
