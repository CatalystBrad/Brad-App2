import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {Deal, ScrapeError, DEFAULT_CRITERIA} from './types';
import {dealId} from './util';
import {scoreFamilyFriendliness} from './familyScore';
import * as pirates from './sources/holidayPirates';
import * as icelolly from './sources/icelolly';
import * as travelsuper from './sources/travelSupermarket';

const OUT_DIR = join(__dirname, '..', '..', 'data');
const DEALS_PATH = join(OUT_DIR, 'deals.json');
const ERRORS_PATH = join(OUT_DIR, 'scrape-errors.json');
const META_PATH = join(OUT_DIR, 'meta.json');

interface FeedFile {
  generatedAt: string;
  count: number;
  criteria: typeof DEFAULT_CRITERIA;
  deals: Deal[];
}

async function run(): Promise<void> {
  const start = Date.now();
  const allDeals: Deal[] = [];
  const allErrors: ScrapeError[] = [];
  const now = new Date().toISOString();

  const sources: Array<{name: string; run: () => Promise<{deals: any[]; errors: ScrapeError[]}>}> = [
    {name: 'holidayPirates', run: () => pirates.scrape()},
    {name: 'icelolly', run: () => icelolly.scrape(DEFAULT_CRITERIA)},
    {name: 'travelSupermarket', run: () => travelsuper.scrape()},
  ];

  for (const src of sources) {
    console.log(`[scrape] ${src.name}…`);
    try {
      const result = await src.run();
      allErrors.push(...result.errors);
      for (const raw of result.deals) {
        const id = dealId(raw.source, raw.url);
        const familyFriendlyScore = scoreFamilyFriendliness(raw);
        allDeals.push({...raw, id, familyFriendlyScore, scrapedAt: now});
      }
      console.log(`[scrape] ${src.name}: ${result.deals.length} deals, ${result.errors.length} errors`);
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[scrape] ${src.name} FAILED: ${message}`);
      allErrors.push({source: 'pirates', message: `${src.name}: ${message}`, at: now});
    }
  }

  const dedup = new Map<string, Deal>();
  for (const d of allDeals) {
    const existing = dedup.get(d.id);
    if (!existing) {
      dedup.set(d.id, d);
    } else if ((d.pricePerPerson ?? Infinity) < (existing.pricePerPerson ?? Infinity)) {
      dedup.set(d.id, d);
    }
  }

  const deals = Array.from(dedup.values()).sort((a, b) => {
    const aScore =
      (a.familyFriendlyScore ?? 0) * 1000 - (a.pricePerPerson ?? 9999) / 10;
    const bScore =
      (b.familyFriendlyScore ?? 0) * 1000 - (b.pricePerPerson ?? 9999) / 10;
    return bScore - aScore;
  });

  await fs.mkdir(OUT_DIR, {recursive: true});

  const feed: FeedFile = {
    generatedAt: now,
    count: deals.length,
    criteria: DEFAULT_CRITERIA,
    deals,
  };
  await fs.writeFile(DEALS_PATH, JSON.stringify(feed, null, 2) + '\n', 'utf8');
  await fs.writeFile(ERRORS_PATH, JSON.stringify({generatedAt: now, errors: allErrors}, null, 2) + '\n', 'utf8');
  await fs.writeFile(
    META_PATH,
    JSON.stringify(
      {
        generatedAt: now,
        durationMs: Date.now() - start,
        sourceCounts: deals.reduce<Record<string, number>>((acc, d) => {
          acc[d.source] = (acc[d.source] ?? 0) + 1;
          return acc;
        }, {}),
        errorCount: allErrors.length,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`[scrape] done: ${deals.length} deals → ${DEALS_PATH}`);
  console.log(`[scrape] errors: ${allErrors.length} → ${ERRORS_PATH}`);
}

run().catch(err => {
  console.error('[scrape] fatal:', err);
  process.exit(1);
});
