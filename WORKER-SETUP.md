# Step 4: checks while your computer is off

The code is ready for deployment. No cloud changes have been made by Codex. Your existing local `.env` is untouched. Supabase project setup and deployment must be completed in your account.

## Our conservative free budget

| Control | Limit |
| --- | --- |
| AeroDataBox worker budget | 80 units in ANY rolling 35 days (40 attempts at 2 units each) |
| Rolling 24-hour budget | 4 attempts total, including failures |
| Concurrent tracked flights | 1 globally |
| Poll interval | At least 1 hour between claims |
| Window | From 6 hours before scheduled departure to 6 hours afterward |
| Lifetime checks per enrollment | At most 12; the daily budget may stop checks sooner |
| Retry on provider failure | None; flight pauses and its contents are removed |
| Paid flight-plan add-on | Disabled |
| Default state | Both live switches off |

The published free allowance is 400 units/month. The worker uses at most 20% of that allowance in a period longer than a normal billing month. The separate local lookup experiment has a lifetime 20-unit cap, so together these paths reserve at most 100 units in that window. Dashboard tests, other apps, other keys under the same subscription, and direct provider calls are not counted by this database. Keep those to a minimum; use demo mode while developing. This is a conservative application cap, not a promise about third-party billing or future pricing. Never upgrade the provider or Supabase organization for this project.

One hourly Cron job invokes approximately 720–744 functions per month, versus the published Supabase Free allowance of 500,000 invocations (less than 0.15%). Existing project usage shares that allowance. Database/API traffic here is small; stay on Free and inspect usage periodically. Free projects can pause and have no uptime guarantee. Do not claim this portfolio pilot has airline-grade reliability.

Official references (checked October 26, 2026):
- https://rapidapi.com/aedbx-aedbx/api/aerodatabox/pricing
- https://supabase.com/docs/guides/functions/pricing
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/functions/auth

## 1. Apply the next migration

Open this file locally:

```powershell
notepad .\supabase\migrations\002_scheduled_worker.sql
```

Copy all of it into a NEW Supabase SQL Editor query and run once. Keep migration 001 as already applied; do not run 001 again. The new migration starts with live monitoring disabled. Existing synthetic records remain.

The migration stores reservations in the database before any flight API request. A locked settings row serializes competing requests. A crash, timeout, or duplicate invocation cannot refund or bypass a reservation. Budget expiry follows actual rolling time instead of guessing the provider's billing reset.

## 2. Deploy the Edge Function

In your project go to Edge Functions and choose Deploy a new function / Via Editor. Name it exactly `flight-worker`.

Open the ready-to-paste file:

```powershell
notepad .\supabase\functions\flight-worker\index.ts
```

Replace the editor's starter code with that entire file and deploy it. It is generated from the source modules, not a second independently maintained implementation. After future changes run `npm.cmd run build:worker` and redeploy.

In this function's settings, turn OFF the platform's **Verify JWT** / **Enforce JWT verification** setting. Our worker instead requires a dedicated private `x-worker-secret` header and rejects requests before reading the database. Do not expose that secret publicly. The included `supabase/config.toml` also records this setting for a future CLI deployment. This is a server-to-server endpoint, not a browser API.

## 3. Configure function secrets

Local `.env` values are NOT uploaded automatically. Under Edge Functions > Secrets, add:

| Secret name | Value |
| --- | --- |
| `RAPIDAPI_KEY` | Your existing AeroDataBox RapidAPI key |
| `WORKER_DB_SECRET` | Your backend Supabase `sb_secret_...` key, as used locally |
| `WORKER_CRON_SECRET` | A NEW random private value, generated below |
| `WORKER_LIVE_ENABLED` | `false` initially |

Supabase supplies `SUPABASE_URL` to deployed functions automatically. Do not try to upload your entire `.env` or put a database secret into browser code.

Generate the new random value in your own terminal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy it privately into the `WORKER_CRON_SECRET` secret. Keep it for the next step; do not paste it into chat. It is not your RapidAPI or Supabase key.

## 4. Configure hourly Cron securely

Enable the `pg_net` extension under Integrations / Database Extensions if it is not already enabled. Cron (`pg_cron`) is already installed.

In Supabase Vault (look under Integrations or search the dashboard), create TWO secrets through the form:

- Name `flight_worker_url`: your deployed function URL, such as `https://YOUR_PROJECT.supabase.co/functions/v1/flight-worker`.
- Name `flight_worker_cron_secret`: exactly the same random value as `WORKER_CRON_SECRET`.

Use the Vault form so private values are not embedded in saved SQL queries. Then open this file and copy it into SQL Editor:

```powershell
notepad .\supabase\worker-cron.sql
```

Run it once. It creates `flight-worker-hourly`, hourly at minute 0 UTC. The SQL also runs retention cleanup before invoking the worker. Leave your existing daily cleanup job in place as a fallback.

In Cron, inspect the job and confirm its schedule is hourly. The HTTP response from pg_net is asynchronous: Cron success only confirms it queued a request, not that a flight check succeeded. Use Edge Function logs and `worker_attempts` for flight-check outcomes.

## 5. Test the OFF state first

In the Edge Function's Test panel send a POST with header `x-worker-secret` set to your private worker secret and body `{}`. You should receive:

```json
{"result":"disabled"}
```

A missing/wrong header should return 401. Both tests use zero flight API units. With the secrets and Cron configured correctly, the next hourly run should also return disabled until you enable it.

## 6. Enroll one known upcoming U.S. domestic flight

From your usual project terminal use this command structure:

```powershell
npm.cmd run track -- FLIGHT YYYY-MM-DD ORIGIN DESTINATION LOCAL_DEPARTURE_WITH_OFFSET
```

Example syntax only; REPLACE every value with a real flight departing in the next 24 hours:

```powershell
npm.cmd run track -- UA1229 2026-10-28 IAH SFO 2026-10-28T08:00:00-05:00
```

Use the actual departure airport's local date/time and UTC offset for that date. The example is not a verified schedule. Enrollment makes no flight API call and does not activate the worker. It fails if a pilot flight is already enrolled. We require both airports to have provider country code US before saving live observations; missing country information pauses the pilot rather than guessing.

## 7. Enable only after the OFF test works

Set the Edge Function secret `WORKER_LIVE_ENABLED` to `true`. In SQL Editor run:

```sql
update public.worker_settings set enabled = true where singleton = true;
```

Both switches must be on. The next hourly invocation checks the enrolled flight if it is inside the monitoring window and budgets permit. Testing the function manually now can spend 2 units, subject to the same database limits. Do not repeatedly test it with the provider console.

## 8. See results

- `flight_monitoring`: active pilot, attempts, next check, last outcome.
- `worker_attempts`: each reserved request and its outcome; an unfinished `reserved` row still counts against budget.
- `flight_observations` / `flight_changes`: live data while monitoring remains active. Synthetic demo records stay separate.
- Edge Function logs: sanitized outcomes (`idle`, `daily_limit`, `budget_exhausted`, `saved`, etc.). Keys and raw responses are never intentionally logged.

Budget query (no flight API calls):

```sql
select coalesce(sum(units),0) as reserved_units,
       80 - coalesce(sum(units),0) as units_remaining
from public.worker_attempts
where reserved_at >= now() - interval '35 days';
```

When the provider reports arrival, cancellation or diversion, the worker stops and deletes that flight's provider-derived contents. It also stops at the fixed deadline or the attempt cap. This milestone does not deliver emails or keep a permanent live trip history; synthetic data remains available to demonstrate events. `no_match` is not treated as cancellation. Repeated no-match results can use only the limited daily budget. Provider errors pause the pilot immediately. Consult the function/provider status before enrolling again.

## Stop or pause

To prevent new flight API requests, set `WORKER_LIVE_ENABLED=false` in function secrets and/or run:

```sql
update public.worker_settings set enabled = false where singleton = true;
```

For a full stop and deletion of current pilot contents:

```sql
update public.flight_monitoring set active = false where active;
```

Leave the cleanup jobs enabled. To stop even the scheduled function invocations, toggle `flight-worker-hourly` inactive in Cron. An HTTP request already in progress may still consume its reserved 2 units. Deleted flight data cannot be recreated by a late response because the database requires an active monitor for live saves. Never delete budget rows to make more calls.

## What has been verified

Node tests cover the handler, route matching, stop behavior and deployment switch. A local PostgreSQL engine (PGlite) executes both migrations and checks permissions, daily and rolling budgets, hourly claim spacing, duplicate saves, stale/conflicting versions, and live-data cleanup. No live API requests were made by these tests.

The hosted Edge Function, Vault/pg_net integration, and Supabase deployment still need the account setup and disabled-state test above. They have not been activated by Codex.
