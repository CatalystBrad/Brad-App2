import {createHash} from 'node:crypto';

export function dealId(source: string, url: string): string {
  return createHash('sha1').update(`${source}::${url}`).digest('hex').slice(0, 16);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PRICE_RE = /£\s?([\d,]+(?:\.\d{2})?)/g;

export function extractPrice(text: string): number | undefined {
  PRICE_RE.lastIndex = 0;
  let lowest: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = PRICE_RE.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isNaN(n) && (lowest === undefined || n < lowest)) {
      lowest = n;
    }
  }
  return lowest;
}

const NIGHT_RE = /(\d{1,2})\s*night/i;
export function extractNights(text: string): number | undefined {
  const m = NIGHT_RE.exec(text);
  return m ? Number(m[1]) : undefined;
}

const STAR_RE = /(\d)\s*[-–]?\s*star/i;
export function extractStars(text: string): number | undefined {
  const m = STAR_RE.exec(text);
  return m ? Number(m[1]) : undefined;
}

const BOARD_MAP: Record<string, 'AI' | 'HB' | 'BB' | 'SC' | 'RO' | 'FB'> = {
  'all inclusive': 'AI',
  'all-inclusive': 'AI',
  'half board': 'HB',
  'bed and breakfast': 'BB',
  'bed & breakfast': 'BB',
  'b&b': 'BB',
  'self catering': 'SC',
  'self-catering': 'SC',
  'room only': 'RO',
  'full board': 'FB',
};

export function extractBoard(text: string): 'AI' | 'HB' | 'BB' | 'SC' | 'RO' | 'FB' | undefined {
  const lower = text.toLowerCase();
  for (const [k, v] of Object.entries(BOARD_MAP)) {
    if (lower.includes(k)) return v;
  }
  return undefined;
}

const COUNTRY_KEYWORDS: Array<[string, string]> = [
  ['canary', 'Canary Islands'],
  ['tenerife', 'Canary Islands'],
  ['lanzarote', 'Canary Islands'],
  ['gran canaria', 'Canary Islands'],
  ['fuerteventura', 'Canary Islands'],
  ['mallorca', 'Spain'],
  ['majorca', 'Spain'],
  ['ibiza', 'Spain'],
  ['menorca', 'Spain'],
  ['costa del sol', 'Spain'],
  ['costa brava', 'Spain'],
  ['benidorm', 'Spain'],
  ['barcelona', 'Spain'],
  ['madrid', 'Spain'],
  ['algarve', 'Portugal'],
  ['madeira', 'Portugal'],
  ['lisbon', 'Portugal'],
  ['porto', 'Portugal'],
  ['rhodes', 'Greece'],
  ['kos', 'Greece'],
  ['crete', 'Greece'],
  ['corfu', 'Greece'],
  ['zante', 'Greece'],
  ['santorini', 'Greece'],
  ['mykonos', 'Greece'],
  ['halkidiki', 'Greece'],
  ['antalya', 'Turkey'],
  ['marmaris', 'Turkey'],
  ['bodrum', 'Turkey'],
  ['side', 'Turkey'],
  ['icmeler', 'Turkey'],
  ['sharm', 'Egypt'],
  ['hurghada', 'Egypt'],
  ['marsa alam', 'Egypt'],
  ['dubai', 'UAE'],
  ['abu dhabi', 'UAE'],
  ['cancun', 'Mexico'],
  ['riviera maya', 'Mexico'],
  ['punta cana', 'Dominican Republic'],
  ['varadero', 'Cuba'],
  ['montego bay', 'Jamaica'],
  ['negril', 'Jamaica'],
  ['barbados', 'Barbados'],
  ['st lucia', 'Saint Lucia'],
  ['saint lucia', 'Saint Lucia'],
  ['antigua', 'Antigua'],
  ['florida', 'USA'],
  ['orlando', 'USA'],
  ['phuket', 'Thailand'],
  ['krabi', 'Thailand'],
  ['bali', 'Indonesia'],
  ['maldives', 'Maldives'],
  ['mauritius', 'Mauritius'],
  ['cape verde', 'Cape Verde'],
  ['sal,', 'Cape Verde'],
  ['boa vista', 'Cape Verde'],
  ['malta', 'Malta'],
  ['cyprus', 'Cyprus'],
  ['paphos', 'Cyprus'],
  ['ayia napa', 'Cyprus'],
  ['protaras', 'Cyprus'],
  ['croatia', 'Croatia'],
  ['dubrovnik', 'Croatia'],
  ['split', 'Croatia'],
  ['bulgaria', 'Bulgaria'],
  ['sunny beach', 'Bulgaria'],
];

export function inferCountry(text: string): {country?: string; destination?: string} {
  const lower = text.toLowerCase();
  for (const [needle, country] of COUNTRY_KEYWORDS) {
    if (lower.includes(needle)) {
      return {country, destination: needle.replace(/^./, c => c.toUpperCase())};
    }
  }
  return {};
}
