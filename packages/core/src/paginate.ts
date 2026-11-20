import { Data, Effect, Equal } from "effect"

export class PaginationLimitExceeded extends Data.TaggedError("PaginationLimitExceeded")<{
  readonly maxPages: number
}> {}

export class PaginationStalled extends Data.TaggedError("PaginationStalled")<{
  readonly cursor: string
  readonly pages: number
}> {}

export type PaginationError = PaginationLimitExceeded | PaginationStalled

export interface PaginateOptions<Cursor, Page, Item, E, R> {
  readonly initial: Cursor
  readonly fetch: (cursor: Cursor) => Effect.Effect<Page, E, R>
  readonly items: (page: Page) => ReadonlyArray<Item>
  // undefined ends the walk; the same cursor twice in a row is a stalled error, never a silent stop
  readonly next: (args: { readonly page: Page; readonly cursor: Cursor; readonly items: ReadonlyArray<Item> }) => Cursor | undefined
  readonly maxPages: number
}

// Page-number, marker/cursor and offset styles all fit: the cursor is whatever fetch needs next.
export const paginate = <Cursor, Page, Item, E, R>(
  options: PaginateOptions<Cursor, Page, Item, E, R>
): Effect.Effect<ReadonlyArray<Item>, E | PaginationError, R> =>
  Effect.gen(function*() {
    const all: Array<Item> = []
    let cursor = options.initial

    for (let pages = 1; pages <= options.maxPages; pages++) {
      const page = yield* options.fetch(cursor)
      const items = options.items(page)
      all.push(...items)

      const next = options.next({ page, cursor, items })

      if (next === undefined) return all

      if (Equal.equals(next, cursor)) return yield* new PaginationStalled({ cursor: String(cursor), pages })

      cursor = next
    }

    return yield* new PaginationLimitExceeded({ maxPages: options.maxPages })
  })

// Common cursor styles over paginate: a short page ends the walk.
export const paginateByPage = <Page, Item, E, R>(
  options: {
    readonly fetch: (page: number) => Effect.Effect<Page, E, R>
    readonly items: (page: Page) => ReadonlyArray<Item>
    readonly perPage: number
    readonly maxPages: number
    readonly firstPage?: number
  }
): Effect.Effect<ReadonlyArray<Item>, E | PaginationError, R> =>
  paginate({
    initial: options.firstPage ?? 1,
    fetch: options.fetch,
    items: options.items,
    next: ({ cursor, items }) => items.length < options.perPage ? undefined : cursor + 1,
    maxPages: options.maxPages
  })

export const paginateByOffset = <Page, Item, E, R>(
  options: {
    readonly fetch: (offset: number) => Effect.Effect<Page, E, R>
    readonly items: (page: Page) => ReadonlyArray<Item>
    readonly limit: number
    readonly maxPages: number
  }
): Effect.Effect<ReadonlyArray<Item>, E | PaginationError, R> =>
  paginate({
    initial: 0,
    fetch: options.fetch,
    items: options.items,
    next: ({ cursor, items }) => items.length < options.limit || items.length === 0 ? undefined : cursor + items.length,
    maxPages: options.maxPages
  })
