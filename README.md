# Holiday Deals App

A React Native app that surfaces UK package-holiday deals for a family of 5
(2 adults + kids aged 18, 15, 4). A daily GitHub Actions cron scrapes public
deal sources, commits a JSON feed back to the repo, and the mobile app fetches
that feed on launch (plus best-effort background refreshes) and fires local
notifications when new family-friendly deals or price drops appear.

## Architecture

```
┌──────────────────────────┐     ┌────────────────────────┐
│ GitHub Actions (07:00 UTC)│ →  │ scrapers/ (Node, TS)   │
└──────────────────────────┘     │  ├─ HolidayPirates RSS │
                                 │  ├─ icelolly.com       │
                                 │  └─ TravelSupermarket  │
                                 └──────────┬─────────────┘
                                            │ writes
                                            ▼
                                  data/deals.json (committed)
                                            │ raw.githubusercontent.com
                                            ▼
                            ┌────────────────────────────┐
                            │  React Native app (src/)   │
                            │  ├─ Deals tab              │
                            │  ├─ Saved Searches tab     │
                            │  └─ Settings tab           │
                            │  • Notifee local notifs    │
                            │  • Background fetch (best  │
                            │    effort, twice daily)    │
                            └────────────────────────────┘
```

The GitHub Action is the source of truth. The on-device "background fetch" is
unreliable (especially on iOS) so it's only used to surface notifications
between launches — the day's deals always come from the workflow.

## Project layout

```
Brad-App2/
├── .github/workflows/
│   ├── build-android.yml      # Existing Android APK build
│   └── daily-deals.yml        # NEW — daily scraper cron
├── scrapers/                  # NEW — Node.js scraper service
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Orchestrator
│       ├── familyScore.ts     # Family-friendliness heuristic
│       ├── util.ts            # HTML/RSS extractors
│       ├── types.ts
│       └── sources/
│           ├── holidayPirates.ts
│           ├── icelolly.ts
│           └── travelSupermarket.ts
├── data/                      # NEW — generated each day
│   ├── deals.json
│   ├── scrape-errors.json
│   └── meta.json
├── src/
│   ├── App.tsx                # Bottom-tab navigator
│   ├── services/
│   │   ├── dealsFeed.ts       # Fetch + cache the JSON feed
│   │   ├── notifications.ts   # Notifee wrapper
│   │   └── backgroundFetch.ts # react-native-background-fetch
│   ├── screens/
│   │   ├── DealsScreen.tsx
│   │   ├── SavedSearchesScreen.tsx
│   │   ├── SearchEditorScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── types/index.ts
│   └── utils/storage.ts
└── index.js                   # Registers App + headless background task
```

## Running the scrapers locally

```bash
cd scrapers
npm install
npm run scrape
```

Output: `data/deals.json`, `data/scrape-errors.json`, `data/meta.json`.

## Triggering the daily scrape on GitHub

1. Push this branch to GitHub.
2. Open the **Actions** tab → "Daily Holiday Deals" → **Run workflow**.
3. The workflow commits an updated `data/deals.json` back to the branch.

## Running the app

```bash
npm install
npm run android       # or: npm run ios
```

First launch will request notification permission. The Deals tab shows the
latest feed (filterable). The Saved Searches tab stores criteria locally
(prioritisation by saved searches is a TODO; v1 uses the scrapers' defaults).
The Settings tab has notification controls, a manual refresh button, and a
test-notification button.

## Notes on scraping

- **HolidayPirates RSS** is the most reliable source and the primary signal.
- **icelolly** and **TravelSupermarket** are HTML-scraped via Cheerio.
  Any layout change will break them — wrapped in per-source try/catch so the
  rest of the feed still ships.
- The scrapers send a polite UA string and throttle to ~1 request/sec.
- No paid APIs.

## Family-of-5 defaults

- Travel party: 2 adults + ages 18, 15, 4.
- The 18-year-old counts as an adult (toggle in Settings → Travel party).
- Default departure: Manchester (MAN).
- No flight-time cap, but the family-friendliness heuristic mildly penalises
  long-haul so short-haul deals rank above long-haul at equivalent price.
