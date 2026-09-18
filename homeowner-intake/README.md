# Homeowner intake — property information without the 20-page form

A working prototype of a different way to collect the Law Society **TA6 Property
Information Form** from a seller: a few questions at a time, on their phone, by
magic link or WhatsApp, with the paperwork chased separately and the finished
form handed to the conveyancer with a full audit trail.

The problem it is built around: TA6 6th edition (2025) is **116 fields across 20
pages**, and answering it cold takes **about 110 minutes of sustained
concentration**. Nobody selling a house has that. So it sits on the kitchen
table for three weeks and the transaction stalls.

## What it does differently

| | Paper / PDF today | This |
|---|---|---|
| Unit of work | The whole form, one sitting | 1–5 questions, or a 5-minute slot |
| Where | Kitchen table, printer, scanner | Phone, wherever they are |
| Questions asked | All 116, whether relevant or not | ~65 for a typical house — the rest are skipped by conditional logic |
| Questions we already know | Asked anyway | Pre-filled from public data, confirmed with one tap |
| Cadence | However often the solicitor chases | Seller picks: how many, how often, what time of day, which channel |
| "I don't know" | Blank box, form returns | Explicit *not known* / *I'll check* that comes back round |
| Paperwork | Bundled with the questions, blocks everything | A separate photo-a-day track |
| Evidence trail | A signed PDF | Every answer, who gave it, when, on which channel |

## Try it

Requires Node 22.5+. No dependencies to install.

```bash
cd homeowner-intake

# The whole journey printed as a WhatsApp conversation
node --experimental-sqlite scripts/demo.js

# The web app
node --experimental-sqlite src/server.js
# then create a case and open the magic link it returns:
curl -s -X POST http://localhost:8787/api/cases -H 'content-type: application/json' \
  -d '{"address":"12 Example Street, Leeds","postcode":"LS1 1AA","firm":"Catalyst",
       "seller":{"name":"Sam Okafor","phone":"447700900123"},"plan":{"mode":"count","size":3}}'

node --experimental-sqlite --test test/*.test.js     # 88 tests
```

Without `WA_TOKEN` set, the WhatsApp sender runs in dry-run mode: every message
is recorded rather than sent, so the whole flow is demonstrable offline.

## How it is put together

```
data/ta6-questions.json   The form as data: 116 questions, conditional logic,
                          evidence requests, effort estimates, prefill sources
src/questions.js          Which questions apply, given the answers so far
src/batching.js           The drip engine: what to ask in this session
src/scheduler.js          When to ask: cadence, quiet hours, DST, backoff, escalation
src/store.js              Cases, answers, append-only audit trail, sign-off
src/magiclink.js          HMAC tokens, hashed at rest, expiry and revocation
src/prefill.js            Public data sources, each stubbed with the real API named
src/channels/whatsapp.js  Cloud API adapter: interactive messages, inbound parsing
src/conversation.js       Channel-agnostic orchestration + the nudge worker
src/export/ta6.js         Back to a TA6 a conveyancer recognises, plus a chase list
src/server.js             HTTP API, magic-link redemption, webhook
public/                   The seller's web app
```

The rule that holds it together: **one question bank, many channels.** A seller
can tap an answer in WhatsApp on the bus, upload the boiler certificate from the
kitchen, and sign off on a laptop — it is one form throughout.

## What is real and what is stubbed

**Real and tested:** the question bank and its conditional logic; batching by
count or time budget; cadence, quiet hours, BST/GMT, backoff and escalation;
magic links; the answer store and audit trail; WhatsApp message rendering within
platform limits and inbound parsing; the conversation flow; multi-seller sign-off;
the TA6 export and chase list; the web app.

**Stubbed, with the real source named in the code:** the prefill providers
(`src/prefill.js` — HM Land Registry, EPC register, Environment Agency flood
data, Historic England, Ofcom, water company lookup) and the outbound WhatsApp
send (`createSender` posts to the Cloud API when given a token; without one it
records). SMS and email are not implemented — the channel interface is there and
each is a few hours' work against Twilio/Notify and a transactional mail provider.

**Not built:** the conveyancer's dashboard (the API behind it is there —
`GET /api/cases` returns the chase list), and the TA10 fittings-and-contents and
TA7 leasehold forms, which are the obvious next two.

## Before this goes near a real seller

- **Licensing.** TA6 is © The Law Society. Reproducing it in a product needs a
  licence. See `docs/COMPLIANCE.md`.
- **Nine question wordings were reconstructed**, not extracted, because those
  parts of the source PDF did not yield text. They are marked `"verify": true` in
  the question bank and listed in `docs/VERIFY.md`. Check each against the
  official form before use.
- Read `docs/PROCESS.md` for the process design and the reasoning behind it.
