# Setup guide: the one-off steps

Every step you have to do yourself, in the order you will need them, written so the next person can follow it without help. Each step says where to click, what to copy, where to paste it, and **what you should see when it has worked**.

**Never paste a secret key into a chat, an email or a document.** Each step says where a key goes. Anything marked "secret" goes only into the box named in the step.

This guide grows as the entry system is built. Parts marked **(to be written)** are filled in just before they are needed.

**How we are testing:** on the `entry-system` branch, using your live Supabase project but only with unpublished **TEST** competitions and Stripe **test mode**. The branch's pages sit behind your Vercel login. No real money can move until Part 8.

| Part | What | Who | Needed for |
|---|---|---|---|
| 1 | Back up, then add the entry tables to Supabase | You | Everything else |
| 2 | A Stripe account and test keys | Treasurer | Testing payments |
| 3 | Putting the payment functions into Supabase | You | Taking a test payment |
| 4 | The Stripe webhook | You and treasurer | The system learning that a payment worked |
| 5 | `@ynepf.co.uk` email | You | Sending emails. See [email-setup-guide.md](email-setup-guide.md) |
| 5b | The club list | You | Lifters choosing their club (see below) |
| 6 | Making a TEST competition and entering it | You | Trying it end to end |
| 7 | Apple Pay domain **(to be written)** | Treasurer | Apple Pay and Google Pay |
| 8 | Going live **(to be written)** | Treasurer and you | Real money |

---

## Part 1: Back up, then add the entry tables

**Time:** about 10 minutes. Do this **before** anything else in Supabase.

**A. Back up.** In Supabase, open **Table Editor**. For these tables press the **...** menu then **Export** (CSV): `editors`, `competitions`, `posts`, `site_settings`. Keep the files somewhere safe. (If your project has **Database > Backups**, note the latest backup date too.)

**B. Run the two files.** In Supabase press **SQL Editor** then **New query**.

1. Open `supabase/schema.sql` in GitHub (branch `entry-system`), press **Raw**, select everything, copy. Paste into the SQL editor and press **Run**. It is safe to run again. It now includes the new roles.
   **What you should see:** "Success. No rows returned".
2. New query. Do the same with `supabase/entry-system.sql`.
   **What you should see:** "Success. No rows returned".

**C. Check you and Sabrina still have full access.** Open the site editor at `/admin`. You should still see every tab, including **Users** and the new **Entries** tab. If you ever see "no access", tell me straight away.

**D. Give the right people the right role.** In the editor, **Users**, press **Change role**:
- **Admin**: you, and anyone who adds or removes users.
- **Entries team**: whoever runs entries.
- **Editor**: site content only. **Contributor**: news posts only.

---

## Part 2: A Stripe account and test keys

**Who:** your treasurer. Create the account under **the treasurer's own work email**, not a personal one. A second named person should be added later (Part 8).

**Time:** about 15 minutes. You do **not** need to finish Stripe's business verification to test.

1. Go to **dashboard.stripe.com/register** and create an account.
2. Switch **Test mode** (or a **Sandbox**) **on**. You should see an orange "Test mode" label.
3. Go to **Developers**, then **API keys**.
4. You will see two keys:
   - **Publishable key** (starts `pk_test_`): safe to share with me.
   - **Secret key** (starts `sk_test_`): **secret. Do not share it with anyone, not even me.** It goes only into Supabase (Part 3).

Useful to know: in test mode you pay with fake cards, for example `4242 4242 4242 4242` with any future date and any 3 digit code. No real money moves.

---

## Part 3: Putting the payment functions into Supabase

**Time:** about 20 minutes.

**A. Add the secrets.** In Supabase open **Edge Functions**, then **Secrets** (or **Project Settings > Edge Functions**). Add each of these, one at a time (name on the left, value on the right):

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | the `sk_test_...` key from Part 2 (**secret**) |
| `STRIPE_PUBLISHABLE_KEY` | the `pk_test_...` key |
| `SITE_URL` | the address of the test pages, with no slash at the end. In Vercel, open the project, **Deployments**, find the `entry-system` branch deployment and copy its address, for example `https://ynepf-micro-site-git-entry-system-yourname.vercel.app` |
| `RESEND_API_KEY` | already there from the contact form |
| `NOTIFY_TO` | `ynepfentries@gmail.com` (already there) |
| `MAIL_FROM` | leave as it is until Part 5 is done |

**B. Create the two functions.** Under **Edge Functions** press **Deploy a new function** > **Via editor**, and do this twice:

1. Name `entry-checkout`. Replace the example code with everything in `supabase/functions/entry-checkout/index.ts` (GitHub, branch `entry-system`, **Raw**). Switch **Verify JWT** **off**. Deploy.
2. Name `stripe-webhook`. Same, with `supabase/functions/stripe-webhook/index.ts`. **Verify JWT off**. Deploy.

**What you should see:** both functions listed as **Active**.

---

## Part 4: The Stripe webhook

This is how Stripe tells us "that payment worked".

1. In Stripe (test mode): **Developers > Webhooks > Add endpoint**.
2. **Endpoint URL:** your Supabase project URL, then `/functions/v1/stripe-webhook`. For example `https://abcdefgh.supabase.co/functions/v1/stripe-webhook`.
3. **Events:** choose `checkout.session.completed` and `checkout.session.expired`. Add the endpoint.
4. Open the new endpoint and press **Reveal** under **Signing secret** (starts `whsec_`). **Secret.**
5. Back in Supabase, add one more secret: `STRIPE_WEBHOOK_SECRET` with that value.

---

## Part 5: Email

Follow [email-setup-guide.md](email-setup-guide.md). Until then, Resend's starter sender can only deliver to the email address the Resend account was created with, so use that address when you test.

---

## Part 5a: The confirmation page check

The page people land on after paying only says "You're in" once the payment is really confirmed. It asks a small function, `entry-status`, which returns a single word (paid, pending, refunded or unknown) and nothing personal.

1. In Supabase, **Edge Functions > Deploy a new function > Via editor**. Name it `entry-status`, paste in `supabase/functions/entry-status/index.ts`, switch **Verify JWT** **off**, and **Deploy**.

Until it is deployed, the confirmation page shows "Still confirming" after about a minute, so do deploy it before testing a payment.

---

## Part 5c: Cancelling and refunding entries

The **Cancel or refund** button on each entry in the editor uses a function, `entry-refund`. It checks the person is signed in and on the entries team before anything happens, sends the refund to Stripe, records who did it and why, frees the place, and emails the lifter.

1. In Supabase, **Edge Functions > Deploy a new function > Via editor**. Name it `entry-refund`, paste in `supabase/functions/entry-refund/index.ts`, switch **Verify JWT** **off** (it checks the login itself), and **Deploy**.
2. Replace `stripe-webhook` with the newest file from the branch (it now also notices refunds made inside Stripe).
3. In Stripe (test mode first): **Developers > Webhooks**, open your destination, and add the event **`charge.refunded`** to the ones it listens for.

Stripe keeps its processing fee on a refund, so the federation bears that cost (it is already counted in the money report). A refund can be made after entries close: the entry form tells lifters refunds stop at closing, so it is the entries team's call.

---

## Part 5d: Discount codes

Codes are made in the editor: open a competition, then the **Discounts** tab, then **Make a discount code**. Nothing else needs setting up in Stripe. Update these two functions so codes work on the entry form: **`entry-checkout`** (it now checks codes, and confirms a free entry itself and emails the lifter) and **`entry-status`** (it now also recognises a free entry). Run the newest all-in-one SQL first.

---

## Part 5e: The money tab

To delete a competition, open it and scroll to the bottom of its **Details** tab: the red **Delete this competition** button asks you to confirm. A competition that has entries cannot be deleted, because entries and payments are records we keep; the dialog says so and offers to hide it from the website instead.

On the competition's **Details** tab, tick **This is a franchise competition** when a host runs it. Leave it unticked for a competition the federation runs itself: the federation then keeps the whole entry fee and there is no host to pay.

The **Extras** tab is where you add the photo package and any merchandise (name, price, optional stock and sizes). They appear on the entry form and are paid with the entry. Discounts never apply to them.

Each competition has a **Money** tab (entries team and admins). Press **Set who gets paid** to name the host; the host is paid the entry fee less the federation's fixed amount (£12 full power, £7.50 bench only, £4.50 sub-junior (full power; sub-junior bench only pays the bench amount), changed for that competition with **Change this competition's amounts**; the amounts new competitions start with are on the Calendar page under **What the federation keeps from each entry**, and changing those never alters competitions that already exist). The federation absorbs discounts, free places and Stripe's fees. The report shows what each person is owed and what is still to send; **Record a payment sent** notes when you have paid someone. It needs the newest all-in-one SQL (the report refuses anyone who is not on the entries team).

---

## Part 5f: The waiting list

When a competition has no places left, the waiting list opens by itself: the entry page and the calendar switch to "Join the waiting list" (name and email). When a place frees up, because of a cancellation, a refund, or a place nobody paid for, the person who has waited longest is emailed a personal link and the place is held for them for 48 hours (you can change this on the competition's Details tab). They get one reminder, and if they do not take it the place passes to the next person. Nothing needs doing by hand: the **Waiting list** tab on each competition shows who is waiting, who has been offered a place and until when, and lets you take someone off the list or withdraw an offer.

To set it up (once):
1. In Supabase, **Edge Functions > Deploy a new function > Via editor**. Name it `waitlist`, paste in `supabase/functions/waitlist/index.ts`, switch **Verify JWT** **off**, and **Deploy**.
2. Under **Edge Functions > Secrets**, add one new secret, `CRON_SECRET`, with any long random text (for example, mash the keyboard for 30 characters). Keep a copy.
3. In **Database > Extensions**, make sure `pg_cron` and `pg_net` are switched on.
4. Open `docs/entry-system/schedule-waitlist.sql`, replace `YOUR-CRON-SECRET` with the text from step 2, and run it in the SQL editor. It makes the list check itself every 5 minutes.
5. To test without waiting, press **Check the list now** on the Waiting list tab.

It needs the newest all-in-one SQL.

## Part 5b: The club list

Lifters in English divisions can choose their club (it is optional) from the English Powerlifting Association's list of approved clubs, copied from the EPA website. Only club **names** are copied, never contact details. Lifters from other nations have no club question, and clubs from other bodies are not included.

1. In Supabase, **Edge Functions > Deploy a new function > Via editor**. Name it `sync-clubs`, paste in `supabase/functions/sync-clubs/index.ts`, switch **Verify JWT** **off**, and **Deploy**.
2. In the site editor, **Calendar**, scroll to **Club list** (entries team and admins) and press **Refresh club list**. You should see "Club list refreshed: 64 clubs" (the number changes as the EPA adds clubs).
3. Optional, to keep it fresh: run `docs/entry-system/schedule-club-sync.sql` once in the Supabase SQL editor. It refreshes on the 1st and 15th of each month.

If the EPA website changes shape, the import stops and leaves the list as it was, and the Club list box says the last check did not work. Tell me and I will adjust it. A club that is not on the EPA list cannot be chosen: the lifter simply leaves the club blank.

---

## Part 6: Making a TEST competition and entering it

Everything for a competition is set up once, on one page in the **Calendar** tab. There is no separate Entries tab: a competition's page has **Details** (everything you set up) and **Entries** (who has entered).

1. In the editor, **Calendar > Add competition**. A full page opens. Fill in:
   - **The competition:** name (for example `TEST Spring Open`), description.
   - **When and where:** the dates and venue.
   - **Entry:** choose **On this website, paid by card**, set the **Number of spaces**, and leave **Entry opens** and **Entry closes** on the usual settings (8 weeks before at 9am, 3 weeks before at noon) or choose your own. A line under each shows exactly when it will happen, and when priority entry opens (a day earlier).
   - **Online entry:** the events and equipment you offer, the prices, and how many days after entry opens guests (anyone outside the Yorkshire & North East division) can enter. It is 14 by default.
   - Leave **Show on the website** unticked while you test. New items start as drafts.
2. Press **Add competition**. You stay on the page, which now also has an **Entries** tab.
3. Enter it:
   - **Unpublished (testing):** sign in at `/admin` on the test address first, then go to `/enter?c=` followed by the web address ending, for example `2027-test-spring-open` (shown on the page under "Web address ending"). You will see a "Preview" notice.
   - **Published:** the competition's card on the public Calendar gets an **Enter now** button.
4. Fill in the form. Pay with the test card `4242 4242 4242 4242`.

**What you should see:** a thank-you page, the entry in the competition's **Entries** tab marked **Paid**, and a confirmation email.

**Why unpublished works:** an unpublished competition is hidden from the public, but you can still open its entry form **if you are signed in to the site editor on the same address**. Everyone else gets "Competition not found".

**Clearing a test competition:** the editor will not delete a competition that has entries, because the payment records must be kept. For a TEST competition, an administrator opens `docs/entry-system/clear-test-competition.sql`, changes the name on the marked line, and runs it in the Supabase SQL editor. It only accepts names containing the word TEST. To simply take a competition off the website, untick **Show on the website**.

**Who can change what:** editors change the competition itself (details, places, entry times, links). The entries team changes the online entry settings (how entries are taken, events, prices) and sees the Entries tab. Admins do both.

---

## Parts 7 and 8

**(to be written)**, each just before it is needed.
