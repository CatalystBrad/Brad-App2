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

export interface DealsFeed {
  generatedAt: string;
  count: number;
  deals: Deal[];
}

export type TravellerType = 'adult' | 'child' | 'infant';

export interface Traveller {
  id: string;
  label: string;
  type: TravellerType;
  age: number;
}

export interface TravelParty {
  travellers: Traveller[];
  countEighteenAsAdult: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  destinations: string[];
  departureAirports: string[];
  minNights: number;
  maxNights: number;
  maxPricePerPerson?: number;
  boardTypes: BoardType[];
  createdAt: number;
}

export interface PriceHistoryEntry {
  dealId: string;
  prices: Array<{price: number; at: number}>;
  lastNotifiedPrice?: number;
}

export type RootTabParamList = {
  Deals: undefined;
  Saved: undefined;
  Settings: undefined;
};

export type SavedStackParamList = {
  SavedList: undefined;
  SearchEditor: {searchId?: string};
};

export const DEFAULT_TRAVEL_PARTY: TravelParty = {
  travellers: [
    {id: 'adult-1', label: 'Adult 1', type: 'adult', age: 40},
    {id: 'adult-2', label: 'Adult 2', type: 'adult', age: 40},
    {id: 'child-18', label: '18 yo', type: 'adult', age: 18},
    {id: 'child-15', label: '15 yo', type: 'child', age: 15},
    {id: 'child-4', label: '4 yo', type: 'child', age: 4},
  ],
  countEighteenAsAdult: true,
};
