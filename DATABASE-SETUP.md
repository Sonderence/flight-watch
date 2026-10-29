# Step 3: remember flight changes in Supabase

This step adds durable storage. It does not schedule checks, send email, or save live lookup results automatically. The database demo uses made-up flight data and consumes no AeroDataBox units.

## 1. Create a free project

Sign in at https://supabase.com/dashboard and create a dedicated project named Flight Disruption Tracker under a Free organization. Keep your existing projects separate. Do not upgrade or enable paid services. Verify current limits at https://supabase.com/pricing before creating it. Save the database password privately; this script does not need that password.

## 2. Create the tables

In your new project's SQL Editor, create a new query. Open `supabase/migrations/001_flight_storage.sql` from this project folder, copy its entire contents into that query, and click Run once. This creates three tables and two backend functions. It is a versioned migration; do not rerun it after it succeeds.

## 3. Add the database credentials locally

In the project's Connect dialog or Settings, copy the Project URL. In Settings > API Keys, find or create a backend secret key beginning `sb_secret_`. This is a different key from your RapidAPI key. Never use a Supabase publishable key here. Labels may vary; official guide: https://supabase.com/docs/guides/getting-started/api-keys

Open the existing `.env` file in this project folder. Keep your existing RapidAPI settings and append:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_PRIVATE_KEY
```

Keep this secret key private, local, and out of chat. It belongs only in backend code. Tables have row security enabled and no access for anonymous or signed-in browser users yet; future user accounts need their own authorization policies.

## 4. Save a baseline

In PowerShell, navigate to this project:

```powershell
cd "C:\path\to\flight-watch"
npm.cmd run db:demo -- baseline
```

Expected: `result: saved`, `events: 0`. In Supabase Table Editor, inspect `flight_tracks` and `flight_observations`.

## 5. Save a delayed flight in a separate command

```powershell
npm.cmd run db:demo -- delay
```

Expected: `events: 1` on the first transition from baseline. Inspect `flight_changes`: departure moved 35 minutes later. Because the commands are separate processes, this demonstrates remembering the baseline after the script exits.

Run the delay command again: expected `events: 0`. A new observation is stored, but the unchanged delay does not create a second change event.

```powershell
npm.cmd run db:demo -- cancel
```

Expected: one cancellation event after the delay. Repeating it produces zero events. Rerunning baseline after cancellation intentionally creates recovery events; baseline is a new observation, not a reset command.

## What the tables mean

- `flight_tracks`: one row per source + flight number + route + departure date. Contains the comparison baseline and a version counter.
- `flight_observations`: the actual normalized snapshot from each check, with observation time. Missing fields stay missing here.
- `flight_changes`: events associated with an observation, such as a revised departure or cancellation.

The backend reads the baseline, computes changes, then asks a database function to save all three updates in one transaction. Either they all succeed or none do. The version counter prevents concurrent workers overwriting each other. An observation UUID makes a retried save safe; reuse the same ID on retries. Older or equal observation timestamps are rejected as stale. The caller must supply the timestamp of retrieval, not a fabricated later timestamp for old data.

## Retention before saving any live data

The migration assigns six-day expiry times to snapshots and comparison state. Expiry alone does not delete data: enable Supabase Cron, then schedule this SQL daily in the Cron interface:

```sql
select public.purge_expired_flight_data();
```

Use a daily schedule such as midnight UTC and verify its job history shows success. Events are deleted with expired observations. The six-day limit plus daily cleanup is designed to stay within a seven-day cache limit; missed jobs require attention. This does not automate provider-required earlier deletion when data is no longer needed. Before enabling live persistence, add completion/unsubscribe deletion and retention monitoring. Check database backup retention too. Synthetic demo data is safe for this learning step.

## Validation status

The user confirmed successful baseline, delay, cancellation and repeat-update saves in Supabase, and configured daily cleanup. Codex additionally runs migrations and database safety tests against a local PostgreSQL engine. This does not verify hosted job execution: inspect Cron History after the scheduled run. No Supabase credentials were accessed by Codex and no paid service was activated.
