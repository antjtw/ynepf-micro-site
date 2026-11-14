-- Puts five pretend people on a competition's waiting list, so you can see the Waiting list tab with something in it.
-- Run it in the Supabase SQL editor. Change 'march' below to any part of the competition's name.
--
-- BEFORE YOU USE IT: only do this while the competition has no free places (set its number of spaces to the number of entries it
-- has). If a place is free the timer will try to offer it to these people and email test-waiter-1@example.com, which goes nowhere.
-- REMOVE THEM AFTERWARDS with the delete at the bottom.
insert into public.waiting_list (competition_id, email, full_name, joined_at)
select c.id, 'test-waiter-' || n || '@example.com', 'Test Waiter ' || n, now() - make_interval(mins => 60 - n)
  from public.competitions c cross join generate_series(1, 5) n
 where c.name ilike '%march%' and c.entry_method = 'yne'
on conflict (competition_id, email) do nothing;

-- To take them off again:
-- delete from public.waiting_list where email like 'test-waiter-%@example.com';
