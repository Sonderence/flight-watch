# Enable flight controls in Flight watch

The published interface now has a blue palette, a cloud logo, and Track / Switch / Stop controls. Demo-mode controls work without changing your live tracker. To enable those controls for live data, complete the backend update below once.

## Free budget stays the same

Saving, switching or stopping a flight only updates your database. These actions do not call AeroDataBox or search its schedules. The worker still tracks at most ONE flight globally, claims at most once per hour, and reserves at most FOUR requests per rolling 24 hours and 80 units per rolling 35 days. Switching does not reset usage counters. Your current provider and Supabase plans stay unchanged.

## 1. Apply migration 004

In PowerShell open:

```powershell
notepad "C:\path\to\flight-watch\supabase\migrations\004_dashboard_controls.sql"
```

Copy all of it into a new Supabase SQL Editor query and run once. Migrations 001 and 002 must already be installed. Migration 003 (email) is NOT required. Do not rerun earlier migrations.

The database function validates the new flight, locks the shared worker settings, checks that the current flight has not changed since you opened the form, stops the old flight, and saves the replacement in one transaction. If the replacement fails, the old enrollment remains. Anonymous and ordinary user roles cannot execute this function.

## 2. Update the EXISTING dashboard function

Open:

```powershell
notepad "C:\path\to\flight-watch\supabase\functions\flight-dashboard\index.ts"
```

In Supabase open Edge Functions > flight-dashboard > Code. Replace its current code with this entire updated file and deploy. Keep Verify JWT OFF: the handler checks its own dedicated tokens. Do not change or redeploy flight-worker. Existing read connections continue working.

## 3. Create a separate control token

Generate a NEW random value in your terminal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Under Edge Functions > Secrets add:

- `DASHBOARD_MANAGE_TOKEN`: the new 64-character value, no quotation marks.
- `DASHBOARD_MANAGEMENT_ENABLED`: `true` (only that word).

Keep `DASHBOARD_READ_TOKEN`, `DASHBOARD_ENABLED`, `WORKER_DB_SECRET`, RapidAPI settings and Cron secrets unchanged. The read token never gains write permission. Keep both tokens private and do not paste them into chat.

## 4. Add the control token in the UI

Refresh https://flight-disruption-tracker-pilot.pwrightsc.chatgpt.site and open **Connection settings**. Keep the endpoint and read token, then paste the NEW value into **Flight control token**. Click **Connect tracker**. Tokens stay only in this browser tab's session.

## 5. Switch flights

Choose **Switch flight** (or **Track a flight** if none is active). Enter flight number, departure date, origin/destination airport codes, local departure time and the departure airport's UTC offset on that date. The form does not look up schedules; use a real U.S. domestic flight departing in the next 24 hours.

Saving replaces the current flight and clears its saved live status and changes, following the existing cleanup rules. The new flight initially shows a waiting state until a scheduled worker check saves its first observation. All prior API reservations remain counted. No additional immediate lookup occurs.

**Stop tracking** asks for confirmation, then stops future checks and clears the current live records. An already running provider request may still consume its reserved 2 units. Late responses cannot recreate a stopped flight's contents. Terminal enrollment commands still work but stale UI forms will be rejected safely; refresh before trying again.

## Troubleshooting

- **Control token rejected / 401:** use the NEW manage token, not the read token.
- **Controls not enabled / 503:** set `DASHBOARD_MANAGEMENT_ENABLED=true` and leave `DASHBOARD_ENABLED=true`.
- **Update function / 405 / no monitor ID:** deploy the updated flight-dashboard code.
- **Could not change flight / 502:** apply migration 004 and refresh before retrying. An uncertain save may already have succeeded, so do not repeatedly submit.
- **Flight changed in another session / 409:** refresh the view and reopen the form.
- **Outside next 24 hours:** correct the date, local departure time, and UTC offset.

The frontend is published automatically; this private Supabase backend update remains an account setup step. No cloud monitoring changes were made by Codex. No flight API requests are needed for migration, configuration, or enrollment.
