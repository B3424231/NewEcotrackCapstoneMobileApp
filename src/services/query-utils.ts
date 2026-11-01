const cacheGenerations = new WeakMap<object, number>();
const referenceRows = new WeakMap<object, Map<string, { expires: number; rows: any[] }>>();
const metadataRows = new WeakMap<object, Map<string, string>>();
const metadataEvents = new WeakMap<object, Map<string, boolean>>();
const referenceTables = new Set(['rooms', 'floors', 'buildings']);
const observationFields = new Set(['updated', 'temp', 'temperature', 'rotation_rpm', 'rotation_quality', 'last_measurement_at', 'last_measurement_report_id', 'battery', 'rssi', 'status',
  'ip_address', 'wifi_ssid', 'last_seen', 'last_measurement_at', 'last_measurement_report_id', 'desired_state', 'reported_state', 'reported_at',
  'observed_remote_state', 'observed_remote_at', 'command_status', 'command_status_at', 'command_id', 'commanded_at']);
const fingerprint = (row: Record<string, any>) => JSON.stringify(Object.keys(row).sort().filter(key => !observationFields.has(key)).map(key => [key, row[key]]));

/** Clear on account changes and reference-table events; failed reads are never cached. */
export function invalidateReferenceRows(client: object, table?: string) {
  cacheGenerations.set(client, (cacheGenerations.get(client) || 0) + 1);
  if (!table) { referenceRows.delete(client); metadataRows.delete(client); metadataEvents.delete(client); return; }
  const cache = referenceRows.get(client);
  for (const key of cache?.keys() || []) if (key.startsWith(table + ':')) cache?.delete(key);
}

/** Ignore heartbeat-only row updates after an authenticated full metadata read. */
export function metadataChanged(client: object, table: string, payload: { eventType?: string; commit_timestamp?: string; new?: any; old?: any }): boolean {
  if (referenceTables.has(table)) { invalidateReferenceRows(client, table); return true; }
  const row = payload.new, id = row?.id || payload.old?.id;
  if (!id || payload.eventType === 'DELETE' || !row || Object.keys(row).length < 2) return true;
  const key = table + ':' + id, next = fingerprint(row);
  const eventKey = payload.commit_timestamp ? key + ':' + payload.commit_timestamp + ':' + next : null;
  let events = metadataEvents.get(client);
  if (!events) { events = new Map(); metadataEvents.set(client, events); }
  if (eventKey && events.has(eventKey)) return events.get(eventKey)!;
  // Only successful full reads advance the metadata snapshot. A failed refresh
  // must remain retryable, and all subscribers must see the same event verdict.
  const changed = metadataRows.get(client)?.get(key) !== next;
  if (eventKey) { events.set(eventKey, changed); if (events.size > 256) events.delete(events.keys().next().value!); }
  return changed;
}

/** Quote PostgREST filter values so punctuation cannot alter filter structure. */
export function filterLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function exactMatchFilter(columns: string[], value: string): string {
  return columns.map(column => `${column}.eq.${filterLiteral(value)}`).join(',');
}

/** Share identical reads only inside one refresh, never across sessions or clients. */
export interface ReadScope {
  run<T extends { error?: unknown }>(client: object, key: string | symbol, read: () => PromiseLike<T>): Promise<T>;
  recordError(error: unknown): void;
  assertSuccessful(): void;
}

/** Bound read-only work even when a transport never resolves; late results cannot commit. */
export function readWithTimeout<T>(read: (signal: AbortSignal) => PromiseLike<T>, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Data read timed out. Please try again.'));
      controller.abort();
    }, timeoutMs);
    Promise.resolve().then(() => read(controller.signal)).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function createReadScope(timeoutMs = 20000): ReadScope {
  const clients = new WeakMap<object, Map<string | symbol, Promise<any>>>();
  let failed = false;
  return {
    run(client, key, read) {
      let reads = clients.get(client);
      if (!reads) { reads = new Map(); clients.set(client, reads); }
      if (!reads.has(key)) reads.set(key, readWithTimeout(() => read(), timeoutMs).then(result => {
        if (result.error) failed = true;
        return result;
      }, error => { failed = true; throw error; }));
      return reads.get(key)!;
    },
    recordError(error) { if (error) failed = true; },
    assertSuccessful() { if (failed) throw new Error('Unable to refresh data. Please try again.'); },
  };
}

/** Read only RLS-visible rows, advancing by immutable ID instead of assuming a server row limit. */
export async function fetchAccessibleRows(client: { from(table: string): any }, table: string, columns = '*', filter?: (query: any) => any, scope?: ReadScope, filterKey?: string): Promise<{ data: any[] | null; error: any }> {
  if (scope) {
    const key = filter && filterKey === undefined ? Symbol(table) : `rows:${table}:${columns}:${filterKey ?? 'all'}`;
    return scope.run(client, key, () => fetchAccessibleRows(client, table, columns, filter));
  }
  const cacheKey = table + ':' + columns;
  const canCache = referenceTables.has(table) && !filter;
  const cached = canCache ? referenceRows.get(client)?.get(cacheKey) : undefined;
  if (cached && cached.expires > Date.now()) return {data: cached.rows, error: null};
  const rows: any[] = [];
  const generation = cacheGenerations.get(client) || 0;
  const finish = () => {
    if (generation !== (cacheGenerations.get(client) || 0)) return {data: rows, error: null};
    if (canCache) {
      let cache = referenceRows.get(client);
      if (!cache) { cache = new Map(); referenceRows.set(client, cache); }
      cache.set(cacheKey, {expires: Date.now() + 60000, rows});
    }
    if (columns === '*' && (table === 'nodes' || table === 'aircons')) {
      let metadata = metadataRows.get(client);
      if (!metadata) { metadata = new Map(); metadataRows.set(client, metadata); }
      for (const row of rows) if (row.id) metadata.set(table + ':' + row.id, fingerprint(row));
    }
    return {data: rows, error: null};
  };
  const seen = new Set<string>();
  let after: string | null = null;
  let total: number | null = null;
  try {
    for (;;) {
      let query = client.from(table).select(columns, { count: 'exact' }).order('id', { ascending: true }).limit(250);
      if (filter) query = filter(query);
      if (after !== null) query = query.gt('id', after);
      const { data, error, count } = await readWithTimeout<{ data: any[] | null; error: any; count?: number | null }>(signal =>
        typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query);
      if (error) return { data: null, error };
      if (!data?.length) return finish();
      // Count is RLS-filtered. Only the first page's count represents the full selection.
      if (after === null && typeof count === 'number' && Number.isInteger(count) && count >= data.length) total = count;
      for (const row of data) {
        if (typeof row.id !== 'string' || seen.has(row.id)) throw new Error('Pagination returned a repeated or missing ID.');
        seen.add(row.id);
        rows.push(row);
      }
      after = data[data.length - 1].id;
      if (total !== null && rows.length >= total) return finish();
    }
  } catch (error) { return { data: null, error }; }
}
