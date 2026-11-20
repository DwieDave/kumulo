import { Effect } from "effect"
import { paginate, PaginationLimitExceeded, PaginationStalled, ProviderApiError } from "@kumulo/core"
import type { BunnyError } from "../errors.ts"

const _maxPages = 1000

// Page-number walk over the shared paginate: an empty page ends the walk even if the server claims more.
export const bunnyPages = <Page, Item>(
  { fetch, hasMore, items, kind, ref }: {
    readonly kind: string
    readonly ref: string
    readonly fetch: (page: number) => Effect.Effect<Page, BunnyError>
    readonly items: (page: NoInfer<Page>) => ReadonlyArray<Item>
    readonly hasMore: (page: NoInfer<Page>) => boolean
  }
): Effect.Effect<ReadonlyArray<Item>, BunnyError> =>
  paginate({
    initial: 1,
    fetch,
    items,
    next: ({ cursor, items: pageItems, page }) => hasMore(page) && pageItems.length > 0 ? cursor + 1 : undefined,
    maxPages: _maxPages
  }).pipe(
    Effect.mapError((error) =>
      error instanceof PaginationLimitExceeded || error instanceof PaginationStalled
        ? new ProviderApiError({ operation: `${kind} ${ref}`, status: 0, body: `pagination failed: ${error.message || error.name}` })
        : error
    )
  )
