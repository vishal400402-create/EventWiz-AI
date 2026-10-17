# EventWiz AI

Consent-first event messaging software for weddings, birthdays, college events, seminars, conferences, and corporate events. It runs in **demo mode by default**: seed data, AI fallbacks, and delivery statuses are clearly simulated and no external messages are sent.

## Windows PowerShell quick start

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run seed # optional; demo mode only and non-destructive
npm run dev
```

Open `http://localhost:5173`. The API health check is at `http://localhost:8787/health`.

Demo account: `demo@eventwiz.local` / `DemoPass123!`.

## Production-like build

```powershell
npm run build
npm run test
npm start
```

## Live mode setup

Set `APP_MODE=live` plus every WhatsApp variable in `.env`. The connection page checks the configured phone-number ID with Meta before claiming it is connected. Add `OPENAI_API_KEY` only if you want live AI generation; it never reaches the browser.

In Meta's WhatsApp configuration, set the callback URL to `https://YOUR-DOMAIN/api/webhooks/whatsapp`, subscribe to `messages`, and use `WHATSAPP_VERIFY_TOKEN` as the verification token. Set `META_APP_SECRET` to the Meta app secret so POST signatures are validated against the raw body. Use an HTTPS public tunnel only for local webhook testing; do not expose a development server permanently.

To test an approved template safely, choose one consenting number you control, create a campaign with its approved template name and parameters, review the eligible/skipped counts, and click the explicit confirmation control. In live mode the server refuses non-consenting, suppressed, duplicate, or unverified recipients. Templates must already be approved in Meta.

## PostgreSQL migration and data practices

EventWiz now requires `DATABASE_URL`, using a Neon PostgreSQL connection string in local `.env`. Run `npm run db:migrate` explicitly once against the intended database before starting the server. Migrations are never run on startup, and the app never imports, deletes, or overwrites any existing SQLite database file. There is no automatic SQLite-to-PostgreSQL data copy: take a backup and perform a reviewed, one-time export/import before retiring legacy local data.

`npm run seed` is deliberately restricted to `APP_MODE=demo`, uses `ON CONFLICT DO NOTHING`, and is never part of migration or startup. Do not run it against a production database. Retain messages only as long as operationally needed, export/delete an organizer's data on request, and never copy the database URL or `.env` into source control. Image upload is intentionally disabled for the first public launch; use managed object storage before enabling it.

If `npm install` fails, confirm Node 20+ and network access. If live verification fails, check the token, phone number ID, Graph version, and that the token has WhatsApp permissions. Webhook failures usually mean a mismatched verify token, callback URL, or app secret.

## Included functionality

The dashboard supports event CRUD/archive, event-scoped guests, consent/suppression, campaigns with eligibility previews, simulated demo delivery, inbox/audit records, message templates, scheduled job records, webhook verification, and a verified-data-only AI studio. Scheduling persists jobs but demo mode deliberately never automatically sends them. CSV import is available through the API with per-row validation and duplicate detection.

## Known limits

Before production, configure the Neon `DATABASE_URL`, run the reviewed migration, set a production `WEB_ORIGIN`, serve the app over HTTPS, and test sign-up/login with a non-production account. Remaining launch work includes email verification and password resets, a durable queue/worker, managed object storage for service images, a full Meta template sync workflow, and jurisdictional legal review.
