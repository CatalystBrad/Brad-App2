# Homeowner intake — property information without the 20-page form

A working prototype of a different way to collect the Law Society **TA6 Property
Information Form** and **TA10 Fittings and Contents Form** from a seller: a few
questions at a time, on their phone, by magic link, WhatsApp, SMS or email, with
the paperwork chased separately and the finished forms handed to the conveyancer
with a full audit trail.

The problem it is built around: TA6 6th edition (2025) is **116 fields across 20
pages**, and answering it cold takes **about 110 minutes of sustained
concentration**. Nobody selling a house has that. So it sits on the kitchen table
for three weeks and the transaction stalls.

Built to be run by a conveyancing firm, or sold to several: every case belongs to
a firm, fee earners see only their own files, and the seller sees their
solicitor's name on every message.

## What it does differently

| | Paper / PDF today | This |
|---|---|---|
| Unit of work | The whole form, one sitting | 1–5 questions, or a 5-minute slot |
| Where | Kitchen table, printer, scanner | Phone, wherever they are |
| Questions asked | All 116, whether relevant or not | ~65 for a typical house — the rest skipped by conditional logic |
| Questions we already know | Asked anyway | Pre-filled from public data, confirmed with one tap |
| Cadence | However often the solicitor chases | Seller picks: how many, how often, what time, which channel |
| "I don't know" | Blank box, form returns | Explicit *not known* / *I'll check* that comes back round |
| Paperwork | Bundled with the questions, blocks everything | A separate photo-a-day track |
| Being ignored | Chase harder | Slow down, change channel, then hand to a human |
| Evidence trail | A signed PDF | Every answer, who gave it, when, on which channel |
| Fittings list (TA10) | 90 tick boxes on paper | 11 room-by-room screens, ~14 minutes |

## Try it

Requires Node 22.5+. No dependencies to install.

```bash
cd homeowner-intake

# The seller journey printed as a WhatsApp conversation
node --experimental-sqlite scripts/demo.js

# A firm with six realistic files, for the conveyancer dashboard
node --experimental-sqlite scripts/seed.js        # prints a staff key
DB_PATH=seed.db node --experimental-sqlite src/server.js
#   seller's app:  the magic link printed when a case is created
#   dashboard:     http://localhost:8787/staff  (paste the staff key)

node --experimental-sqlite --test test/*.test.js  # 118 tests
```

Without provider credentials every channel runs dry — messages are recorded
rather than sent — so the whole flow is demonstrable offline.

### Creating a case by hand

```bash
# 1. Bootstrap a firm (returns a staff key, shown once)
curl -s -X POST localhost:8787/api/firms \
  -H 'authorization: Bearer dev-admin-key' -H 'content-type: application/json' \
  -d '{"name":"Hardcastle & Byrne","brand":{"colour":"#0F6E5C","signOff":"Rachel Byrne"},
       "admin":{"email":"rachel@example.test","name":"Rachel Byrne"}}'

# 2. Open a case as that firm (returns the seller's magic link)
curl -s -X POST localhost:8787/api/cases \
  -H 'authorization: Bearer hi_…' -H 'content-type: application/json' \
  -d '{"ref":"HB/2026/0101","address":"12 Example Street, Leeds","postcode":"LS1 1AA",
       "forms":["ta6","ta10"],
       "seller":{"name":"Sam Okafor","phone":"447700900123","email":"sam@example.test"},
       "plan":{"mode":"count","size":3},
       "cadence":{"channel":"whatsapp","frequency":"daily","window":{"start":"18:00","end":"21:00"}}}'
```

## How it is put together

```
data/ta6-questions.json    TA6 as data: 116 questions, conditional logic,
                           evidence requests, effort estimates, prefill sources
data/ta10-questions.json   TA10 as 11 room-by-room checklists covering 69 fittings
src/questions.js           Which questions apply, given the answers and the forms
src/batching.js            The drip engine: what to ask in this session
src/scheduler.js           When to ask: cadence, quiet hours, DST, backoff, escalation
src/store.js               Firms, staff, cases, answers, audit trail, sign-off
src/magiclink.js           HMAC tokens, hashed at rest, expiry and revocation
src/prefill.js             Public data sources, each stubbed with the real API named
src/channels/replies.js    How a reply is understood, whatever channel it came on
src/channels/whatsapp.js   Cloud API: interactive messages, templates, inbound parsing
src/channels/sms.js        Numbered options, GSM-7 safe, two segments maximum
src/channels/email.js      Digest with a magic link — email is not a conversation
src/channels/index.js      The registry and the dispatcher
src/conversation.js        Channel-agnostic orchestration + the nudge worker
src/export/ta6.js          Back to forms a conveyancer recognises, plus a chase list
src/server.js              HTTP API, magic links, webhooks, staff auth
public/                    The seller's app
public/staff/              The conveyancer's dashboard
```

Two rules hold it together. **One question bank, many channels** — a seller can
tap an answer in WhatsApp on the bus, upload the boiler certificate from the
kitchen, and sign off on a laptop; it is one form throughout. And **channel
differences live in `src/channels/`, never in the orchestration** — adding a
channel means implementing six functions, not touching the flow.

## Multi-tenancy

- Every case belongs to a firm. `GET /api/cases` is always scoped to the caller's
  firm, and a case belonging to another firm returns **404, not 403** — a 403
  would confirm the reference exists.
- Staff authenticate with a bearer key, hashed at rest like a password and shown
  exactly once. Only an admin can mint more.
- Per-firm branding (name, colour, from-name, sign-off) reaches the seller on
  every channel: the WhatsApp invite, the SMS, the email header.
- A firm can send WhatsApp from its own number (`firms.wa_phone_id`) or share the
  platform number.

## What is real and what is stubbed

**Real and tested:** the question banks and conditional logic; batching by count
or time budget; cadence, quiet hours, BST/GMT, backoff and cross-channel
escalation; magic links; the answer store and audit trail; WhatsApp, SMS and
email rendering within each platform's limits; inbound parsing for WhatsApp and
Twilio-style SMS; the conversation flow; multi-seller sign-off; multi-tenancy and
staff auth; the exports and chase list; the seller's app and the dashboard.

**Stubbed, with the real source named in the code:** the prefill providers
(`src/prefill.js` — HM Land Registry, EPC register, Environment Agency flood
data, Historic England, Ofcom, water company lookup) and the outbound send for
each channel — every `createSender` posts to the real provider when given
credentials and records when not.

**Not built:** TA7 (leasehold), inbound email handling, and staff login sessions
(fee earners paste a bearer key - see `docs/DEPLOY.md` for what to do before a
firm relies on that).

## Before this goes near a real seller

- **Licensing.** TA6 and TA10 are © The Law Society. Reproducing them in a
  product needs a licence, and a licence for resale to other firms is a different
  conversation from one for internal use. See `docs/COMPLIANCE.md`.
- **Nine question wordings were reconstructed**, not extracted, because those
  parts of the source PDF did not yield text. They are marked `"verify": true` in
  the question bank and listed in `docs/VERIFY.md`. Check each against the
  official form.
- **In production the server refuses to start** with a placeholder
  `LINK_SECRET` or `ADMIN_KEY`, a plain-http `BASE_URL`, or an in-memory
  database - and says which. `docs/DEPLOY.md` has the ten-minute path to a
  live https URL on Fly.io, and the Docker route for anywhere else.

## Documentation

| | |
|---|---|
| `docs/DEPLOY.md` | Ten minutes to a live URL: env vars, Fly.io, Docker, backups, first-run checklist |
| `docs/PROCESS.md` | The process design and the reasoning behind it |
| `docs/WHATSAPP.md` | Go-live pack: the four templates, setup runbook, test checklist |
| `docs/COMPLIANCE.md` | Licensing, UK GDPR, e-signatures, messaging rules, security |
| `docs/VERIFY.md` | The nine reconstructed wordings to check |
