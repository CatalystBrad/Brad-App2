# Deploying

The app is one Node process with one SQLite file. That is a deliberate shape
for a pilot: nothing to provision, nothing to keep in sync, and a database you
can copy to your laptop with `scp`. It also means **run exactly one instance**
— SQLite has one writer, and the nudge worker runs inside the process, so a
second instance would send every seller two of everything.

## What it needs from you

| Variable | What it is | How to make it |
|---|---|---|
| `LINK_SECRET` | Signs every magic link and session cookie | `openssl rand -base64 48` |
| `ADMIN_KEY` | Creates firms; triggers the worker by hand | `openssl rand -base64 32` |
| `WA_VERIFY_TOKEN` | Meta reads it once to confirm the webhook | any random string |
| `BASE_URL` | The public https URL, no trailing slash | `https://intake.yourfirm.co.uk` |
| `DB_PATH` | The database file, on a persistent volume | `/data/intake.db` |
| `TRUST_PROXY` | `1` when behind a load balancer (it is, on every host below) | `1` |

Channel credentials, each optional until that channel goes live — the channel
runs dry without them and the inbound webhook refuses calls:

| Variable | Provider |
|---|---|
| `WA_TOKEN`, `WA_PHONE_ID`, `WA_APP_SECRET` | Meta WhatsApp Cloud API — see `docs/WHATSAPP.md` |
| `SMS_ACCOUNT_SID`, `SMS_AUTH_TOKEN`, `SMS_FROM` | Twilio |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Postmark (or any provider with the same shape in `src/channels/email.js`) |

**The server refuses to start in production with a placeholder secret, a
plain-http `BASE_URL`, or an in-memory database.** It tells you exactly which
one, in plain English. This is on purpose: a warning in a log nobody reads is
the same as no warning.

## Fly.io (recommended for the pilot)

Cheapest path to an https URL with a persistent disk, in London. About ten
minutes.

```bash
cd homeowner-intake
fly launch --no-deploy          # accept the generated name; say no to Postgres and Redis
fly volumes create intake_data --region lhr --size 1

fly secrets set \
  LINK_SECRET="$(openssl rand -base64 48)" \
  ADMIN_KEY="$(openssl rand -base64 32)" \
  WA_VERIFY_TOKEN="$(openssl rand -hex 16)" \
  BASE_URL="https://<the app name>.fly.dev"

fly deploy
fly logs                        # you should see "listening on port 8787 ... (production)"
```

Add channel secrets the same way when each provider is ready (`fly secrets set
WA_TOKEN=... WA_PHONE_ID=... WA_APP_SECRET=...`). `fly.toml` in this directory
already pins one machine, keeps it running so the worker never sleeps, and
mounts the volume at `/data`.

**Backups.** The whole state is one file. Until this matters more:
`fly ssh console -C "cp /data/intake.db /data/intake-$(date +%F).db"` on a
schedule, and `fly volumes snapshots list intake_data` for the host's own daily
snapshots. When it matters more, Litestream streams the file to object storage
continuously.

## Anywhere that runs a container

The `Dockerfile` is host-agnostic. Railway and Render both work with it: set
the same environment variables, attach a persistent disk at `/data`, set the
instance count to **1**, and point the health check at `/healthz`. Both sit
behind a proxy, so `TRUST_PROXY=1`.

```bash
docker build -t homeowner-intake .
docker run -p 8787:8787 -v intake_data:/data \
  -e LINK_SECRET=... -e ADMIN_KEY=... -e WA_VERIFY_TOKEN=... \
  -e BASE_URL=https://intake.example.co.uk -e TRUST_PROXY=1 \
  homeowner-intake
```

## After the first deploy

1. `curl https://<url>/healthz` — expect `{"ok":true,...}`.
2. Create the first firm and keep the key it returns; it is shown once:
   ```bash
   curl -s -X POST https://<url>/api/firms \
     -H "authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' \
     -d '{"name":"Your Firm","brand":{"colour":"#0F6E5C","signOff":"Your name"},
          "admin":{"email":"you@yourfirm.co.uk","name":"Your name"}}'
   ```
3. Open `https://<url>/staff`, paste the key, and create a case with your own
   mobile number as the seller. Open the magic link on your phone.
4. Answer three questions, close the tab, reopen the link: it should resume
   where you left off.
5. Register the webhooks with the providers (`docs/WHATSAPP.md`), using
   `BASE_URL` + `/webhooks/whatsapp` and `BASE_URL` + `/webhooks/sms`
   **exactly** — Twilio signs the URL it was given, character for character.

## Things this deliberately does not do yet

- **Staff login.** Fee earners paste a bearer key. Before a firm's whole case
  list sits behind one string, replace it with sessions that expire and a
  second factor. It is flagged in `docs/COMPLIANCE.md`.
- **Uploads on a volume, unscanned.** Files a seller sends land on the disk as
  sent. Add virus scanning and a content-type allow-list before the URL is
  public.
- **Scaling out.** One instance is the design. If a pilot outgrows it, the move
  is to Postgres, not to a second SQLite instance.
