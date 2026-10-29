# Flight watch: the status and changes dashboard

Email is no longer part of the intended product. Email code from the previous step is inactive by default and is not required. Do not apply migration 003 or deploy its email worker for this dashboard. If you already enabled email, set `EMAIL_LIVE_ENABLED=false`, run `update public.email_settings set enabled=false where singleton=true;` only if that table exists, and disable `flight-email-hourly` in Cron. Your flight worker remains unchanged.

## Try the UI

Private published dashboard: https://flight-disruption-tracker-pilot.pwrightsc.chatgpt.site
Sign in with your ChatGPT account to open it. Publication is verified; the hosted read-only Supabase endpoint still needs the setup below.

The hosted page starts in clearly labeled simulated demo mode. Filter the update timeline by times, gates or status. No flight API calls or emails are made by the UI.

For local use:

```powershell
cd "C:\path\to\flight-watch"
npm.cmd run ui
```

Open http://127.0.0.1:4173 in your browser. Leave the terminal open while using this local version; Ctrl+C stops it. The cloud flight worker runs independently.

## Connect recorded live data

The UI needs a separate read-only endpoint. It never gets your Supabase secret key, RapidAPI key or worker Cron secret. Existing tables stay private, with their existing permissions.

1. In Supabase Edge Functions create a function named exactly `flight-dashboard`, via the editor.
2. Open `supabase/functions/flight-dashboard/index.ts` locally and copy the entire contents into its editor. Deploy it.
3. Turn OFF platform Verify JWT for this function. The handler authenticates a separate `x-dashboard-token` header. Existing functions keep their settings.
4. Under Edge Functions > Secrets add `DASHBOARD_ENABLED=true` and `DASHBOARD_READ_TOKEN` set to a NEW random token. Generate one locally with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The function reuses the project's existing `WORKER_DB_SECRET`, and Supabase supplies `SUPABASE_URL`. Do not change the worker's Cron secret. Keep the dedicated dashboard token private; it permits reading this pilot's current flight and changes, not writes or provider requests.

5. In Flight watch choose **Connect live data**. Enter the endpoint URL (ending `/functions/v1/flight-dashboard`) and the NEW read token. Do not enter any other key. The UI keeps these values in browser-tab session storage, not site source or permanent local storage.
6. Click **Connect tracker**. It reads the saved observations. **Refresh view** rereads saved records; it never calls AeroDataBox. Refreshes are limited to once per minute in the UI. There is no automatic refresh loop.

The endpoint supports CORS for the custom read header; preflight does not require the token, but every data request does. It is a private pilot read API. This is not full user authentication or a public subscriptions system. The hosted static site is owner-private by default.

## What the screen means

- **Demo data** is always simulated. It does not describe current Frontier flight status.
- **Live records** come from your database and show the actual latest observation, including missing fields. The comparator's retained last-known state is not presented as fresh data.
- **Last flight check** is the observation's retrieval time, not the airline's update time.
- A revised time is an estimate. Times show local UTC offsets; the timeline timestamps follow your browser's time zone.
- The timeline includes all recorded events, even time changes smaller than 15 minutes. The email threshold is not applied here.
- No enrolled flight produces an empty live state. An enrolled flight without an observation produces a waiting state.
- Pilot cleanup removes live records when monitoring stops. You can still explore the synthetic demo anytime. No permanent trip-history feature is added.
- **Next eligible** is an eligibility timestamp, not a promised next run: the hourly schedule, time window and daily/monthly budgets still apply.

The UI now includes Track / Switch / Stop controls. See UI-CONTROLS-SETUP.md for migration 004, an updated dashboard function, and a separate management token. Existing read tokens stay read-only. Viewing, refreshing, enrolling and stopping do not call AeroDataBox; scheduled checks alone consume the existing worker budget.

## Developer notes

`web/dist/` is the buildless frontend and contains no service keys. `src/dashboard.mjs` is the read-only handler. Run `npm.cmd run build:dashboard` after editing it, then redeploy the generated Supabase function. No new database migration is required. Existing tests exercise the endpoint without real database or provider requests.
