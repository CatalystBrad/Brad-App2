import {RawDeal} from './types';

const FAMILY_KEYWORDS = [
  'family',
  'kids',
  'children',
  'child',
  'all inclusive',
  'all-inclusive',
  'family friendly',
  'water park',
  'waterpark',
  'splash',
  'kids club',
  "kid's club",
  'kids pool',
];

const NEGATIVE_KEYWORDS = [
  'adults only',
  'adult only',
  'adults-only',
  '18+',
  'over 18s',
  'over 21s',
  'couples only',
];

const SHORT_HAUL_COUNTRIES = new Set([
  'spain',
  'portugal',
  'greece',
  'turkey',
  'italy',
  'cyprus',
  'malta',
  'croatia',
  'bulgaria',
  'france',
  'austria',
  'germany',
  'netherlands',
  'ireland',
  'morocco',
  'tunisia',
  'czech republic',
  'czechia',
]);

const MID_HAUL_COUNTRIES = new Set([
  'egypt',
  'cape verde',
  'jordan',
  'israel',
  'uae',
  'united arab emirates',
  'dubai',
  'oman',
  'iceland',
  'canary islands',
  'madeira',
  'azores',
]);

const LONG_HAUL_COUNTRIES = new Set([
  'mexico',
  'dominican republic',
  'cuba',
  'jamaica',
  'barbados',
  'st lucia',
  'saint lucia',
  'antigua',
  'usa',
  'united states',
  'florida',
  'thailand',
  'vietnam',
  'maldives',
  'mauritius',
  'sri lanka',
  'south africa',
  'kenya',
  'tanzania',
  'australia',
  'japan',
  'china',
  'bali',
  'indonesia',
]);

export function estimateFlightHours(country?: string, destination?: string): number | undefined {
  const c = (country || destination || '').toLowerCase();
  if (!c) return undefined;
  for (const k of SHORT_HAUL_COUNTRIES) if (c.includes(k)) return 3;
  for (const k of MID_HAUL_COUNTRIES) if (c.includes(k)) return 5;
  for (const k of LONG_HAUL_COUNTRIES) if (c.includes(k)) return 9;
  return undefined;
}

export function scoreFamilyFriendliness(deal: RawDeal): number {
  const haystack = `${deal.title} ${deal.description ?? ''} ${deal.hotelName ?? ''}`.toLowerCase();

  let score = 0.5;

  for (const kw of FAMILY_KEYWORDS) {
    if (haystack.includes(kw)) {
      score += 0.08;
      break;
    }
  }
  if (haystack.includes('all inclusive') || haystack.includes('all-inclusive')) score += 0.1;
  if (haystack.includes('water park') || haystack.includes('waterpark')) score += 0.1;
  if (haystack.includes('kids club') || haystack.includes("kid's club")) score += 0.08;

  for (const kw of NEGATIVE_KEYWORDS) {
    if (haystack.includes(kw)) {
      score = 0;
      break;
    }
  }

  const hours = deal.estimatedFlightHours ?? estimateFlightHours(deal.country, deal.destination);
  if (hours !== undefined) {
    if (hours <= 4) score += 0.15;
    else if (hours <= 6) score += 0.05;
    else if (hours <= 8) score -= 0.05;
    else score -= 0.15;
  }

  if (deal.hotelRating && deal.hotelRating >= 4) score += 0.05;

  return Math.max(0, Math.min(1, score));
}
