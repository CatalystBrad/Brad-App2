import notifee, {AndroidImportance, AuthorizationStatus} from '@notifee/react-native';
import {Deal} from '../types';

const CHANNEL_ID = 'holiday-deals';

let initialised = false;

export async function ensureInit(): Promise<boolean> {
  if (initialised) return true;
  try {
    const settings = await notifee.requestPermission();
    if (settings.authorizationStatus === AuthorizationStatus.DENIED) {
      return false;
    }
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Holiday Deals',
      importance: AndroidImportance.DEFAULT,
      sound: 'default',
    });
    initialised = true;
    return true;
  } catch (err) {
    console.warn('notifee init failed', err);
    return false;
  }
}

function formatPrice(deal: Deal): string {
  if (!deal.pricePerPerson) return '';
  return ` — £${Math.round(deal.pricePerPerson)} pp`;
}

export async function notifyNewDeal(deal: Deal): Promise<void> {
  if (!(await ensureInit())) return;
  await notifee.displayNotification({
    id: `new-${deal.id}`,
    title: `New deal: ${deal.destination}${formatPrice(deal)}`,
    body: deal.title.slice(0, 140),
    data: {url: deal.url},
    android: {
      channelId: CHANNEL_ID,
      pressAction: {id: 'open-deal'},
      smallIcon: 'ic_launcher',
    },
    ios: {
      sound: 'default',
    },
  });
}

export async function notifyPriceDrop(
  deal: Deal,
  oldPrice: number,
  newPrice: number,
): Promise<void> {
  if (!(await ensureInit())) return;
  const pct = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
  await notifee.displayNotification({
    id: `drop-${deal.id}`,
    title: `Price drop: ${deal.destination} -${pct}%`,
    body: `${deal.title.slice(0, 100)} now £${Math.round(newPrice)} pp (was £${Math.round(oldPrice)})`,
    data: {url: deal.url},
    android: {
      channelId: CHANNEL_ID,
      pressAction: {id: 'open-deal'},
      smallIcon: 'ic_launcher',
    },
    ios: {
      sound: 'default',
    },
  });
}

export async function fireTestNotification(): Promise<void> {
  if (!(await ensureInit())) return;
  await notifee.displayNotification({
    title: 'Holiday Deals',
    body: 'Notifications are working. New deals will appear here.',
    android: {
      channelId: CHANNEL_ID,
      smallIcon: 'ic_launcher',
    },
  });
}
