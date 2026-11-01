import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

interface PageSnapshot<T> {
  key?: string;
  generation: number;
  data: T;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

// Memory only: successful empty responses are snapshots too.
const snapshots = new Map<string, { data: unknown; error: string | null }>();
let generation = 0;
let sessionAccount: string | null = null;
export function setSessionPageAccount(account: string | null) {
  if (account !== sessionAccount) { clearSessionPageSnapshots(); sessionAccount = account; }
}
export function clearSessionPageSnapshots() {
  snapshots.clear();
  generation += 1;
}

export function useSessionPageSnapshot<T>(key: string | undefined, initialData: () => T) {
  const currentGeneration = generation;
  const restore = (): PageSnapshot<T> => {
    const saved = key ? snapshots.get(key) : undefined;
    return { key, generation: currentGeneration, data: saved ? saved.data as T : initialData(),
      loaded: Boolean(saved), loading: Boolean(key) && !saved, error: saved?.error || null };
  };
  const [state, setState] = useState(restore);
  const matches = state.key === key && state.generation === currentGeneration;
  const snapshot = matches ? state : restore();
  if (!matches) setState(snapshot);
  const latest = useRef(snapshot);
  useEffect(() => { latest.current = snapshot; }, [snapshot]);

  const isCurrent = useCallback(() => generation === currentGeneration &&
    latest.current.key === key && latest.current.generation === currentGeneration, [key, currentGeneration]);
  const update = useCallback((change: (previous: PageSnapshot<T>) => PageSnapshot<T>) => {
    if (!isCurrent()) return;
    const next = change(latest.current);
    latest.current = next;
    if (key && next.loaded) snapshots.set(key, { data: next.data, error: next.error });
    setState(next);
  }, [isCurrent, key]);
  const setData = useCallback((value: SetStateAction<T>) => update(previous => ({ ...previous,
    data: typeof value === 'function' ? (value as (data: T) => T)(previous.data) : value,
  })), [update]);
  const commit = useCallback((value: SetStateAction<T>) => update(previous => ({ ...previous,
    data: typeof value === 'function' ? (value as (data: T) => T)(previous.data) : value,
    loaded: true, loading: false, error: null,
  })), [update]);
  const startLoading = useCallback(() => update(previous => ({ ...previous, loading: !previous.loaded })), [update]);
  const fail = useCallback((error: string) => update(previous => ({ ...previous, loading: false, error })), [update]);
  return { data: snapshot.data, hasSnapshot: snapshot.loaded, loading: snapshot.loading, error: snapshot.error,
    setData, commit, startLoading, fail, isCurrent };
}
