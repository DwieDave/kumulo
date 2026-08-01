import { Effect } from "effect"

// kumulo: hcloud list endpoints default to 25/page and don't auto-paginate — an unpaginated list silently truncates, orphaning billable servers
// on deleteByTag.
const PER_PAGE = 50

export interface PageQuery {
  readonly page: number
  readonly per_page: number
}

export interface PageMeta {
  readonly pagination: { readonly next_page: number | null }
}

export interface Page<A> {
  readonly items: ReadonlyArray<A>
  readonly meta: PageMeta
}

export type FetchPage<A, E, R> = (query: PageQuery) => Effect.Effect<Page<A>, E, R>

const _from = <A, E, R>(
  { acc, fetchPage, page }: { readonly fetchPage: FetchPage<A, E, R>; readonly page: number; readonly acc: ReadonlyArray<A> }
): Effect.Effect<ReadonlyArray<A>, E, R> =>
  fetchPage({ page, per_page: PER_PAGE }).pipe(
    Effect.flatMap(({ items, meta }) => {
      const all = [...acc, ...items]
      const next = meta.pagination.next_page
      return next === null ? Effect.succeed(all) : _from({ fetchPage, page: next, acc: all })
    })
  )

export const listAll = <A, E, R>(fetchPage: FetchPage<A, E, R>): Effect.Effect<ReadonlyArray<A>, E, R> =>
  _from({ fetchPage, page: 1, acc: [] })
