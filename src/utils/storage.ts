import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DealsFeed,
  PriceHistoryEntry,
  SavedSearch,
  TravelParty,
  DEFAULT_TRAVEL_PARTY,
} from '../types';

const K_FEED = '@deals.feed';
const K_FEED_FETCHED_AT = '@deals.feedFetchedAt';
const K_PARTY = '@party';
const K_SAVED_SEARCHES = '@savedSearches';
const K_PRICE_HISTORY = '@priceHistory';
const K_SETTINGS = '@settings';

export interface AppSettings {
  notifyOnNewDeal: boolean;
  notifyOnPriceDropPct: number;
  showLongHaul: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifyOnNewDeal: true,
  notifyOnPriceDropPct: 10,
  showLongHaul: true,
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`storage: ${key} read failed`, err);
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`storage: ${key} write failed`, err);
  }
}

export const Storage = {
  // Deals feed cache ------------------------------------------------------
  getFeed(): Promise<DealsFeed | null> {
    return readJson<DealsFeed | null>(K_FEED, null);
  },
  async saveFeed(feed: DealsFeed): Promise<void> {
    await writeJson(K_FEED, feed);
    await writeJson(K_FEED_FETCHED_AT, Date.now());
  },
  getFeedFetchedAt(): Promise<number | null> {
    return readJson<number | null>(K_FEED_FETCHED_AT, null);
  },

  // Travel party ----------------------------------------------------------
  getParty(): Promise<TravelParty> {
    return readJson<TravelParty>(K_PARTY, DEFAULT_TRAVEL_PARTY);
  },
  saveParty(party: TravelParty): Promise<void> {
    return writeJson(K_PARTY, party);
  },

  // Saved searches --------------------------------------------------------
  getSavedSearches(): Promise<SavedSearch[]> {
    return readJson<SavedSearch[]>(K_SAVED_SEARCHES, []);
  },
  async upsertSavedSearch(s: SavedSearch): Promise<void> {
    const all = await this.getSavedSearches();
    const i = all.findIndex(x => x.id === s.id);
    if (i >= 0) all[i] = s;
    else all.push(s);
    await writeJson(K_SAVED_SEARCHES, all);
  },
  async deleteSavedSearch(id: string): Promise<void> {
    const all = await this.getSavedSearches();
    await writeJson(K_SAVED_SEARCHES, all.filter(s => s.id !== id));
  },

  // Price history ---------------------------------------------------------
  getPriceHistory(): Promise<Record<string, PriceHistoryEntry>> {
    return readJson<Record<string, PriceHistoryEntry>>(K_PRICE_HISTORY, {});
  },
  savePriceHistory(history: Record<string, PriceHistoryEntry>): Promise<void> {
    return writeJson(K_PRICE_HISTORY, history);
  },

  // Settings --------------------------------------------------------------
  getSettings(): Promise<AppSettings> {
    return readJson<AppSettings>(K_SETTINGS, DEFAULT_SETTINGS);
  },
  saveSettings(s: AppSettings): Promise<void> {
    return writeJson(K_SETTINGS, s);
  },
};
