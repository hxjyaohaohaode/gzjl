import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

interface Draft<T> { value: T; version: number }
/** Sensitive editor values live only in this authenticated QueryClient. Account
 * changes clear the cache; nothing is persisted in browser storage. */
export function useWorkspaceDraft<T>({ identity, entity, version, initial }: { identity: string; entity: string; version: number; initial: T }) {
  const client = useQueryClient();
  const key = ["workspace-draft", identity, entity];
  useQuery<Draft<T> | null>({ queryKey: key, queryFn: () => null, initialData: null, enabled: false, gcTime: Infinity });
  // Controlled inputs need synchronous snapshots: the normal query notification
  // batch can otherwise restore a checkbox to its old value after a click.
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe((event) => {
    const eventKey = event.query.queryKey;
    if (eventKey[0] === "workspace-draft" && eventKey[1] === identity && eventKey[2] === entity) changed();
  }), [client, identity, entity]);
  const read = useCallback(() => client.getQueryData<Draft<T> | null>(["workspace-draft", identity, entity]) ?? null, [client, identity, entity]);
  const data = useSyncExternalStore(subscribe, read, () => null);
  const value = data?.value ?? initial;
  return {
    value, dirty: Boolean(data), conflict: Boolean(data && data.version !== version),
    setValue: (next: SetStateAction<T>) => {
      const current = client.getQueryData<Draft<T> | null>(key);
      const nextValue = typeof next === "function" ? (next as (previous: T) => T)(current?.value ?? initial) : next;
      client.setQueryData<Draft<T> | null>(key, () => JSON.stringify(nextValue) === JSON.stringify(initial) ? null : { value: nextValue, version: current?.version ?? version });
    },
    discard: () => client.setQueryData(key, null),
    saved: (submitted: T) => client.setQueryData<Draft<T> | null>(key, (current) =>
      current && JSON.stringify(current.value) !== JSON.stringify(submitted) ? current : null),
  };
}
