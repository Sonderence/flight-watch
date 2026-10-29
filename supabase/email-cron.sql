-- Requires migration 003 and pg_net. Set flight_email_worker_url in Vault.
-- Reuses the existing flight_worker_cron_secret, without printing it here.
select cron.schedule('flight-email-hourly','5 * * * *',$job$
  select public.purge_email_data();
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='flight_email_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='flight_worker_cron_secret')),
    body := '{}'::jsonb,timeout_milliseconds := 60000
  );
$job$);
