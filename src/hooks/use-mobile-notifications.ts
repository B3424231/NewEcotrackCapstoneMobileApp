import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionPageSnapshot } from '@/hooks/use-session-page-snapshot';
import { createRefreshCoordinator } from '@/services/refresh-coordinator';
import { readWithTimeout } from '@/services/query-utils';
import {
  MobileNotificationItem,
  applyMobileNotificationState,
  deduplicateMobileNotifications,
  fetchLiveMobileNotifications,
  getMobileNotificationStateRevision,
  isMobileNotificationStateUpdating,
  subscribeToMobileNotifications,
} from '@/services/mobile-notifications';

const emptyItems: MobileNotificationItem[] = [];

/** Keep the list and badges on the same recipient-state and reload rules. */
export function useMobileNotifications(accountKey?: string) {
  const { data: items, loading, error, setData, commit, startLoading, fail, isCurrent: isSessionCurrent } =
    useSessionPageSnapshot(accountKey ? `notifications:${accountKey}` : undefined, () => emptyItems);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(isMobileNotificationStateUpdating);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    if (!accountKey) {
      refreshRef.current = async () => {};
      return;
    }

    const coordinator = createRefreshCoordinator(async active => {
      if (disposed || !isSessionCurrent() || isMobileNotificationStateUpdating()) return;
      startLoading();
      const request = ++requestId;
      const revision = getMobileNotificationStateRevision();
      const isCurrent = () => active() && !disposed && isSessionCurrent() && request === requestId &&
        revision === getMobileNotificationStateRevision() && !isMobileNotificationStateUpdating();
      try {
        const next = deduplicateMobileNotifications(await readWithTimeout(() => fetchLiveMobileNotifications(), 20000));
        if (isCurrent()) { commit(next); setRefreshing(false); setUpdating(false); }
      } catch (error) {
        if (!isCurrent()) return;
        console.warn('Unable to load notifications:', error);
        // Keep the authenticated recipient-state snapshot when a refresh fails.
        fail('Unable to sync notifications. Please try again.');
        setRefreshing(false);
      }
    }, 150, AppState);
    const load = (showRefresh = false) => {
      if (showRefresh && isSessionCurrent()) setRefreshing(true);
      return coordinator.refresh();
    };

    refreshRef.current = () => load(true);
    const unsubscribe = subscribeToMobileNotifications(change => {
      if (disposed || !isSessionCurrent()) return;
      setUpdating(isMobileNotificationStateUpdating());
      if (change) setData(previous => applyMobileNotificationState(previous, change));
      else void load();
    });
    void load();

    return () => {
      disposed = true;
      coordinator.dispose();
      requestId++;
      refreshRef.current = async () => {};
      unsubscribe();
    };
  }, [accountKey, commit, fail, isSessionCurrent, setData, startLoading]);

  return { items, loading, refreshing, updating, error, refresh };
}
