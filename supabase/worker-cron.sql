-- Run only after setting Vault secrets named flight_worker_url and
-- flight_worker_cron_secret. This script contains no secret values.
-- Requires pg_cron and pg_net enabled in Supabase Integrations.
select cron.schedule(
  'flight-worker-hourly',
  '0 * * * *',
  $job$
  select public.purge_expired_flight_data();
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'flight_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'flight_worker_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
