# WhatsApp go-live pack

Everything needed to take the WhatsApp channel from dry-run to live. Template
approval is the long pole — it takes days and can be refused — so submit the
four templates first and build everything else while they sit in review.

## 1. Accounts, in order

1. **Meta Business account** for the firm (or for you, if you are the sender of
   record — decide this before you start, because it determines whose name
   appears in the WhatsApp business profile the seller sees).
2. **WhatsApp Business Platform** (Cloud API) app in Meta for Developers.
3. **A phone number** that is not already on a WhatsApp account. It cannot be
   used in the normal WhatsApp app afterwards, so do not use anyone's mobile.
4. **Business verification** — Meta verifies the business behind the number.
   Have the company registration and a matching website ready; this is the step
   that most often stalls.
5. **Display name approval** for the sender name sellers see.

## 2. The four templates

Submit these in **Meta Business Manager → WhatsApp Manager → Message templates**.
All four are **Utility** category, language **English (UK)**. They are transactional
messages about a service the seller is already receiving; nothing here is
marketing, which is what keeps them in Utility (cheaper, and far more likely to
be approved).

Names must match `TEMPLATES` in `src/channels/whatsapp.js`.

---

**`ta6_invite`** — opens the conversation for the first time.

> Hi {{1}}, {{2}} here about the sale of {{3}}. I can collect the property
> information a couple of questions at a time by WhatsApp, so you never have to
> sit down to a 20-page form. Ready to start?

| Variable | Example |
|---|---|
| {{1}} | Sam Okafor |
| {{2}} | Hardcastle & Byrne |
| {{3}} | 12 Example Street, Leeds |

---

**`ta6_resume`** — reopens the thread for the next short session.

> Hi {{1}} - {{2}} of your property questions are done. Two more when you have a
> minute?

| Variable | Example |
|---|---|
| {{1}} | Sam |
| {{2}} | 34 |

---

**`ta6_paperwork`** — asks for one document.

> Hi {{1}}, one photo would move your sale along: {{2}}. Just send it to this
> chat.

| Variable | Example |
|---|---|
| {{1}} | Sam |
| {{2}} | the FENSA certificate for the windows |

---

**`ta6_deadline`** — used only when exchange is close and answers are missing.

> Hi {{1}}, your buyer is waiting on {{2}} answers to exchange. Can we finish
> them this week?

| Variable | Example |
|---|---|
| {{1}} | Sam |
| {{2}} | 6 |

---

**Notes that avoid a rejection.** Give a real example value for every variable —
templates submitted with placeholder junk get refused. Do not start or end the
body with a variable. Do not add a marketing sign-off or an offer. Do not include
a URL in the template body: the magic link goes in the free-form message that
follows, inside the 24-hour window.

## 3. Wiring it up

```bash
WA_TOKEN=            # permanent system-user token, not the 24-hour test token
WA_PHONE_ID=         # phone number ID from WhatsApp Manager
WA_VERIFY_TOKEN=     # any random string; must match what you paste into Meta
WA_APP_SECRET=       # app secret - REQUIRED; the webhook refuses everything without it
BASE_URL=https://intake.yourfirm.co.uk
LINK_SECRET=         # long random value - see below
ADMIN_KEY=           # bootstrap key for creating firms
```

Webhook callback URL: `https://<your host>/webhooks/whatsapp`, verify token as
above. Subscribe to the **messages** field only.

The server verifies `X-Hub-Signature-256` on every inbound call and rejects
anything unsigned or wrongly signed. `WA_APP_SECRET` is mandatory: with it
unset the webhook returns 503 and nothing is processed. This is deliberate —
the alternative is that anyone who finds the URL can post messages as any
seller.

For SMS the equivalent is `SMS_AUTH_TOKEN`, which verifies Twilio's
`X-Twilio-Signature`. Twilio signs the exact URL configured in its console, so
that URL must be `BASE_URL` + `/webhooks/sms` character for character.

A firm can send from its own number by setting `firms.wa_phone_id` — otherwise
everything goes out on the platform number.

## 4. Testing before a real seller sees it

- [ ] Send `ta6_invite` to your own number; confirm the firm's name appears,
      not ours.
- [ ] Reply anything; confirm a question comes back within a second or two.
- [ ] Tap each of the three buttons; confirm the answer lands on the file with
      `source: whatsapp`.
- [ ] Reply something ambiguous ("the wobbly one"); confirm you get a numbered
      list back and **nothing is stored**.
- [ ] Send a photo; confirm it attaches to the case.
- [ ] Reply `STOP`; confirm messaging stops immediately and the case switches to
      web-only. Then check nothing further is sent by the worker.
- [ ] Wait 24 hours without replying, then let the worker nudge: confirm it
      sends a **template**, not a free-form message.
- [ ] Ignore three nudges; confirm it escalates to SMS rather than sending a
      fourth WhatsApp.

## 5. What it costs

Meta charges per 24-hour conversation, by category and country. Utility
conversations initiated by the business are the relevant rate for the UK; ones
the seller starts are cheaper or free depending on the current pricing model.
Model it as one business-initiated Utility conversation per nudge: at one nudge a
day for three weeks that is roughly 20 per case. Check the current UK rate card
before quoting a figure to a firm — Meta has changed this pricing model more than
once.

## 6. If templates are refused

The pilot must not be hostage to Meta. `cadence.channel` is per seller, so:

```js
store.setPreferences(participantId, { cadence: { channel: 'sms' } });
```

SMS needs no template approval and drives exactly the same conversation. Email
works as a digest with a link. Both are implemented and tested — see
`src/channels/`.
