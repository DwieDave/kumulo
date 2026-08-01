import { Effect } from "effect"

// module-level state, single CLI process only
const _frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const _active = new Set<() => string>()
let _timer: ReturnType<typeof setInterval> | undefined
let _frame = 0
let _tick = 0

const _erase = "\r\x1b[2K"

type RowState = "static" | "pending" | "running" | "done"

interface ViewRow {
  readonly name: string
  readonly text: string
  state: RowState
}

let _rows: Array<ViewRow> = []
let _rowsOffset = 0
let _viewOn = false

const _rowPrefix = (state: RowState): string =>
  state === "running" ? `${_frames[_frame]} ` : state === "done" ? "\x1b[32m✓\x1b[0m " : "  "

// cursor-up math assumes plan rows don't wrap, track wrapped heights if that bites
const _renderRows = (): void => {
  let out = `\x1b[${_rows.length + _rowsOffset}A`
  for (const row of _rows) out += `${_erase}${_rowPrefix(row.state)}${row.text}\n`
  if (_rowsOffset > 0) out += `\x1b[${_rowsOffset}B\r`
  process.stdout.write(out)
}

const _renderLine = (): void => {
  process.stdout.write(`${_erase}${_frames[_frame]} ${[..._active].map((label) => label()).join(", ")}`)
}

const _render = (): void => {
  _tick += 1
  _frame = (_frame + 1) % _frames.length
  if (_viewOn) _renderRows()
  else _renderLine()
}

const _ensureTimer = (): void => {
  if (_timer === undefined) {
    process.stdout.write("\x1b[?25l")
    _timer = setInterval(_render, 80)
  }
}

const _releaseTimer = (): void => {
  if (_active.size === 0 && !_viewOn && _timer !== undefined) {
    clearInterval(_timer)
    _timer = undefined
    process.stdout.write("\x1b[?25h")
  }
}

const _start = (label: () => string): void => {
  _active.add(label)
  _ensureTimer()
}

const _stop = (label: () => string): void => {
  _active.delete(label)
  process.stdout.write(_erase)
  _releaseTimer()
}

const _ticksPerPhrase = 25

export const withSpinner = <A, E, R>(
  { effect, label }: { readonly label: string | ReadonlyArray<string>; readonly effect: Effect.Effect<A, E, R> }
): Effect.Effect<A, E, R> => {
  if (!process.stdout.isTTY) return effect
  const render = typeof label === "string"
    ? () => label
    : () => label[Math.floor(_tick / _ticksPerPhrase) % label.length] ?? ""
  return Effect.suspend(() => {
    _start(render)
    return effect
  }).pipe(Effect.ensuring(Effect.sync(() => _stop(render))))
}

export const withPlanView = <A, E, R>(
  { effect, offset, rows }: {
    readonly rows: ReadonlyArray<{ readonly name: string; readonly text: string; readonly active: boolean }>
    readonly offset: number
    readonly effect: Effect.Effect<A, E, R>
  }
): Effect.Effect<A, E, R> =>
  process.stdout.isTTY
    ? Effect.suspend(() => {
      _rows = rows.map((row) => ({ name: row.name, text: row.text, state: row.active ? "pending" : "static" }))
      _rowsOffset = offset
      _viewOn = true
      _ensureTimer()
      return effect
    }).pipe(Effect.ensuring(Effect.sync(() => {
      _renderRows()
      _viewOn = false
      _rows = []
      _releaseTimer()
    })))
    : effect

export const withRowProgress = <A, E, R>(
  { effect, match }: { readonly match: (name: string) => boolean; readonly effect: Effect.Effect<A, E, R> }
): Effect.Effect<A, E, R> =>
  process.stdout.isTTY
    ? Effect.suspend(() => {
      for (const row of _rows) if (row.state === "pending" && match(row.name)) row.state = "running"
      return effect
    }).pipe(Effect.tap(() =>
      Effect.sync(() => {
        for (const row of _rows) if (row.state === "running" && match(row.name)) row.state = "done"
      })
    ))
    : effect

export const logLine = (message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(`${process.stdout.isTTY ? _erase : ""}${message}\n`)
  })
