import {DealsFeed} from '../types';
import {Storage} from '../utils/storage';

const FEED_URL =
  'https://raw.githubusercontent.com/CatalystBrad/Brad-App2/claude/holiday-daily-deals-L73tX/data/deals.json';

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6h

export interface FeedLoadResult {
  feed: DealsFeed | null;
  fromCache: boolean;
  fetchedAt: number | null;
  error?: string;
}

export async function fetchFeed(): Promise<DealsFeed | null> {
  try {
    const res = await fetch(FEED_URL, {
      headers: {Accept: 'application/json'},
    });
    if (!res.ok) {
      console.warn(`feed: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as DealsFeed;
    if (!json || !Array.isArray(json.deals)) {
      console.warn('feed: malformed payload');
      return null;
    }
    await Storage.saveFeed(json);
    return json;
  } catch (err) {
    console.warn('feed: fetch failed', err);
    return null;
  }
}

export async function loadFeed(force = false): Promise<FeedLoadResult> {
  const cached = await Storage.getFeed();
  const fetchedAt = await Storage.getFeedFetchedAt();
  const isStale = !fetchedAt || Date.now() - fetchedAt > STALE_AFTER_MS;

  if (!force && cached && !isStale) {
    return {feed: cached, fromCache: true, fetchedAt};
  }

  const fresh = await fetchFeed();
  if (fresh) {
    return {feed: fresh, fromCache: false, fetchedAt: Date.now()};
  }

  return {
    feed: cached,
    fromCache: true,
    fetchedAt,
    error: 'Could not refresh from server',
  };
}
