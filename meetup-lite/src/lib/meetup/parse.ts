import { parse } from "node-html-parser";

export type ApolloState = Record<string, Record<string, unknown>>;

export interface NextDataPayload {
  pageProps: Record<string, unknown>;
  apolloState: ApolloState;
}

export function extractNextData(html: string): NextDataPayload | null {
  const root = parse(html);
  const node = root.querySelector("script#__NEXT_DATA__");
  if (!node) return tryApolloFallback(html);

  try {
    const json = JSON.parse(node.text) as {
      props?: {
        pageProps?: Record<string, unknown>;
        apolloState?: ApolloState;
      };
    };
    const pageProps = json.props?.pageProps ?? {};
    const apolloState =
      json.props?.apolloState ??
      (pageProps.__APOLLO_STATE__ as ApolloState | undefined) ??
      (pageProps.apolloState as ApolloState | undefined) ??
      {};
    return { pageProps, apolloState };
  } catch {
    return tryApolloFallback(html);
  }
}

function tryApolloFallback(html: string): NextDataPayload | null {
  const match = html.match(
    /window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
  );
  if (!match) return null;
  try {
    const apolloState = JSON.parse(match[1]) as ApolloState;
    return { pageProps: {}, apolloState };
  } catch {
    return null;
  }
}

export function findByTypename<T extends Record<string, unknown>>(
  apolloState: ApolloState,
  typename: string,
): T[] {
  const results: T[] = [];
  for (const value of Object.values(apolloState)) {
    if (value && typeof value === "object" && value.__typename === typename) {
      results.push(value as T);
    }
  }
  return results;
}

export function getString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

export function getNumber(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Apollo references look like { __ref: "Event:12345" }. Resolve to the cache entry.
 */
export function deref(
  apolloState: ApolloState,
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const ref = (value as Record<string, unknown>).__ref;
  if (typeof ref !== "string") return null;
  return apolloState[ref] ?? null;
}
