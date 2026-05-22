import BackgroundFetch from 'react-native-background-fetch';
import {fetchFeed} from './dealsFeed';
import {Storage} from '../utils/storage';
import {notifyNewDeal, notifyPriceDrop} from './notifications';
import {Deal, PriceHistoryEntry} from '../types';

async function reconcile(deals: Deal[]): Promise<void> {
  const settings = await Storage.getSettings();
  const history = await Storage.getPriceHistory();
  const previouslySeen = new Set(Object.keys(history));
  const now = Date.now();
  let notified = 0;

  for (const deal of deals) {
    const price = deal.pricePerPerson;
    const entry: PriceHistoryEntry = history[deal.id] ?? {
      dealId: deal.id,
      prices: [],
    };

    if (price != null) {
      entry.prices.push({price, at: now});
      if (entry.prices.length > 30) entry.prices = entry.prices.slice(-30);

      const previousLowest = entry.prices
        .slice(0, -1)
        .reduce<number | null>((min, p) => (min == null || p.price < min ? p.price : min), null);

      if (
        previousLowest != null &&
        previousLowest > price &&
        notified < 3 &&
        ((previousLowest - price) / previousLowest) * 100 >= settings.notifyOnPriceDropPct &&
        (entry.lastNotifiedPrice == null || price < entry.lastNotifiedPrice)
      ) {
        await notifyPriceDrop(deal, previousLowest, price);
        entry.lastNotifiedPrice = price;
        notified += 1;
      }
    }

    history[deal.id] = entry;
  }

  if (settings.notifyOnNewDeal) {
    const newOnes = deals
      .filter(d => !previouslySeen.has(d.id) && d.familyFriendlyScore >= 0.6)
      .sort((a, b) => (b.familyFriendlyScore ?? 0) - (a.familyFriendlyScore ?? 0))
      .slice(0, 2);
    for (const d of newOnes) {
      await notifyNewDeal(d);
    }
  }

  await Storage.savePriceHistory(history);
}

export async function runBackgroundRefresh(): Promise<void> {
  const feed = await fetchFeed();
  if (!feed) return;
  await reconcile(feed.deals);
}

export async function configureBackgroundFetch(): Promise<void> {
  try {
    await BackgroundFetch.configure(
      {
        minimumFetchInterval: 60 * 12, // request twice daily (minutes)
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
      },
      async taskId => {
        try {
          await runBackgroundRefresh();
        } finally {
          BackgroundFetch.finish(taskId);
        }
      },
      error => {
        console.warn('background-fetch configure error', error);
      },
    );
  } catch (err) {
    console.warn('background-fetch init failed', err);
  }
}
