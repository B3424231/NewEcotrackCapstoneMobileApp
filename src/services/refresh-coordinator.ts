export interface RefreshCoordinator {
  refresh(): Promise<void>;
  schedule(): void;
  setActive(active: boolean): void;
  isActive(): boolean;
  dispose(): void;
}

type Lifecycle = {
  currentState?: string | null;
  addEventListener(event: 'change', listener: (state: string) => void): { remove(): void };
};

/** Serialize reads and coalesce background events into one fresh foreground read. */
export function createRefreshCoordinator(task: (isCurrent: () => boolean) => Promise<void>, delayMs = 150, lifecycle?: Lifecycle): RefreshCoordinator {
  let active: Promise<void> | null = null;
  let foreground = !lifecycle?.currentState || lifecycle.currentState === 'active';
  let pending = false, disposed = false, epoch = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (timer) { clearTimeout(timer); timer = null; }
    pending = true;
    if (!foreground) return Promise.resolve();
    if (active) return active;
    active = Promise.resolve().then(async () => {
      try {
        while (pending && foreground && !disposed) {
          pending = false;
          const started = epoch;
          await task(() => !disposed && foreground && started === epoch);
        }
      } finally { active = null; }
    });
    return active;
  };
  const setActive = (value: boolean) => {
    if (disposed || foreground === value) return;
    foreground = value; epoch++;
    if (timer) { clearTimeout(timer); timer = null; pending = true; }
    if (!value) { if (active) pending = true; return; }
    void refresh().catch(() => { /* The screen retains its snapshot and exposes retry. */ });
  };
  const listener = lifecycle?.addEventListener('change', state => setActive(state === 'active'));
  return {
    refresh, setActive, isActive: () => foreground && !disposed,
    schedule() {
      if (disposed) return;
      if (!foreground) { pending = true; return; }
      if (timer) return;
      timer = setTimeout(() => { timer = null; void refresh().catch(() => {}); }, delayMs);
    },
    dispose() {
      disposed = true; epoch++; pending = false;
      if (timer) clearTimeout(timer);
      timer = null; listener?.remove();
    },
  };
}
