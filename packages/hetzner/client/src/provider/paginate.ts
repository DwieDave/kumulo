import { Effect } from "effect"
import { paginate, PaginationLimitExceeded, PaginationStalled, ProviderApiError } from "@kumulo/core"
import type { PaginationError } from "@kumulo/core"

// kumulo: hcloud list endpoints default to 25/page and don't auto-paginate — an unpaginated list silently truncates, orphaning billable servers
// on deleteByTag.
const PER_PAGE = 50
const MAX_PAGES = 1000

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

const _pagingError = <E>(error: E | PaginationError): E | ProviderApiError => {
  if (error instanceof PaginationLimitExceeded) {
    return new ProviderApiError({ operation: "hcloud list", status: 0, body: `pagination exceeded ${error.maxPages} pages` })
  }

  if (error instanceof PaginationStalled) {
    return new ProviderApiError({ operation: "hcloud list", status: 0, body: `pagination stalled at page ${error.cursor}` })
  }

  return error
}

export const listAll = <A, E, R>(
  fetchPage: FetchPage<A, E, R>
): Effect.Effect<ReadonlyArray<A>, E | ProviderApiError, R> =>
  paginate({
    initial: 1,
    fetch: (page) => fetchPage({ page, per_page: PER_PAGE }),
    items: (page) => page.items,
    next: ({ page }) => page.meta.pagination.next_page ?? undefined,
    maxPages: MAX_PAGES
  }).pipe(Effect.mapError(_pagingError))
