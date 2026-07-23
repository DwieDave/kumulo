import type { KumuloError, KumuloErrorTag } from "./tagged.ts"

export type RendererRegistry = {
  readonly [Tag in KumuloErrorTag]: (error: Extract<KumuloError, { readonly _tag: Tag }>) => string
}

export const renderError = <Tag extends KumuloErrorTag>(args: {
  readonly registry: RendererRegistry
  readonly error: Extract<KumuloError, { readonly _tag: Tag }>
}): string => args.registry[args.error._tag](args.error)
