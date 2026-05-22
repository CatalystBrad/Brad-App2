import {fetch} from 'undici';
import {XMLParser} from 'fast-xml-parser';
import {RawDeal, ScrapeResult, ScrapeError} from '../types';
import {extractPrice, extractNights, extractStars, extractBoard, inferCountry} from '../util';
import {estimateFlightHours} from '../familyScore';

const FEEDS = [
  'https://www.holidaypirates.com/rss',
  'https://www.holidaypirates.com/category/all-inclusive/feed',
  'https://www.holidaypirates.com/category/family-holidays/feed',
];

const UA =
  'Mozilla/5.0 (compatible; BradHolidayApp/1.0; +https://github.com/catalystbrad/brad-app2)';

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  category?: string | string[];
  'media:thumbnail'?: {'@_url'?: string} | Array<{'@_url'?: string}>;
  'media:content'?: {'@_url'?: string} | Array<{'@_url'?: string}>;
  enclosure?: {'@_url'?: string};
}

function stripHtml(s?: string): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&pound;/g, '£')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractImage(item: RssItem): string | undefined {
  const mt = item['media:thumbnail'];
  if (Array.isArray(mt)) {
    const url = mt.find(x => x?.['@_url'])?.['@_url'];
    if (url) return url;
  } else if (mt?.['@_url']) {
    return mt['@_url'];
  }
  const mc = item['media:content'];
  if (Array.isArray(mc)) {
    const url = mc.find(x => x?.['@_url'])?.['@_url'];
    if (url) return url;
  } else if (mc?.['@_url']) {
    return mc['@_url'];
  }
  if (item.enclosure?.['@_url']) return item.enclosure['@_url'];
  // Last resort: grep an <img src> out of the description
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(item.description ?? '');
  return m?.[1];
}

function isHolidayDeal(item: RssItem): boolean {
  const text = `${item.title ?? ''} ${stripHtml(item.description)}`.toLowerCase();
  const isPackage =
    /\bnights?\b/.test(text) ||
    /flight/.test(text) ||
    /all[- ]?inclusive/.test(text) ||
    /hotel/.test(text);
  const isCity = /\bcity break\b/.test(text);
  return isPackage || isCity;
}

export async function scrape(): Promise<ScrapeResult> {
  const deals: RawDeal[] = [];
  const errors: ScrapeError[] = [];
  const parser = new XMLParser({ignoreAttributes: false});
  const seen = new Set<string>();

  for (const url of FEEDS) {
    try {
      const res = await fetch(url, {headers: {'User-Agent': UA}});
      if (!res.ok) {
        errors.push({
          source: 'pirates',
          message: `${url} HTTP ${res.status}`,
          at: new Date().toISOString(),
        });
        continue;
      }
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const items: RssItem[] = parsed?.rss?.channel?.item ?? [];

      for (const item of items) {
        const link = item.link;
        if (!link || seen.has(link)) continue;
        seen.add(link);
        if (!isHolidayDeal(item)) continue;

        const title = (item.title ?? '').trim();
        const description = stripHtml(item.description);
        const haystack = `${title} ${description}`;
        const {country, destination} = inferCountry(haystack);
        const price = extractPrice(haystack);
        const nights = extractNights(haystack);
        const stars = extractStars(haystack);
        const board = extractBoard(haystack);
        const flightHours = estimateFlightHours(country, destination);

        deals.push({
          source: 'pirates',
          title,
          destination: destination ?? country ?? 'Unknown',
          country,
          nights,
          boardType: board,
          hotelRating: stars,
          pricePerPerson: price,
          currency: 'GBP',
          url: link,
          imageUrl: extractImage(item),
          description: description.slice(0, 400),
          estimatedFlightHours: flightHours,
        });
      }
    } catch (err) {
      errors.push({
        source: 'pirates',
        message: `${url} ${(err as Error).message}`,
        at: new Date().toISOString(),
      });
    }
  }

  return {deals, errors};
}
