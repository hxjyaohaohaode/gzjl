import { useState, type SetStateAction } from "react";

/** Preserve edited fields when a live query receives a newer version. */
export function useVersionedDraft<T>(version: number, value: T) {
  const [state, setState] = useState(() => ({ version, baseline: value, value }));
  const dirty = JSON.stringify(state.value) !== JSON.stringify(state.baseline);
  // React permits synchronizing this component's own state during render. This
  // avoids a paint with stale fields, without resetting an in-progress draft.
  if (version > state.version && !dirty) {
    setState({ version, baseline: value, value });
  }
  return {
    value: state.value,
    version: state.version,
    dirty,
    conflict: version > state.version && dirty,
    setValue: (next: SetStateAction<T>) => setState((current) => ({
      ...current,
      value: typeof next === "function" ? (next as (previous: T) => T)(current.value) : next,
    })),
    acceptLatest: () => setState({ version, baseline: value, value }),
    saved: (savedVersion: number, savedValue: T) => setState({ version: savedVersion, baseline: savedValue, value: savedValue }),
  };
}
