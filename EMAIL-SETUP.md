# Step 5: email alerts, personal $0 pilot

The email code is implemented and locally tested. Nothing has been deployed or sent by Codex. Your current flight worker and its AeroDataBox budget remain unchanged.

## What triggers an alert

- Cancellation.
- A known gate changing to another known gate.
- An arrival or departure estimate moving at least 15 minutes earlier or later since the previous recorded estimate (or schedule, if no estimate existed).

Small updates are still recorded in `flight_changes`, but not emailed. Several qualifying events from the same observation become one email. A gradual sequence of changes smaller than 15 minutes each does not currently accumulate into an alert. The first observation is a baseline, not an alert. Old records are not backfilled into email; only NEW qualifying live changes after database email activation are queued.

## Free scope and limits

Use Resend's Free account and its test sender `onboarding@resend.dev`. No domain purchase is required for sending to the SAME address you registered your Resend account with. Other recipients require a verified sending domain; that is outside this pilot. Do not buy a domain, upgrade, or add paid extras for these steps.

The app limits sending attempts globally to TWO in any rolling 24 hours and TWENTY in any rolling 35 days. Failed and retried requests count. The provider's published free daily allowance is 100, so this leaves substantial headroom. Other uses of your Resend account share provider limits and are not counted here.

The new email Cron invokes one function hourly at minute 5, adding about 720–744 invocations per month. Combined with the hourly flight worker this is about 1,440–1,488, below 0.3% of Supabase's published 500,000 free monthly invocations. Check total organization usage and remain on Free.

Official references checked October 29, 2026:
- Free plan: https://resend.com/pricing
- Test-sender restriction: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
- Provider deduplication window (24 hours): https://resend.com/docs/dashboard/emails/idempotency-keys

## 1. Preview the email offline

In PowerShell:

```powershell
cd "C:\path\to\flight-watch"
npm.cmd run email:preview
```

This prints a simulated message for a 39-minute earlier arrival. It sends nothing and uses no flight API units.

## 2. Set up Resend

Sign up at https://resend.com with the email address where YOU want to receive pilot alerts. Stay on Free. In the Resend dashboard open API Keys and create a sending key. Keep it private and out of chat. No need to create a domain for this own-address test.

## 3. Apply migration 003

Open:

```powershell
notepad .\supabase\migrations\003_email_alerts.sql
```

Copy everything into a NEW Supabase SQL Editor query and run ONCE. Do not rerun migrations 001 or 002. The email database switch starts off. No existing flight data or budget counters are deleted.

## 4. Deploy a separate email function

Open:

```powershell
notepad .\supabase\functions\flight-email-worker\index.ts
```

In Supabase Edge Functions, create a new function via the editor named exactly `flight-email-worker`. Replace all starter code with the contents of this file, then deploy. You do NOT need to redeploy or replace `flight-worker` for this feature.

Turn OFF the platform **Verify JWT / Enforce JWT verification** setting on the NEW email function. Its own handler validates our private `x-worker-secret` before doing anything else, just like the flight worker.

## 5. Add function secrets

Under Edge Functions > Secrets add:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | Your private Resend sending API key |
| `PILOT_EMAIL` | Exactly the email address used for your Resend account |
| `EMAIL_LIVE_ENABLED` | `false` initially: enter only `false`, with no quotes |

The project-wide secrets `WORKER_DB_SECRET` and `WORKER_CRON_SECRET` are already used by the flight worker and are reused here. `SUPABASE_URL` is supplied by Supabase automatically. Do not replace your RapidAPI settings or change `WORKER_LIVE_ENABLED`.

## 6. Test while sending is disabled

In the NEW email function's Test panel:

- Method: POST
- Header name: `x-worker-secret`
- Header value: the same full generated random secret stored as `WORKER_CRON_SECRET`
- Body: `{}`

Expected: `{"result":"disabled"}`. No email or flight API call occurs. With the header missing, expect 401.

## 7. Schedule the email sender

Copy the NEW function's endpoint URL. It should end in `/functions/v1/flight-email-worker`.

Under Integrations > Vault create:

- Name: `flight_email_worker_url` (no quotes, spaces, or extra apostrophe).
- Value: the copied NEW function endpoint URL.

Keep the existing Vault `flight_worker_cron_secret` unchanged. The email Cron reuses it. `pg_cron` and `pg_net` should already be enabled from the flight worker setup.

Open:

```powershell
notepad .\supabase\email-cron.sql
```

Copy it into a new SQL Editor query and run once. It creates `flight-email-hourly`, running at five minutes past each hour. It purges expired email data before invoking the sender. The existing `flight-worker-hourly` job remains at minute 0.

## 8. Enable sending to your own account address

After the disabled test works and you have confirmed `PILOT_EMAIL` is your own Resend account address, set function secret `EMAIL_LIVE_ENABLED` to `true`. Then run:

```sql
update public.email_settings set enabled=true where singleton=true;
```

Both email switches must be on. Either order works. NEW qualifying live flight changes can now queue alerts. Notifications contain only the minimum information needed for the alert, not a complete provider response.

## 9. Optional one-email test without a flight API call

This intentionally queues ONE simulated email to your configured pilot address. Run once only, after enabling sending:

```sql
insert into public.email_outbox(payload)
values(jsonb_build_object(
  'test',true,
  'number','DEMO100',
  'origin','ORD',
  'destination','DEN',
  'observedAt',now(),
  'events',jsonb_build_array(jsonb_build_object(
    'type','time_changed',
    'field','arrival.revised',
    'before','08:20-06:00',
    'after','07:41-06:00',
    'minutesChanged',-39
  ))
));
```

Then invoke the email function ONCE with the same test settings, or wait until the next five-minutes-past-hour run. This uses one email attempt from our 20-attempt allowance and ZERO AeroDataBox units.

Expected response: `{"result":"accepted"}`. Check your inbox/spam folder. Accepted means Resend accepted the message; it is not proof of inbox delivery. Resend's dashboard provides delivery/bounce status. No webhook for delivery receipts is implemented yet.

## 10. Inspect results without sending anything

In SQL Editor:

```sql
select created_at,status,attempts,provider_id,last_error
from public.email_outbox
order by created_at desc
limit 10;
```

- `pending`: queued or waiting for a bounded retry.
- `sending`: claimed; a crashed invocation can leave this until its lease expires.
- `accepted`: Resend accepted it; check the provider/inbox for delivery.
- `failed`: permanent error or exhausted retries. `HTTP_403` often indicates the recipient is not your Resend account address.
- `expired`: a pending message became six hours old; it is not sent late.
- `cancelled`: disabled through the database switch.

Provider timeouts, 429s, and server errors can retry after one hour, under the same daily/monthly caps, at most three attempts. Every retry uses the same message ID and frozen recipient. The six-hour queue expiry is well inside Resend's 24-hour idempotency window. Permanent 4xx failures do not retry. No immediate retry loops are used.

## Stop alerts

Run:

```sql
update public.email_settings set enabled=false where singleton=true;
```

This stops new queue entries and cancels pending messages, clearing their contents. Also set `EMAIL_LIVE_ENABLED=false` if desired. A provider request already in flight cannot be recalled.

Stopping a flight through the old monitoring SQL does not cancel already queued notifications: they remain briefly for delivery (including a final cancellation notice). To stop all pilot email delivery use the email switch above. Public account verification, per-user unsubscribe links and subscriptions remain future work; this is an operator-controlled own-address pilot only.

## Data retention

Pending alert contents expire after six hours and are cleared by the email cleanup job. On acceptance or permanent failure, the app clears its queued message contents and recipient, retaining only status/provider ID and budget metadata. Already queued notices survive the flight monitor's end so a cancellation alert is not lost. The notification itself and Resend's message history have separate retention; see provider terms and settings before any wider launch. Failed Cron cleanup runs need attention. No raw flight data is added to logs.

## Verification completed locally

The offline preview and mocked provider requests send nothing. PostgreSQL tests execute migrations 001–003 and verify filtering, transactional grouping, default off state, budget caps, leases, retries, expiry, and cancellation. The hosted email function and actual delivery remain unverified until your account setup and test above.
