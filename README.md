# EventWiz AI

Consent-first event messaging software for weddings, birthdays, college events, seminars, conferences, and corporate events. It runs in **demo mode by default**: seed data, AI fallbacks, and delivery statuses are clearly simulated and no external messages are sent.

## Windows PowerShell quick start

```powershell
Copy-Item .env.example .env
npm install
npm run seed
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

## Data practices and troubleshooting

Back up the SQLite file specified by `DATABASE_PATH` while the app is stopped. Retain messages only as long as operationally needed, export/delete an organizer's data on request, and never copy the database or `.env` into source control. Demo data can be reset with `npm run seed` after removing only the app database file.

If `npm install` fails, confirm Node 20+ and network access. If live verification fails, check the token, phone number ID, Graph version, and that the token has WhatsApp permissions. Webhook failures usually mean a mismatched verify token, callback URL, or app secret.

## Included functionality

The dashboard supports event CRUD/archive, event-scoped guests, consent/suppression, campaigns with eligibility previews, simulated demo delivery, inbox/audit records, message templates, scheduled job records, webhook verification, and a verified-data-only AI studio. Scheduling persists jobs but demo mode deliberately never automatically sends them. CSV import is available through the API with per-row validation and duplicate detection.

## Known limits

This initial local implementation uses SQLite directly (not a hosted multi-node job runner). For a production deployment, add a durable queue/worker, a managed database with encrypted backups, email/password verification and password-reset flows, a full Meta template sync workflow, and legal review for the organizer's jurisdictions.
