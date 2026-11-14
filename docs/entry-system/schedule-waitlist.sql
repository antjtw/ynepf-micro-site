-- Looks after the waiting lists automatically, every 5 minutes: offers a place to the next person when one is free,
-- sends the reminder, and ends offers that ran out. Run this ONCE in the Supabase SQL editor, after the `waitlist`
-- function has been deployed and the CRON_SECRET secret has been saved.
--
-- BEFORE YOU RUN IT: replace YOUR-CRON-SECRET below with the very same text you saved as the CRON_SECRET secret.
-- (Any long random text will do. Keep it private: it is what stops anyone else running the list.)
--
-- Safe to leave running: when nobody is waiting it does nothing. Running the file again replaces the old schedule.
-- To change how often: edit '*/5 * * * *' (every 5 minutes) and run it again.
-- To stop it:  select cron.unschedule('ynepf-waitlist');
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'ynepf-waitlist') then perform cron.unschedule('ynepf-waitlist'); end if;
end $$;

select cron.schedule(
  'ynepf-waitlist',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://altuwgzzouwhrsdnzadj.supabase.co/functions/v1/waitlist',
      headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR-CRON-SECRET"}'::jsonb,
      body := '{"action": "run"}'::jsonb
    );
  $job$
);
