// Tests for the automatic waiting list: joining, offers, taking a place, running out, reminders. Run in a scratch Postgres.
//   npm install --no-save @electric-sql/pglite
//   node docs/entry-system/waitlist.test.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
process.on("unhandledRejection", (e) => { console.log("ERROR: " + (e && e.message)); process.exit(1); });
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
 create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid', true),'')::uuid $$;`);
for (const f of ["schema.sql", "entry-system.sql"]) await db.exec(fs.readFileSync(new URL("../../supabase/" + f, import.meta.url), "utf8"));
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n); };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const can = async (sql) => { try { await db.query(sql); return true; } catch { return false; } };
const W = "33333333-3333-3333-3333-333333333333";
const U = { entries: "00000000-0000-0000-0000-00000000000b", editor: "00000000-0000-0000-0000-00000000000c" };
await db.exec(`insert into auth.users (id,email,email_confirmed_at) values ('${U.entries}','entries@example.com',now()),('${U.editor}','editor@example.com',now());
 insert into public.editors (email, role) values ('entries@example.com','entries'),('editor@example.com','editor');
 insert into public.competitions (id,name,start_date,capacity,published,slug,entry_method) values ('${W}','Wait Open','2027-03-13',1,true,'wait-open','yne');
 insert into public.entry_settings (competition_id) values ('${W}');
 insert into public.price_rules (competition_id,sort_order,label,event,age_category,price_pence) values ('${W}',1,'Full power','full_power',null,6000);`);
const wc = (await q(`select id from public.weight_classes where sex='M' and active and label = '83'`))[0]?.id || (await (async () => { await db.exec(`insert into public.weight_classes (sex,label,upper_kg) values ('M','83',83)`); return (await q(`select id from public.weight_classes where sex='M' and label='83'`))[0].id; })());
const home = (await q(`select id from public.divisions where name = 'Yorkshire & North East'`))[0].id;
const good = { division_id: home, club: "Unattached", competition_id: W, full_name: "Alex Lifter", date_of_birth: "1990-06-01", sex: "M", event: "full_power", equipment: "classic", weight_class_id: wc, bp_number: "TBC", eligibility_confirmed: true };
const start = async (o) => { try { return (await q(`select public.start_entry($1::jsonb) r`, [JSON.stringify({ ...good, ...o })]))[0].r; } catch (e) { return { error: e.message }; } };
const call = async (fn, args) => { try { return (await q(`select public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`, args))[0].r; } catch (e) { return { error: e.message }; } };
const join = (email, name = "Person", extra = {}) => call("waitlist_join", [JSON.stringify({ competition_id: W, email, full_name: name, ...extra })]);
const hash = (t) => q(`select encode(sha256(convert_to($1, 'UTF8')), 'hex') h`, [t]).then((r) => r[0].h);
const left = async () => (await q(`select public.places_left('${W}') n`))[0].n;
const sweep = async () => (await q(`select public.waitlist_sweep('${W}') r`))[0].r;
const cands = async () => (await q(`select public.waitlist_candidates('${W}') r`))[0].r;
const wid = async (email) => (await q(`select id from public.waiting_list where competition_id='${W}' and email=$1`, [email]))[0]?.id;
const state = async (email) => (await q(`select status from public.waiting_list where competition_id='${W}' and email=$1`, [email]))[0]?.status;

// one place, free: nobody needs the list
ok((await join("a@x.com")).error === "not_full", "while there is a place, joining the list is refused (just enter)");
ok((await q(`select entries_full f, entry_url u, waitlist_url w from public.competitions_public where id='${W}'`))[0].f === false, "the calendar shows the competition as open while there is a place");

// someone takes the only place: now it is full, and the waiting list opens by itself
const first = await start({ email: "first@x.com" });
ok(first.entry_id && (await left()) === 0, "the last place is held");
const view = (await q(`select entries_full f, entry_url u, waitlist_url w from public.competitions_public where id='${W}'`))[0];
ok(view.f === true && view.u === "" && view.w === "/enter?c=wait-open", "no places left: the calendar says full, and the waiting list link switches on by itself: " + JSON.stringify(view));
ok((await start({ email: "late@x.com" })).error === "full", "a new entry is told it is full");
await db.exec(`update public.entries set status = 'paid', paid_at = now() where id = '${first.entry_id}'`);

// joining
let j = await join("a@x.com", "Ann"); ok(j.position === 1 && j.already === false, "first to join is number 1: " + JSON.stringify(j));
j = await join("b@x.com", "Bea"); ok(j.position === 2, "second is number 2");
j = await join("A@X.com", "Ann Again"); ok(j.position === 1 && j.already === true, "joining twice keeps the same place (and is not case sensitive)");
ok((await join("first@x.com")).error === "already_entered", "someone already entered cannot join");
ok((await join("nope")).error === "invalid:email" && (await join("c@x.com", "")).error === "invalid:full_name", "email and name are checked");
await db.exec(`update public.competitions set entries_closed_manually = true where id = '${W}'`);
ok((await join("c@x.com", "Cat")).error === "closed", "closed means no more joining");
await db.exec(`update public.competitions set entries_closed_manually = false where id = '${W}'`);
ok((await q(`select count(*)::int n from public.waiting_list_public where competition_id='${W}'`))[0].n === 2, "the public list shows names and positions only");

// still full: nobody to offer
ok((await cands()).length === 0, "no place, no offer");

// a place frees up: the longest-waiting person is offered it, and only one
await db.exec(`update public.entries set status = 'cancelled', cancelled_at = now() where id = '${first.entry_id}'`);
ok((await left()) === 1, "a cancellation frees the place");
let c = await cands(); ok(c.length === 1 && c[0].email === "a@x.com", "the person who has waited longest is next: " + JSON.stringify(c));
const tok = "token-for-ann-1234567890", th = await hash(tok);
const exp = await call("waitlist_make_offer", [c[0].waiting_id, th]);
ok(exp && (await state("a@x.com")) === "offered", "the offer is made");
ok((await left()) === 0 && (await cands()).length === 0, "an offered place is held for them: nobody else can take it, and nobody else is offered it");
ok((await start({ email: "late@x.com" })).error === "full", "the public cannot take the offered place");
ok((await call("waitlist_make_offer", [await wid("b@x.com"), await hash("x")])).error?.includes("no_place"), "a second offer is refused when there is no place");
let info = await call("waitlist_offer_info", [JSON.stringify({ competition_id: W, offer: tok })]);
ok(info.ok === true && info.email === "a@x.com" && info.name === "Ann Again", "the offer link is recognised and gives the name and email");
ok((await call("waitlist_offer_info", [JSON.stringify({ competition_id: W, offer: "wrong" })])).ok === false, "a wrong link is not");
ok((await start({ email: "b@x.com", offer: tok })).error === "full", "someone else cannot use Ann's link");
// Ann takes it
let mine = await start({ email: "a@x.com", offer: tok, full_name: "Ann" });
ok(mine.entry_id && (await left()) === 0, "with her link Ann can enter although it is full, and the place is counted once");
const row = (await q(`select source, waiting_id from public.entries where id = '${mine.entry_id}'`))[0];
ok(row.source === "offer" && row.waiting_id === (await wid("a@x.com")), "the entry remembers it came from the waiting list");
ok((await start({ email: "b@x.com" })).error === "full", "still full for everyone else while Ann pays");
// Ann's hold runs out, she tries again with the same link
await db.exec(`update public.entries set hold_expires_at = now() - interval '1 minute' where id = '${mine.entry_id}'`);
ok((await left()) === 0, "her hold ended, but her offer still holds the place");
mine = await start({ email: "a@x.com", offer: tok, full_name: "Ann" });
ok(mine.entry_id, "she can try again with the same link while the offer lasts");
await db.exec(`update public.entries set status = 'paid', paid_at = now() where id = '${mine.entry_id}'`);
ok((await sweep()).length === 0 && (await state("a@x.com")) === "entered", "once she has paid, the list marks her as entered (no 'expired' email)");
ok((await q(`select outcome from public.offers where waiting_id = '${await wid("a@x.com")}'`))[0].outcome === "entered", "and the offer is closed as taken up");

// Bea: offered, does nothing, lapses; the next in line gets the place
await join("d@x.com", "Dee");
await db.exec(`update public.entries set status = 'cancelled' where id = '${mine.entry_id}'`);
c = await cands(); ok(c.length === 1 && c[0].email === "b@x.com", "next in line is Bea (Dee joined after her)");
await call("waitlist_make_offer", [c[0].waiting_id, await hash("bea-token")]);
// halfway: a reminder, once
await db.exec(`update public.offers set expires_at = now() + interval '6 hours' where waiting_id = '${await wid("b@x.com")}'`);
let ev = await sweep(); ok(ev.length === 1 && ev[0].kind === "reminder" && ev[0].email === "b@x.com", "close to the end, one reminder is due: " + JSON.stringify(ev));
ok((await sweep()).length === 0, "and only once");
// ran out
await db.exec(`update public.offers set expires_at = now() - interval '1 minute' where waiting_id = '${await wid("b@x.com")}'`);
ev = await sweep(); ok(ev.length === 1 && ev[0].kind === "expired" && (await state("b@x.com")) === "lapsed", "an offer that runs out lapses and an 'expired' email is due");
ok((await left()) === 1, "the place is free again");
c = await cands(); ok(c.length === 1 && c[0].email === "d@x.com", "and goes to the next person, Dee: " + JSON.stringify(c));
// the email could not be sent: take the offer back
await call("waitlist_make_offer", [c[0].waiting_id, await hash("dee-token")]);
await call("waitlist_unoffer", [c[0].waiting_id]);
ok((await state("d@x.com")) === "waiting" && (await left()) === 1, "if the email fails the offer is taken back and Dee keeps her place in the queue");
// Bea can rejoin, at the back (once the place is taken again)
await db.exec(`update public.competitions set capacity = 0 where id = '${W}'`);
j = await join("b@x.com", "Bea"); ok(j.position === 2 || j.position === 1, "someone whose offer lapsed can join again");
ok((await q(`select status from public.waiting_list where email='b@x.com'`))[0].status === "waiting", "...and is back in the queue");
await db.exec(`update public.competitions set capacity = 1 where id = '${W}'`);

// by hand: offers can be switched off
await db.exec(`update public.entry_settings set offer_automatic = false where competition_id = '${W}'`);
ok((await cands()).length === 0, "if offers are set to manual, nobody is offered automatically");
await db.exec(`update public.entry_settings set offer_automatic = true where competition_id = '${W}'`);
await db.exec(`update public.competitions set entry_closes = now() - interval '1 hour' where id = '${W}'`);
ok((await cands()).length === 0, "after entries close, nobody is offered a place");
await db.exec(`update public.competitions set entry_closes = null where id = '${W}'`);
// more places added: more offers
await db.exec(`update public.competitions set capacity = 3 where id = '${W}'`);
ok((await cands()).length === 2, "adding places means more people are offered (the two still waiting)");

// ---- a place that frees up belongs to the queue: the public cannot grab it before the timer makes the offer
await db.exec("reset role");
const Q = "44444444-4444-4444-4444-444444444444";
await db.exec(`insert into public.competitions (id,name,start_date,capacity,published,slug,entry_method) values ('${Q}','Queue Open','2027-03-13',1,true,'queue-open','yne');
 insert into public.entry_settings (competition_id) values ('${Q}');
 insert into public.price_rules (competition_id,sort_order,label,event,age_category,price_pence) values ('${Q}',1,'Full power','full_power',null,6000);`);
const qstart = async (o) => { try { return (await q(`select public.start_entry($1::jsonb) r`, [JSON.stringify({ ...good, competition_id: Q, ...o })]))[0].r; } catch (e) { return { error: e.message }; } };
const qleft = async (fn) => (await q(`select public.${fn}('${Q}') n`))[0].n;
const qview = async () => (await q(`select entries_full f, entry_url u, waitlist_url w from public.competitions_public where id='${Q}'`))[0];
const e1 = await qstart({ email: "holder@x.com" }); await db.exec(`update public.entries set status='paid', paid_at=now() where id='${e1.entry_id}'`);
await call("waitlist_join", [JSON.stringify({ competition_id: Q, email: "next@x.com", full_name: "Next" })]);
await db.exec(`update public.entries set status = 'cancelled' where id = '${e1.entry_id}'`);
ok((await qleft("places_left")) === 1 && (await qleft("places_open")) === 0, "a place frees up, but it is not open to the public while someone is waiting for it");
const qv = await qview(); ok(qv.f === true && qv.u === "" && qv.w === "/enter?c=queue-open", "so the calendar still says full and offers the waiting list, not Enter now: " + JSON.stringify(qv));
ok((await qstart({ email: "stranger@x.com" })).error === "full", "and a stranger cannot take it in the gap before the offer goes out");
j = await call("waitlist_join", [JSON.stringify({ competition_id: Q, email: "newer@x.com", full_name: "Newer" })]);
ok(j.position === 2, "someone arriving now joins the back of the queue (not told to just enter): " + JSON.stringify(j));
// the queue is served, then empties: Enter now comes back by itself
const qc = (await q(`select public.waitlist_candidates('${Q}') r`))[0].r; ok(qc.length === 1 && qc[0].email === "next@x.com", "the timer offers it to the head of the queue");
await db.exec(`update public.waiting_list set status = 'removed' where competition_id = '${Q}'`);
ok((await qleft("places_open")) === 1, "once nobody is waiting, the free place is open again");
const qv2 = await qview(); ok(qv2.f === false && qv2.u === "/enter?c=queue-open", "and Enter now comes back on the calendar by itself: " + JSON.stringify(qv2));
ok((await qstart({ email: "anyone@x.com" })).entry_id, "anyone can take it");

// ---- priority entry: a list per competition; links are made and sent when the window opens ----
await db.exec("reset role");
const PR = "55555555-5555-5555-5555-555555555555";
await db.exec(`insert into public.competitions (id,name,start_date,capacity,published,slug,entry_method,entry_opens) values ('${PR}','Priority Open','2027-06-12',10,true,'priority-open','yne', now() + interval '3 days');
 insert into public.entry_settings (competition_id) values ('${PR}');
 insert into public.price_rules (competition_id,sort_order,label,event,age_category,price_pence) values ('${PR}',1,'Full power','full_power',null,6000);`);
const pstart = async (o) => { try { return (await q(`select public.start_entry($1::jsonb) r`, [JSON.stringify({ ...good, competition_id: PR, ...o })]))[0].r; } catch (e) { return { error: e.message }; } };
const asUser = async (who, fn) => { await db.exec("reset role"); await db.query(`select set_config('request.uid','${who}',false)`); await db.exec("set role authenticated"); try { return await fn(); } finally { await db.exec("reset role"); } };
const add = (people, who = U.entries) => asUser(who, () => call("priority_add", [PR, JSON.stringify(people)]));
ok((await add([{ email: "vol@x.com", name: "Vol One" }], U.editor)).error?.includes("forbidden"), "only the entries team can build a priority list");
ok((await add([{ email: "not-an-email" }])).error?.includes("invalid:email"), "a bad email is refused, and says which");
ok((await add([{ email: "Vol@X.com", name: "Vol One" }, { email: "vol2@x.com", name: "" }, { email: "vol@x.com", name: "Vol One again" }])) === 2, "people are added without any link yet (a repeat replaces)");
const inv = async () => q(`select email, full_name, token_hash is null as pending, sent_at is not null as sent from public.invites where competition_id = '${PR}' order by email`);
let rowsP = await inv(); ok(rowsP.length === 2 && rowsP.every((r) => r.pending && !r.sent) && rowsP.find((r) => r.email === "vol@x.com").full_name === "Vol One again", "they wait, with no link made: " + JSON.stringify(rowsP));
ok((await q(`select public.priority_competitions() r`))[0].r.length === 0, "entry opens in 3 days, priority starts 24 hours before: nothing is due yet");
await db.exec(`update public.entry_settings set priority_hours = 96 where competition_id = '${PR}'`);
ok((await q(`select public.priority_competitions() r`))[0].r.includes(PR), "set the window to 96 hours and the links are due now");
const pend = (await q(`select public.priority_pending('${PR}') r`))[0].r; ok(pend.length === 2, "the timer would send to both");
const ptok = "priority-token-1234567890";
await call("priority_issue", [pend[0].id, await hash(ptok), false]);
ok((await q(`select public.priority_pending('${PR}') r`))[0].r.length === 1, "once issued, a person is no longer waiting");
ok((await call("priority_issue", [pend[0].id, await hash("x"), false])).error?.includes("not_waiting"), "a link is not made twice by accident");
ok((await pstart({ email: pend[0].email, invite: ptok })).entry_id, "with the link, they can enter before general entry opens (here 3 days early, inside the 96 hour window)");
ok((await pstart({ email: "someone@else.com", invite: ptok })).error === "not_open", "someone else cannot use that person's link");
await db.exec(`update public.entry_settings set priority_hours = 24 where competition_id = '${PR}'`);
await db.exec(`update public.entries set status = 'cancelled' where competition_id = '${PR}'`);
ok((await pstart({ email: pend[0].email, invite: ptok })).error === "not_open", "outside the window the link does not work yet");
await db.exec(`update public.entry_settings set priority_hours = 96 where competition_id = '${PR}'`);
await call("priority_issue", [pend[0].id, await hash("new-token-abcdef"), true]);
ok((await pstart({ email: pend[0].email, invite: ptok })).error === "not_open", "re-sending replaces the old link");
ok((await pstart({ email: pend[0].email, invite: "new-token-abcdef" })).entry_id, "and the new one works");
await call("priority_unissue", [pend[1].id]);
rowsP = await inv(); ok(rowsP.find((r) => r.email === pend[1].email).pending, "an email that failed to send goes back to waiting, to be tried again");

// who may do what
await db.exec("set role anon");
ok(!(await can(`select public.waitlist_join('{}'::jsonb)`)) && !(await can(`select public.waitlist_sweep('${W}')`)) && !(await can(`select public.waitlist_make_offer('${W}'::uuid, 'x')`)), "the public cannot call the waiting list functions (only our server can)");
await db.exec("reset role");
const target = await wid("d@x.com");
await db.query(`select set_config('request.uid','${U.editor}',false)`); await db.exec("set role authenticated");
ok(!(await can(`select public.waitlist_remove('${target}')`)), "an editor cannot remove someone from the list");
await db.exec("reset role"); await db.query(`select set_config('request.uid','${U.entries}',false)`); await db.exec("set role authenticated");
ok(await can(`select public.waitlist_remove('${target}')`), "the entries team can");
await db.exec("reset role");
ok((await state("d@x.com")) === "removed" && (await cands()).every((x) => x.email !== "d@x.com"), "a removed person is never offered a place");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
