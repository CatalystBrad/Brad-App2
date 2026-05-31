# Woolacombe Bay Retreats

A responsive marketing & booking-enquiry website for holiday rentals in
Woolacombe, North Devon — **log cabins** and **caravans**.

## What's here

```
website/
├── index.html      # Single-page site (hero, stays, cabins, caravans, area, booking, footer)
├── css/styles.css  # All styling — coastal palette, fully responsive
└── js/main.js       # Property listings data, card rendering, mobile nav, booking form
```

## Features

- **Hero** with sea imagery and clear calls to action
- **Two stay types** — Log Cabins and Caravans, each with detailed listing cards
  (photos, sleeps, features, per-night pricing) generated from data in `js/main.js`
- **"The Area"** section highlighting Woolacombe Beach, surfing, the coast path and dog-friendly options
- **Booking enquiry form** with client-side validation (date checks, required fields).
  Clicking *Enquire* on a property pre-fills the form.
- Mobile-friendly navigation and layout throughout

## Run it

It's a static site — no build step. Open `website/index.html` in a browser, or serve it:

```bash
cd website
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Editing the listings

Cabins and caravans are defined as arrays at the top of `js/main.js`. Add, remove
or edit entries there — cards re-render automatically.

## Notes

- Photos are loaded from Unsplash via URL for the demo. Swap in your own images by
  changing the `img` fields in `js/main.js` and the background images in `css/styles.css`.
- The booking form is front-end only (it confirms receipt to the guest). To take real
  bookings, wire the form `submit` handler to an email service or booking backend.
- Contact details (phone, email) are placeholders — update them in `index.html`.
