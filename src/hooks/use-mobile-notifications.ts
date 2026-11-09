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
type Consumer = {
  isCurrent: () => boolean;
  startLoading: () => void;
  commit: (items: MobileNotificationItem[]) => void;
  fail: (message: string) => void;
  setData: (change: (items: MobileNotificationItem[]) => MobileNotificationItem[]) => void;
  setRefreshing: (value: boolean) => void;
  setUpdating: (value: boolean) => void;
};
type Feed = { consumers: Set<Consumer>; refresh: () => Promise<void>; dispose: () => void };
const feeds = new Map<string, Feed>();

/** One account owns one subscription and serialized read, shared by list and badge. */
function createFeed(accountKey: string): Feed {
  const consumers = new Set<Consumer>();
  let disposed = false;
  const currentConsumers = () => [...consumers].filter(consumer => consumer.isCurrent());
  const coordinator = createRefreshCoordinator(async active => {
    if (disposed || !currentConsumers().length || isMobileNotificationStateUpdating()) return;
    currentConsumers().forEach(consumer => consumer.startLoading());
    const revision = getMobileNotificationStateRevision();
    const isCurrent = () => !disposed && active() && feeds.get(accountKey) === feed &&
      revision === getMobileNotificationStateRevision() && !isMobileNotificationStateUpdating();
    try {
      const items = deduplicateMobileNotifications(await readWithTimeout(() => fetchLiveMobileNotifications(), 20000));
      if (isCurrent()) currentConsumers().forEach(consumer => {
        consumer.commit(items); consumer.setRefreshing(false); consumer.setUpdating(false);
      });
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('Unable to load notifications:', error);
      currentConsumers().forEach(consumer => {
        consumer.fail('Unable to sync notifications. Please try again.'); consumer.setRefreshing(false);
      });
    }
  }, 150, AppState);
  const unsubscribe = subscribeToMobileNotifications(change => {
    if (disposed || !currentConsumers().length) return;
    currentConsumers().forEach(consumer => {
      consumer.setUpdating(isMobileNotificationStateUpdating());
      if (change) consumer.setData(items => applyMobileNotificationState(items, change));
    });
    if (!change) void coordinator.refresh();
  });
  const feed: Feed = { consumers, refresh: () => coordinator.refresh(), dispose: () => {
    disposed = true; coordinator.dispose(); unsubscribe();
  } };
  return feed;
}

export function useMobileNotifications(accountKey?: string) {
  const { data: items, loading, error, setData, commit, startLoading, fail, isCurrent } =
    useSessionPageSnapshot(accountKey ? `notifications:${accountKey}` : undefined, () => emptyItems);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(isMobileNotificationStateUpdating);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    setRefreshing(false);
    setUpdating(isMobileNotificationStateUpdating());
    if (!accountKey) return;
    let feed = feeds.get(accountKey);
    // A new login to the same account must not join the previous session's read.
    if (feed && ![...feed.consumers].some(consumer => consumer.isCurrent())) {
      feed.dispose(); feeds.delete(accountKey); feed = undefined;
    }
    const created = !feed;
    if (!feed) { feed = createFeed(accountKey); feeds.set(accountKey, feed); }
    const consumer: Consumer = { isCurrent, setData, commit, startLoading, fail, setRefreshing, setUpdating };
    feed.consumers.add(consumer);
    const shared = feed;
    refreshRef.current = () => {
      if (!isCurrent()) return Promise.resolve();
      shared.consumers.forEach(member => { if (member.isCurrent()) member.setRefreshing(true); });
      return shared.refresh();
    };
    if (created) void shared.refresh();
    return () => {
      refreshRef.current = async () => {};
      shared.consumers.delete(consumer);
      if (!shared.consumers.size) {
        shared.dispose();
        if (feeds.get(accountKey) === shared) feeds.delete(accountKey);
      }
    };
  }, [accountKey, commit, fail, isCurrent, setData, startLoading]);

  return { items, loading, refreshing, updating, error, refresh };
}
