# Compliance notes

Not legal advice — a checklist of what needs a decision before launch.

## TA6 and TA10 copyright and licensing

The TA6 Property Information Form and the TA10 Fittings and Contents Form are
© The Law Society. The question sets, numbering and structure are their
intellectual property. Commercial products that reproduce them do so under
licence. **Secure that licence before this goes live.**

Selling this to other firms is a different licence from using it on your own
files — raise that explicitly when you approach them, because a licence granted
for internal use will not cover resale, and finding that out after the first
customer signs is expensive.

Practical consequences for the build:

- The question bank stores the TA6 number (`n`) alongside our own plainer wording
  (`q`), so the export can carry official numbering and a licensed edition can
  slot in without touching the engine.
- The edition is recorded on every case (`cases.form_version`). TA6 changed
  substantially in 2024–25; a form must be exported in the edition it was
  answered under.
- Our plain-English help text is a summary of the explanatory notes, not a
  reproduction of them, and should stay that way.

## UK GDPR

- **Lawful basis:** contract (the conveyancing retainer) for the answers;
  consent for WhatsApp messaging specifically, recorded per participant
  (`participants.whatsapp_opt_in`) and revocable by replying STOP.
- **Data minimisation:** the prefill layer pulls only what the form asks for.
  Uploads are stored on disk in this prototype; production wants encrypted object
  storage with a retention policy.
- **Retention:** answers and the audit trail need to outlive the transaction
  (misrepresentation claims have a long tail) but not indefinitely. Six years
  from completion is the usual starting point — confirm with the firm's policy.
- **Special category data:** TA6 does not ask for any, but free-text boxes invite
  it (health, a neighbour dispute involving a protected characteristic). Do not
  index free text for analytics.
- **Subject access:** `GET /api/cases/:id/export.json` already produces
  everything held about a case, including the audit trail.
- **Processor terms:** WhatsApp/Meta, the SMS provider and the mail provider are
  all processors and need contracts in place.

## Electronic signatures

TA6 is not a deed, so a simple electronic signature is sufficient. What matters
evidentially is the trail, which the system keeps: who confirmed, when, from
which IP and channel, against which version of the answers. The rule that
changing an answer after sign-off un-signs the form is there for the same reason.

## SMS

- **Opt-out is regulated, not optional.** `STOP` must work, immediately and
  permanently. In `src/channels/replies.js`, `STOP`, `END`, `QUIT` and
  `UNSUBSCRIBE` all map to opt-out and can never be read as "skip this question".
- Messages must identify the sender. The firm's name is in the opener; keep it
  there.
- Sender IDs must be registered with the provider. An alphanumeric sender ID
  cannot receive replies, so use a long number or short code — this channel is
  two-way.
- Cost is per segment. The adapter keeps every message to at most two segments
  and strips curly quotes and dashes, which silently halve the characters per
  segment.

## Email

- The digest carries a magic link, so treat it as credential-bearing: no
  forwarding-friendly wording, and the link expires in 30 days.
- Include a plain way to stop receiving them. The current wording invites a reply
  asking to be phoned instead; if volume grows, add a one-click unsubscribe.
- Everything a firm or a seller supplied is HTML-escaped before it reaches the
  template.

## Staff access

- Staff keys are bearer tokens, hashed with SHA-256 at rest and shown exactly
  once on creation. Treat them like passwords: no sharing, and revoke by deleting
  the row.
- The prototype stores the key in the browser's `localStorage`. Before a firm
  relies on this, move staff to proper sessions with expiry, and add
  two-factor authentication — these keys open every seller's file in the firm.
- `ADMIN_KEY` creates firms. It belongs in a secret manager, not in a deploy
  script.
- Case access is checked on every request against the caller's firm, and a
  mismatch returns 404 rather than 403.

## WhatsApp Business policy

- Business-initiated conversations require a pre-approved template. Four are
  defined in `src/channels/whatsapp.js`.
- Opt-out must be honoured immediately and permanently.
- Templates must not be misleading about who is contacting the seller. The
  invite names the firm.
- Webhook payloads are signature-verified (`X-Hub-Signature-256`) on every
  call. `WA_APP_SECRET` is mandatory: without it the webhook returns 503 and
  processes nothing. There is no mode that accepts unsigned traffic.

## Security

- `LINK_SECRET` must be a strong random value in production; the default is a
  development placeholder and the server should refuse to start without it set.
- Magic-link tokens are hashed at rest (SHA-256); session cookies are HMAC-signed,
  `HttpOnly`, `SameSite=Lax`, and `Secure` when served over HTTPS.
- Every conveyancer endpoint requires a staff key; every seller endpoint
  requires a signed session cookie that carries its own expiry (30 days) and is
  checked on the server, not just by the browser. The worker trigger
  (`POST /api/tick`) requires `ADMIN_KEY`.
- The printable export opens in a new tab with a ten-minute, case-bound token
  minted by the dashboard. The staff key itself never appears in a URL, so it
  never lands in browser history, proxy logs or a bookmark.

## Inbound messages

Anyone who can reach the webhook URL and knows a seller's phone number could
otherwise answer that seller's questions, park them, opt them out, or file
documents on their case — and un-sign a signed form. So:

- `/webhooks/sms` verifies Twilio's `X-Twilio-Signature` (HMAC-SHA1 over the
  configured URL plus sorted parameters, using `SMS_AUTH_TOKEN`). Twilio signs
  the URL you configure in its console, which must equal `BASE_URL` +
  `/webhooks/sms` exactly, including scheme. A JSON provider that does not sign
  sends the same token in an `X-Webhook-Secret` header instead.
- Both webhooks return 503 when their secret is not configured. Rejections are
  logged as `webhook_rejected` events with the reason and source IP.
- A button reply is only accepted for the question actually asked of that
  seller. A reply naming any other question — or one that does not exist — is
  logged as `reply_rejected` and the open question is re-sent.
- A message arriving on a firm's own number (`firms.sms_sender`,
  `firms.wa_phone_id`) is matched only against that firm's sellers, so a phone
  number shared across two firms' files cannot route one firm's reply onto the
  other's.
- Uploads are written with generated filenames; add virus scanning and a
  content-type allow-list before accepting files from the public internet.
