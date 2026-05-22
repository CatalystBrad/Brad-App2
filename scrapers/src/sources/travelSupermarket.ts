import {fetch} from 'undici';
import * as cheerio from 'cheerio';
import {RawDeal, ScrapeResult, ScrapeError} from '../types';
import {extractPrice, extractNights, extractStars, extractBoard, inferCountry, sleep} from '../util';
import {estimateFlightHours} from '../familyScore';

const BASE = 'https://www.travelsupermarket.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const PAGES = [
  '/holidays/deals',
  '/holidays/family',
  '/holidays/all-inclusive',
];

async function fetchPage(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function scrape(): Promise<ScrapeResult> {
  const deals: RawDeal[] = [];
  const errors: ScrapeError[] = [];
  const seen = new Set<string>();

  for (const page of PAGES) {
    const html = await fetchPage(page);
    if (!html) {
      errors.push({
        source: 'travelsuper',
        message: `${page} fetch failed`,
        at: new Date().toISOString(),
      });
      await sleep(1000);
      continue;
    }

    try {
      const $ = cheerio.load(html);

      $('article, [data-testid*="card"], [class*="card"], [class*="Card"]').each((_i, el) => {
        const $card = $(el);
        const text = $card.text().replace(/\s+/g, ' ').trim();
        if (!text) return;

        const price = extractPrice(text);
        if (!price || price < 80) return;

        const link =
          $card.find('a[href*="/holidays/"], a[href*="/deal"], a[href*="/hotel"]').first().attr('href') ||
          $card.find('a').first().attr('href');
        if (!link) return;

        const fullUrl = link.startsWith('http') ? link : `${BASE}${link}`;
        if (seen.has(fullUrl)) return;

        const title =
          $card.find('h1,h2,h3,h4').first().text().trim() ||
          $card.find('a').first().attr('title') ||
          text.split('£')[0].slice(0, 120).trim();
        if (!title || title.length < 6) return;

        seen.add(fullUrl);
        const haystack = `${title} ${text}`;
        const {country, destination} = inferCountry(haystack);
        const nights = extractNights(haystack);
        const stars = extractStars(haystack);
        const board = extractBoard(haystack);
        const flightHours = estimateFlightHours(country, destination);
        const img = $card.find('img').first().attr('src') ?? $card.find('img').first().attr('data-src');

        deals.push({
          source: 'travelsuper',
          title: title.slice(0, 160),
          destination: destination ?? country ?? 'Unknown',
          country,
          nights,
          boardType: board,
          hotelRating: stars,
          pricePerPerson: price,
          currency: 'GBP',
          url: fullUrl,
          imageUrl: img,
          description: text.slice(0, 300),
          estimatedFlightHours: flightHours,
        });
      });
    } catch (err) {
      errors.push({
        source: 'travelsuper',
        message: `${page} parse: ${(err as Error).message}`,
        at: new Date().toISOString(),
      });
    }

    await sleep(1200);
  }

  return {deals, errors};
}
