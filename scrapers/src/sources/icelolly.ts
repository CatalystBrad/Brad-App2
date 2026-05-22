import {fetch} from 'undici';
import * as cheerio from 'cheerio';
import {RawDeal, ScrapeResult, ScrapeError, SearchCriteria} from '../types';
import {extractPrice, extractNights, extractStars, extractBoard, inferCountry} from '../util';
import {estimateFlightHours} from '../familyScore';
import {sleep} from '../util';

const BASE = 'https://www.icelolly.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// Public deal-listing pages. Icelolly's deeper search API requires browser
// state; these landing pages are server-rendered and safe to parse.
const LISTING_PAGES = [
  '/family-holidays',
  '/all-inclusive-holidays',
  '/cheap-holidays',
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

export async function scrape(_criteria: SearchCriteria): Promise<ScrapeResult> {
  const deals: RawDeal[] = [];
  const errors: ScrapeError[] = [];
  const seen = new Set<string>();

  for (const page of LISTING_PAGES) {
    const html = await fetchPage(page);
    if (!html) {
      errors.push({
        source: 'icelolly',
        message: `${page} fetch failed`,
        at: new Date().toISOString(),
      });
      await sleep(800);
      continue;
    }

    try {
      const $ = cheerio.load(html);
      // Icelolly uses several card patterns; collect any link to a /holiday/
      // or /deal/ slug with nearby price text.
      $('a').each((_i, el) => {
        const $a = $(el);
        const href = $a.attr('href');
        if (!href) return;
        const isDeal = /\/(holiday|deal|hotel|package)\//i.test(href);
        if (!isDeal) return;

        const fullUrl = href.startsWith('http') ? href : `${BASE}${href}`;
        if (seen.has(fullUrl)) return;

        const card = $a.closest('article,div,li').first();
        const cardText = (card.text() || $a.text() || '').replace(/\s+/g, ' ').trim();
        if (!cardText) return;

        const price = extractPrice(cardText);
        if (!price || price < 100) return; // skip nav links

        const title =
          $a.attr('title') ||
          card.find('h2,h3,h4').first().text().trim() ||
          $a.text().trim().split('\n')[0];
        if (!title) return;

        seen.add(fullUrl);
        const haystack = `${title} ${cardText}`;
        const {country, destination} = inferCountry(haystack);
        const nights = extractNights(haystack);
        const stars = extractStars(haystack);
        const board = extractBoard(haystack);
        const flightHours = estimateFlightHours(country, destination);
        const img =
          card.find('img').first().attr('src') ||
          card.find('img').first().attr('data-src');

        deals.push({
          source: 'icelolly',
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
          description: cardText.slice(0, 300),
          estimatedFlightHours: flightHours,
        });
      });
    } catch (err) {
      errors.push({
        source: 'icelolly',
        message: `${page} parse: ${(err as Error).message}`,
        at: new Date().toISOString(),
      });
    }

    await sleep(1200); // polite throttle
  }

  return {deals, errors};
}
