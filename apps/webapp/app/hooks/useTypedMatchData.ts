import { type UIMatch, useMatches } from "@remix-run/react";
import {
  type RemixSerializedType,
  type UseDataFunctionReturn,
  deserializeRemix,
} from "remix-typedjson";

type AppData = any;

function useTypedDataFromMatches<T = AppData>({
  id,
  matches,
}: {
  id: string;
  matches: UIMatch[];
}): UseDataFunctionReturn<T> | undefined {
  const match = matches.find((m) => m.id === id);
  return useTypedMatchData<T>(match);
}

export function useTypedMatchesData<T = AppData>({
  id,
  matches,
}: {
  id: string;
  matches?: UIMatch[];
}): UseDataFunctionReturn<T> | undefined {
  if (!matches) {
    matches = useMatches();
  }

  return useTypedDataFromMatches<T>({ id, matches });
}

export function useTypedMatchData<T = AppData>(
  match: UIMatch | undefined,
): UseDataFunctionReturn<T> | undefined {
  if (!match) {
    return undefined;
  }
  return deserializeRemix<T>(match.data as RemixSerializedType<T>) as
    | UseDataFunctionReturn<T>
    | undefined;
}
