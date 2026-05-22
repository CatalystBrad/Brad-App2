export type BoardType = 'AI' | 'HB' | 'BB' | 'SC' | 'RO' | 'FB';
export type ScraperSource = 'pirates' | 'icelolly' | 'travelsuper';

export interface Deal {
  id: string;
  source: ScraperSource;
  title: string;
  destination: string;
  country?: string;
  departureAirport?: string;
  departureDate?: string;
  returnDate?: string;
  nights?: number;
  boardType?: BoardType;
  hotelName?: string;
  hotelRating?: number;
  pricePerPerson?: number;
  totalPrice?: number;
  currency: string;
  url: string;
  imageUrl?: string;
  description?: string;
  scrapedAt: string;
  familyFriendlyScore: number;
  estimatedFlightHours?: number;
}

export interface RawDeal extends Omit<Deal, 'id' | 'familyFriendlyScore' | 'scrapedAt'> {}

export interface ScrapeError {
  source: ScraperSource;
  message: string;
  at: string;
}

export interface ScrapeResult {
  deals: RawDeal[];
  errors: ScrapeError[];
}

export interface SearchCriteria {
  adults: number;
  children: number[];
  departures: string[];
  durationNights: [number, number];
  maxBudgetPerPerson?: number;
}

export const DEFAULT_CRITERIA: SearchCriteria = {
  adults: 3,
  children: [15, 4],
  departures: ['MAN'],
  durationNights: [5, 14],
};
