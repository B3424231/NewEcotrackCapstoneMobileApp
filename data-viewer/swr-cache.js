/**
 * SWR (Stale-While-Revalidate) Cache & State Manager
 * Provides instant cached-data rendering with background revalidation.
 * No blocking loaders, zero screen flash, and instant tab swapping.
 */

class SWRCacheManager {
  constructor() {
    this.memoryCache = new Map();
    this.inFlightRequests = new Map();
    this.subscribers = new Map();
    this.listeners = [];
    this.isRevalidating = false;

    // Load initial cache from sessionStorage / localStorage if available
    try {
      const persisted = localStorage.getItem('ecotrack_swr_cache');
      if (persisted) {
        const parsed = JSON.parse(persisted);
        Object.keys(parsed).forEach(k => {
          this.memoryCache.set(k, {
            data: parsed[k].data,
            timestamp: parsed[k].timestamp,
            version: parsed[k].version || 1,
          });
        });
      }
    } catch (e) {
      console.warn('LocalStorage not accessible for SWR persistence:', e);
    }
  }

  // Subscribe to revalidation activity changes (for non-blocking micro indicator)
  onActivityChange(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  _notifyActivity() {
    const active = this.inFlightRequests.size > 0;
    this.isRevalidating = active;
    this.listeners.forEach(fn => fn(active));
  }

  // Persist cache to localStorage
  _persist() {
    try {
      const obj = {};
      this.memoryCache.forEach((val, key) => {
        obj[key] = { data: val.data, timestamp: val.timestamp };
      });
      localStorage.setItem('ecotrack_swr_cache', JSON.stringify(obj));
    } catch (e) {
      // Safe fallback for quota or sandboxed environments
    }
  }

  /**
   * Main SWR Hook/Method
   * @param {string} key Unique cache key
   * @param {Function} fetcher Async function that returns fresh data
   * @param {Function} onUpdate Callback invoked when fresh revalidated data arrives
   * @param {Object} options Configuration options (dedupingInterval, forceFresh)
   * @returns {Object} { data, isStale, isValidating }
   */
  async execute(key, fetcher, onUpdate = null, options = {}) {
    const { dedupingInterval = 2000, forceFresh = false } = options;
    const now = Date.now();
    const cached = this.memoryCache.get(key);

    let initialData = cached ? cached.data : null;
    let isStale = Boolean(cached);
    let shouldFetch = true;

    // If cache is extremely fresh and not forced, skip background fetch
    if (cached && !forceFresh && (now - cached.timestamp < dedupingInterval)) {
      shouldFetch = false;
    }

    if (shouldFetch) {
      // Deduplicate concurrent requests for the exact same key
      if (!this.inFlightRequests.has(key)) {
        const promise = (async () => {
          try {
            this._notifyActivity();
            const freshData = await fetcher();
            
            // Update cache
            this.memoryCache.set(key, {
              data: freshData,
              timestamp: Date.now(),
            });
            this._persist();

            // Trigger in-place update if component callback is registered
            if (onUpdate && typeof onUpdate === 'function') {
              onUpdate(freshData, false);
            }

            return freshData;
          } catch (err) {
            console.error(`SWR revalidation failed for key [${key}]:`, err);
            throw err;
          } finally {
            this.inFlightRequests.delete(key);
            this._notifyActivity();
          }
        })();

        this.inFlightRequests.set(key, promise);
      } else {
        // Attach onUpdate to existing in-flight request
        if (onUpdate) {
          this.inFlightRequests.get(key).then(fresh => onUpdate(fresh, false)).catch(() => {});
        }
      }
    }

    // Return instant stale/cached representation immediately (0ms blocking time)
    return {
      data: initialData,
      isStale: isStale,
      isValidating: this.inFlightRequests.has(key),
    };
  }

  /**
   * Optimistically mutate cached data
   */
  mutate(key, newData, shouldRevalidate = false, fetcher = null, onUpdate = null) {
    this.memoryCache.set(key, {
      data: newData,
      timestamp: Date.now(),
    });
    this._persist();

    if (onUpdate) onUpdate(newData, false);

    if (shouldRevalidate && fetcher) {
      this.execute(key, fetcher, onUpdate, { forceFresh: true });
    }
  }

  /**
   * Read raw cached data synchronously without network call
   */
  getCached(key) {
    return this.memoryCache.get(key)?.data || null;
  }

  /**
   * Clear cache
   */
  clear() {
    this.memoryCache.clear();
    localStorage.removeItem('ecotrack_swr_cache');
  }
}

export const swr = new SWRCacheManager();
