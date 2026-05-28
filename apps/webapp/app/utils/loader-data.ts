import type { TypedJsonResponse } from "remix-typedjson";

/**
 * Loaders that mix `return typedjson(data)` with `return redirect(...)` end up
 * with a return type of `TypedJsonResponse<X> | TypedResponse<never>`.
 * `useTypedLoaderData` can't narrow that union (its conditional doesn't
 * distribute) and returns the whole thing, breaking destructuring at every
 * call site.
 *
 * `LoaderData<typeof loader>` picks out only the `TypedJsonResponse` branch.
 * Distributes over unions, so it filters out the redirect branch automatically.
 */
type ExtractData<R> = R extends Response
  ? R extends TypedJsonResponse<infer U>
    ? U
    : never
  : R;

export type LoaderData<L> = L extends (...args: any[]) => Promise<infer R>
  ? ExtractData<R>
  : never;
