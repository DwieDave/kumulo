// POSIX single-quote escaping: wrap in single quotes, and close/escape/reopen
// for every embedded quote. Everything else is literal inside single quotes,
// so this is the whole rule — no shell metacharacter blacklist needed.
export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`
