# YNEPF entry system: the plan

This is the plan to read **before any code is written**. It covers what we are building, how it is split into pieces, how the money works, who can do what, and what is still undecided. The database design is in [`../../supabase/entry-system.sql`](../../supabase/entry-system.sql) and the privacy guidance is in [`privacy-guidance.md`](privacy-guidance.md).

Nothing in here has been built yet. The database design has been **tested** in a scratch database (40 checks, see "How this is tested").

---

## 1. What you decided

| Topic | Decision |
|---|---|
| Prices | Same as the published FAQ: full power £40, bench only £25, sub-junior £15. All are settings per competition. |
| Weight classes | A setting per sex, using today's classes. There is no 72 kg any more (women: 43, 47, 52, 57, 63, 69, 76, 84, 84+). |
| Divisions | We have division **names**, not codes. A small table maps each name to the name used in the OpenLifter meet. |
| Franchise payments | Franchise competitions take entries **through us**. We hold the money, keep our cut, and pay the host after entries close. |
| Merchandise | 100% goes to the host (for YNE competitions, the federation). |
| Photo packages | 100% goes to White Lights Media, our photographer. |
| Reporting | A "money to send" report: what each payee is owed, what the federation keeps, Stripe fees, and total earnings. |
| Refunds | Refunds are not given after entries close (no separate cut-off date), and the form and the confirmation email say so. The entries team can still refund by hand in unforeseen circumstances, with a reason that is logged, and the screen says so. Points come back with a refund. |
| Entry windows | General entry opens 8 weeks before the competition at 9am and closes 3 weeks before at noon (suggested on the Calendar, editable). Priority entry opens one day before general entry. |
| Priority entry | Personal, single-use links, one per email, made by the entries team (volunteer points will fill the list in phase 3). A link only works with the email it was made for. |
| Qualification | A per-competition switch. When on, the OpenIPF link is mandatory on the form and checked by the database. |
| Age category | Worked out from the date of birth by the year they turn the age (sub-junior, junior, open, M1 to M4). Shown to the lifter as "you are an M2 lifter", in the confirmation email, in the entries list and CSV, and on the public entries list. Used to offer weight classes (men's 53 and women's 43 are for sub-juniors). |
| Entry form | Almost nothing moves on a page while it is filled in (the one exception is the "you are an M2 lifter" box, which appears under the date of birth, by choice), and the answers that depend on earlier ones are asked on a later step. Step 1: name, email, date of birth, category (men's or women's, with a note that it should usually match sex at birth and that transgender athletes should contact us first), federation (the note says when guests can enter), club (optional, EPA list), British Powerlifting number (required; TBC accepted), Instagram (public on the lifting order), and a photo consent choice. **Parent or guardian** is its own step, shown only to lifters under 18 on the day: a named parent or guardian who will be with them for weigh-in and on hand all day, with contact details used only as an emergency contact or for queries. Then the lifting step (event, equipment, weight class, OpenIPF link, with the fee line always on the page), and check your answers. |
| Federation and guests | Everyone says which federation or division they are part of: Yorkshire & North East (ours), the other eight English divisions (from the EPA website), Scotland, Wales, Northern Ireland, Isle of Man, or Other. Anyone outside our division is a guest and can enter 14 days after entry opens (a setting). The entries team checks the British Powerlifting number by hand afterwards. |
| Clubs | Optional. Lifters in English divisions choose from the EPA's list of approved clubs, imported every few weeks (names only). There is no free text and no "my club isn't listed". Lifters from other nations have no club question, and clubs from other bodies and countries are deliberately not included: we stay within the EPA, which is what the federation pays into. |
| Discount codes | Made in the editor on each competition's Discounts tab (never guessable: name, discount and random letters, e.g. SAM-20OFF-K7XQ2M). A code works for one competition or for any, can take pounds or a percentage off, can be tied to one email address, and has a number of uses and an optional last day. Volunteer rewards are quick choices (£20 off, £40 off, half price, free). A code that takes the whole price off makes a free entry with no payment. Cancelling or refunding an entry frees its code. Later, the volunteer database can call the same function to hand codes out directly. |
| Entries desk | A searchable, filterable list; each entry opens into the full record; the entries team can edit anything (logged), cancel or refund through Stripe (full, partial or goodwill, with a reason), add free or paid-elsewhere entries by hand, tick that a guest's membership has been checked, and see possible duplicates. The audit log never stores guardian details. |
| Waiting list | Automatic. When a competition has no places left, "Join the waiting list" (name and email) replaces the entry form, and the calendar link switches too. When a place frees up the longest-waiting person is emailed a personal link and the place is held for them for the offer window (48 hours by default, set per competition). One reminder, then it passes to the next person. Offered places count as taken, so nobody else can buy them. A place that frees up is not on sale to the public while anyone is waiting: it stays "full" (with the waiting list) until the queue is served, and Enter now only returns once nobody is waiting. Emails: joined, offer, reminder, expired. The entries team sees the list on each competition's Waiting list tab and can remove people or withdraw an offer. A timer (pg_cron) runs it every 5 minutes. |
| Franchise or not | Each competition has a **franchise** tick box (Details tab, online entry). Franchise: a host runs it and is paid as described below. Not a franchise: the federation runs it and keeps the whole entry fee (less Stripe's fees), with no host and no fixed amounts. Photo packages go to the photographer either way. |
| Extras | Each competition has an **Extras** tab for add-ons: the White Lights Media photo package (£40.49) and merchandise such as T-shirts in sizes. They appear on the entry form after the lifting questions, are added to the payment as separate lines, and are listed in the confirmation email. Discounts apply to the entry fee only, never the extras. A 100% code frees the entry but the extras are still paid for. | 
| Money | From each entry the federation keeps a **fixed amount** (30% of the standard YNE prices, whatever the host charges): £12 for a full power entry, £7.50 for bench only, £4.50 for a sub-junior. Novice, junior, masters and open entries pay the full power amount; a sub-junior pays the sub-junior amount, except in bench only, where everyone (sub-juniors included) pays the bench only amount. The host receives the rest of the entry fee. Merchandise goes wholly to the host and photo packages to the photographer (percentages are set per competition). **The federation absorbs discounts, free places and all payment (Stripe) fees:** the host is still paid on the full entry fee, so a £40 entry with a £20 discount pays the host £28 and leaves the federation £8 down. **The amounts can be changed over time:** the Calendar page holds the defaults new competitions start with, and each competition keeps its own copy (changed on its Money tab), so changing the defaults never alters a past competition's report. Each competition has a Money tab to name the host, change its fixed amounts, see what each person is owed and what is still to send, and record payments sent. The report is for the entries team only. |
| Fair holds | A place is held for 5 minutes (a setting, 5 to 30), with a countdown on the payment page. One lifter, one place: the same email or the same membership number cannot take a second place. |
| Names | Full names on the public entries and waiting lists, as we have always done, with a clear line on the form saying so. |
| Roles | Admin, Entries team, Editor, Contributor (see section 6). The entries team can refund. |
| Places left | A short poll (the page asks "how many places left?" every few seconds). Not live connections. |
| OpenIPF | The form only checks the link looks right. After payment, a background job fetches the lifter's results and stores their best total and GL points. |
| Stripe fees | **The federation absorbs them.** They come out of the federation's share, never the host's or the photographer's. |
| Prime time | One session with two flights (women, men), up to **14 lifters in each**. If bench only lifters are in prime time (unlikely) the same rule as elsewhere applies: up to 20 in a flight. |
| Guardian details | Only asked for, stored and shown when the lifter is **under 18 on the competition day**. |
| Access needs | **Everyone is asked**, and we store the answers so we can help on the day (see section 5). It goes in the privacy policy. |
| Data location | Supabase is in an EU West region (to be confirmed). The UK treats the EU as adequate for personal data, so that is fine. |
| Process | Work on branches. Each piece ends in a pull request with a plain-English summary, a testing checklist and the Vercel preview link. **You merge, I don't.** |

---

## 2. How it fits together

- **The website stays static** (plain HTML, CSS and JavaScript on Vercel). Each competition's page, entry form, entries list and lifting order are **shared template pages** that load their competition from Supabase. Vercel rewrites send the clean addresses (`/competitions/2027/yne-march-open/enter`) to those templates.
- **Supabase** holds the data (Postgres), checks who may see what (row level security) and runs the server-side jobs (Edge Functions and scheduled tasks).
- **Stripe** takes the payment inside our own page (embedded Checkout). Card details never touch us.
- **Resend** sends the emails, from an `@ynepf.co.uk` address (see [email-setup-guide.md](../email-setup-guide.md)).
- **Server-side jobs** (Supabase Edge Functions): create a payment session, receive Stripe's webhook, send emails, look up OpenIPF, offer waiting list places, and a nightly check for anything stuck.

### Addresses

| Address | What it is |
|---|---|
| `/competitions/2027/yne-march-open` | The competition page: details, **Enter** (or **Join the waiting list**), places left |
| `.../enter` and `.../enter/about-you`, `/lifting`, `/extras`, `/check`, `/pay` | The entry form. Each step has its own address, so the browser back button works |
| `.../entered` | Confirmation page (where Stripe returns to) |
| `.../lifting-order` | The list of entries until a lifting order is published, then the lifting order itself. One address throughout |
| `.../waiting-list` | The waiting list (name and position) |
| `/competitions/2027` | That year's competitions |

Old addresses keep working with redirects (`/lifting-order/<slug>`, the YNE Worlds page, and any competition whose name is changed later).

---

## 3. The pieces, in order

The spec's "phase 1" is too big for one pull request. It is split into three. Each piece **works on its own** and ends with something you can click through.

### Phase 1A: take a payment, end to end

The thinnest slice that takes real money safely.

- Entry settings for a competition (events, equipment, capacity, entry opens and closes, price rules, refund cut-off), created from a template.
- The entry form: about you, your lifting, check your answers, pay. Including date of birth, the age category worked out for you, **the under-18 guardian questions and consent from day one**, and the eligibility confirmation.
- Stripe embedded Checkout in our page. Holding a place for 15 minutes while someone pays, so 96 places can never be oversold.
- The confirmation page and the confirmation email, plus a copy to the entries inbox.
- A basic entries list in `/admin`.
- The audit log (who did what, when) from the very start.
- The new roles.

**Demo:** with Stripe **test cards**, enter a competition from start to finish, see it in `/admin`, and receive the email.

### Phase 1B: run the entries desk

Everything the entries team needs to run a competition.

- The full entries table: sort, filter, expand a row, edit any field (logged), cancel and refund, add a manual entry, export CSV.
- Entry stages (priority, qualifier, general, guest), guests and divisions, "can break records".
- Extras: photo packages and merchandise, with images, options and sizes, and stock.
- The public entries list (names, never emails).
- **The money report**: money to send to each payee, what the federation keeps, Stripe fees, and total earnings.
- Reports for White Lights Media (photo orders and the do-not-photograph list) and for hosts (merchandise with sizes).
- Duplicate warnings (same email or BP number twice).

**Demo:** run a pretend competition through every desk task, and see the money report add up.

### Phase 1C: full houses

- The waiting list, and the automatic offers with a 48 hour window, reminders and lapsing.
- The background OpenIPF lookup (best total and GL), and the qualification flags.
- The remaining emails: joined the waiting list, offer, reminder, expired, cancelled.

**Demo:** sell a competition out, join the waiting list, cancel an entry, and watch the offer go out and expire.

**Pilot:** run one YNE competition in 2027 on this, with Square kept as a fallback. Pieces 1A and 1B are enough to start; until 1C is built the waiting list can stay a Google Form.

### Phase 2: lifting order

- The builder: set up days, sessions and flights, **auto sort**, drag and drop with a "Move to…" menu as the keyboard alternative, locks, prime time, timings, lot numbers.
- Publish and unpublish, with an optional email to every entrant.
- The OpenLifter export.
- A test harness with dummy entries and fixed scenarios, so you can review how it sorts and tell me how you would do it differently.

### Phase 3: volunteers, points and priority entry

- Rotas with sign-up, tick-off on the day awarding points, and a points ledger with 24 month expiry.
- Priority entry links emailed to everyone with unexpired points.
- An import of the current points sheet, with a check that nothing was lost.

### Phase 4: ideas only

Results import from OpenLifter, automatic data deletion, QR volunteer sign-in. (Stripe Connect is dropped, because you pay franchises out yourselves.)

---

## 4. The money

### What happens to each payment

Everyone pays **us**, by card, through Stripe. Stripe keeps its fee. After entries close the money is paid out to the people owed it.

| Kind of money | Goes to |
|---|---|
| Entry fees (YNE competitions) | The federation |
| Entry fees (franchise competitions) | The host, less **our cut** (a percentage set per host) |
| Merchandise | 100% to the host |
| Photo packages | 100% to White Lights Media |

These percentages are settings per competition, copied from the host when the competition is created, so a single competition can differ.

### The "money to send" report

For a competition, the report shows one row per payee:

| Payee | Entry money | Merchandise | Photos | Stripe fees | **To send** |
|---|---|---|---|---|---|
| Implexus Gym | £288 | £40 | | | **£328** |
| White Lights Media | | | £30 | | **£30** |
| YNEPF (what we keep) | £72 | | | −£9.05 | **£62.95** |

and a total line: takings, Stripe fees and **total earnings**. A "mark as paid" button records each payout (date and reference).

Things the report handles, all tested:

- **Refunds.** A cancelled or refunded entry is left out of the takings, but **Stripe keeps its fee on a refund**, so that fee still counts as a cost.
- **Pennies.** Shares are whole pence. If a split does not divide evenly (thirds, for example), the leftover penny goes to the biggest share, so the numbers **always add up exactly**.
- **Who pays Stripe's fees.** A setting per competition (see "Still to decide"). The default is that the federation absorbs them.

> **For your treasurer:** this means we hold money that belongs to other people (hosts, White Lights Media) for a few weeks. They should decide whether to keep it in a separate bank account and how it appears in the accounts.

---

## 5. Prices, categories and eligibility

- **Prices** are ordered rules, first match wins ("Sub-junior, any event: £15", "Bench only: £25", "Full power: £40").
- **Age category** is never stored. It is worked out from date of birth and the competition date using the calendar-year rule, every time. (Born 1986 is Masters 1 in 2026. Born 1987 is Masters 1 from 2027.) Tested.
- **Under 18 on the day** is worked out from the exact date, and **only then** the form asks for a parent or guardian's name, phone, email and consent. Adults are never asked, and nothing is stored for them. The details are stored privately, readable only by the entries team, and the entries screen only shows the guardian section for under-18s.
- **Category declaration.** The form asks men's or women's, which decides the weight classes shown. The IPF requires transgender athletes to declare and have IPF approval before competing. The form carries one confirmation tick ("I confirm I'm eligible to compete in this category under IPF rules", linking to the policy) and the line "if you need to talk to us, email us". Wording to be agreed with British Powerlifting.
- **Access needs.** Every lifter is asked, on the entry form: "Is there anything we can do to make the day easier for you?" with prompts for the things that matter on the platform: **hearing** (for example, "I'm hard of hearing and need hand signals or clear commands"), **sight** ("I may need assistance"), and a free box for anything else. Answering is optional, and a short line explains that we store it so we can help on the day, who sees it (the entries team) and how long we keep it. The entries team gets a **printable "support needs" list per competition** for the day. Because this is health information, the form asks the lifter to tick that they agree to us storing it (only when they have entered something). This goes in the privacy policy.
- **Name on the lifting order.** Names are shown in full. The form says so ("your name will be shown on the entries list and the lifting order") and offers an optional **display name** if someone wants it shown differently. We keep the real name for our records.

---

## 6. Who can do what

| | Admin | Entries team | Editor | Contributor |
|---|:-:|:-:|:-:|:-:|
| Manage users and roles | ✔ | | | |
| Competition entry settings, prices, add-ons | ✔ | ✔ | | |
| Entries, waiting list, refunds, manual entries | ✔ | ✔ | | |
| Money reports and payouts | ✔ | ✔ | | |
| Guardian details (under-18s only), access needs | ✔ | ✔ | | |
| Lifting order builder and publishing | ✔ | ✔ | | |
| Create competitions and events (not their entry settings) | ✔ | | ✔ | |
| Site content (Home, FAQs, Organisation, Records, Footer) | ✔ | | ✔ | |
| News posts | ✔ | | ✔ | ✔ |

This is tested at database level: every role is checked against content, news, competitions, entries and private details, so it is enforced by the database and not only by what the editor shows.

> **One thing to know when this is adopted:** the new role rules replace how `is_editor()` is defined today. When we adopt them, they have to be merged **into `supabase/schema.sql` itself**. Otherwise re-running the old file later would quietly undo them. The test caught this.

---

## 7. What the YNE Worlds lifting order tells us

I looked at the real YNE Worlds 2026 lifting order (64 lifters) to see how you actually sequence things:

- **Flights mix several weight classes** (M66, M74 and M83 in one flight). A flight is not "one class".
- **Women's flights are small** and slot between the men's (day 1, session 2: 4 women in flight C, then 13 men in flight D).
- **Day 2 is prime time**: the top women by GL points (14 lifters, GL 78 to 90) then the top men (11 lifters, GL 86 to 99), each in their own flight, across mixed classes.
- Lifters with no GL (new lifters) sit at the start of the first flight.

**How the auto sort will order things** (your description, to be checked in the phase 2 test harness):

- Sessions are **bands of bodyweight, going up through the competition**. Each band holds the women and the men of about the same size, in **separate flights** (women first, set per competition), so women and men are not mixed in a flight.
- Reading your example, it would look like this:

  | Session | Women's flight | Men's flight |
  |---|---|---|
  | 1 (lightest) | 43, 47, 52, 57, 63, 69 | 53, 59, 66 (and 74 if it fits) |
  | 2 (medium) | 76, 84, 84+ | 83, 93 |
  | 3 (heaviest) | | 105, 120, 120+ |

  Inside a flight, lifters are ordered by weight class and then by best total, lowest first, with lifters who have no total in the first flight. The numbers above are an illustration: the real split depends on how many people enter, and keeps each flight within the limits (14 full power, or 20 including bench only).
- **Prime time** is optional per competition. When it is on, it is **one session with two flights**: the top **14 women** and the top **14 men** by best GL points (the setting is how many of each, default 14, maximum 14 for full power). They are taken out of the other sessions.

---

## 8. Money, accounts and who does what

| Thing | Who | When |
|---|---|---|
| Stripe account and Apple Pay domain steps | Treasurer (with a second named person) | Before 1A is switched on for real |
| `@ynepf.co.uk` email address | You, following [email-setup-guide.md](../email-setup-guide.md) | Before 1A is tested |
| Supabase paid plan (backups, no pausing) | Treasurer to budget | Before taking real payments |
| Vercel plan (the free plan is for non-commercial use, and taking payments is a grey area) | Treasurer to budget, or ask Vercel | Before taking real payments |
| Resend paid plan (the free plan stops at 100 emails a day) | Treasurer to budget | Before the first real entry day |
| Daily keep-awake for Supabase | Done, on branch `ops-setup` (merge it) | Now |

I will give you **numbered, plain-English steps** for every one of these when it is time, one at a time.

---

## 9. How this is tested

- **Database:** a scratch Postgres, built from the real `schema.sql`, with checks for permissions (every role against every kind of data), age categories, places left, the audit log and the money report. 40 checks pass for the draft design.
- **Concurrency:** many people entering at once for the last places, so nobody is oversold.
- **Payments:** Stripe **test mode** and test cards only, until you decide to go live. Webhooks are checked for duplicates and bad signatures.
- **Browser:** the entry form end to end, on a phone width, with accessibility checks, as for the rest of the site.
- **Preview first:** every piece is checked on a Vercel preview before you merge it, and database changes go to a **separate test project** first, never straight to the live one.

---

## 10. Still to decide

> Answered since the first draft: Stripe fees (federation pays), prime time (one session, two flights of 14), guardian details (under 18s only), access needs (everyone is asked) and the Supabase region (EU West).

1. **Day order.** Is the picture in section 7 right? (Women and men of similar size share a session, in separate flights.) We will settle the details in the phase 2 test harness, so this does not block phase 1.
2. **Our cut.** The percentage per host (set once per franchise).
3. **Refund cut-off.** The default date (for example, entries closing date, or a set number of days before).
4. **Stripe account owners.** The treasurer and who?
5. **British Powerlifting.** Confirm the category declaration wording.
6. **OpenLifter (phase 2).** I need a real exported file, and the list of division names as set up in your OpenLifter template.
7. **Photo packages.** Confirm White Lights Media is paid 100%, and whether they should receive the order list by email automatically.

---

## 11. Keeping test and live apart

Taking payments means we must be able to **try everything without touching real money or real people's data**. The arrangement:

| | Test | Live |
|---|---|---|
| Supabase | A second project (`ynepf-test`), with made-up data | The current project |
| Stripe | **Test mode** keys and test cards only | Live keys, added only on go-live day, by the treasurer |
| Website | Every **Vercel preview** (each branch) points at the test project | The live site |
| Emails | Go to a test inbox | Go to lifters |

How the website knows which project to use: the site reads its Supabase address and public key from `assets/js/config.js`. I will add a small build step so that Vercel previews write that file from settings (the test project's address and public key), while the live site keeps using the committed file. You will add those settings in Vercel once (steps in [`../setup-guide.md`](../setup-guide.md)).

**Nothing reaches the live database, and no real card is charged, until you say so.**

---

## 12. Risks I am watching

| Risk | What I will do about it |
|---|---|
| Overselling places in the 9am rush | A locked reservation in the database, tested with many simultaneous entries |
| Payment taken but no entry (or the reverse) | A nightly check; the webhook records every Stripe event once |
| Sensitive data leaking | Private details in their own table, readable by the entries team only, never in exports, emails or public views |
| Emails landing in spam | A verified `@ynepf.co.uk` domain, checked before launch |
| Re-running the old `schema.sql` undoing new rules | The new rules are merged into `schema.sql` when adopted |
| Too much at once | Small pieces, each on its own preview, each testable with Stripe test cards |
