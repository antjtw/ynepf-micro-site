// Tests for the pure helpers in the payment functions (signature check, error words, email text).
//   node --experimental-strip-types docs/entry-system/functions.test.mjs
import crypto from "node:crypto";
import assert from "node:assert";
const wh = await import("../../supabase/functions/stripe-webhook/index.ts");
const co = await import("../../supabase/functions/entry-checkout/index.ts");
const secret = "whsec_test", body = '{"id":"evt_1"}', t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
assert(await wh.verifySignature(body, `t=${t},v1=${sig}`, secret), "good signature accepted");
assert(!(await wh.verifySignature(body + " ", `t=${t},v1=${sig}`, secret)), "tampered body refused");
assert(!(await wh.verifySignature(body, `t=${t},v1=${sig}`, "other")), "wrong secret refused");
assert(!(await wh.verifySignature(body, `t=${t},v1=${sig}`, secret, Date.now() + 600000)), "old message refused");
assert(!(await wh.verifySignature(body, "nonsense", secret)), "garbage refused");
assert.equal(co.errorCode("P0001: ERROR: invalid:guardian\nCONTEXT: x"), "invalid:guardian");
assert.equal(co.errorCode("boom"), "unknown");
assert(wh.confirmationEmail({ name: "A", competition: "C", date: "d", event: "e", equipment: "q", pence: 6000, under18: true, entriesEmail: "x" }).includes("parent or guardian must be with you"));
assert(!wh.confirmationEmail({ name: "A", competition: "C", date: "d", event: "e", equipment: "q", pence: 6000, under18: false, entriesEmail: "x" }).includes("parent or guardian"));
assert(wh.confirmationEmail({ name: "A", competition: "C", date: "d", event: "e", equipment: "q", pence: 6000, under18: false, entriesEmail: "x", refundsUntil: "Saturday 20 February 2027 at 12:00" }).includes("Refunds are available until entries close on Saturday 20 February 2027"), "refund rule is in the email");
assert(co.MESSAGES.duplicate_bp && co.MESSAGES["invalid:openipf"], "new error words exist");
assert.equal(wh.ageCategory(2010, 2027), "Sub-junior"); assert.equal(wh.ageCategory(2008, 2027), "Junior"); assert.equal(wh.ageCategory(1990, 2027), "Open");
assert.equal(wh.ageCategory(1987, 2027), "Masters 1 (M1)"); assert.equal(wh.ageCategory(1977, 2027), "Masters 2 (M2)"); assert.equal(wh.ageCategory(1950, 2027), "Masters 4 (M4)");
assert.equal(wh.exactAge("2009-12-31", "2027-03-13"), 17, "17 on the day, although a sub-junior by year (turns 18 in 2027)");
assert(wh.confirmationEmail({ name: "A", competition: "C", date: "d", event: "e", equipment: "q", pence: 6000, under18: false, entriesEmail: "x", category: "Masters 2 (M2)" }).includes("Category: Masters 2 (M2)"), "category in the email");
// ---- the club list importer, on small samples shaped like the two websites
const sc = await import("../../supabase/functions/sync-clubs/index.ts");
const cell = (c) => `<td class="x wixui-table__cell"><div class="a"><div class="g0">${c}</div></div></td>`;
const epaHtml = `<table><tr>${cell("IronHQ ")}${cell("Club Contact: Luke Club Email: a@b.co Club Phone: 07")}</tr><tr>${cell("Roundy Strength &amp; Fitness")}${cell("Message Details: Club Contact: Dane")}</tr><tr>${cell("Not a club")}${cell("Something else")}</tr></table>`;
assert.deepEqual(sc.parseEpaAffiliated(epaHtml), ["IronHQ", "Roundy Strength & Fitness"], "EPA names only, entities decoded, other rows ignored");
assert(co.formEncode(co.sessionParams({ entryId: "e", email: "a@b.co", name: "A", pence: 100, competition: "C", siteUrl: "https://x.y", expiresAt: 1, slug: "2027-test" })).includes(encodeURIComponent("https://x.y/entry-thanks?c=2027-test&session_id={CHECKOUT_SESSION_ID}")), "thanks page link carries the competition");
const es = await import("../../supabase/functions/entry-status/index.ts");
assert.equal(es.statusFrom([]), "unknown", "no such payment"); assert.equal(es.statusFrom([{ status: "pending", entries: { status: "held" } }]), "pending", "not confirmed yet");
assert.equal(es.statusFrom([{ status: "succeeded", entries: { status: "paid" } }]), "paid"); assert.equal(es.statusFrom([{ status: "succeeded", entries: [{ status: "comped" }] }]), "paid", "joined rows can come as a list");
assert.equal(es.statusFrom([{ status: "succeeded", entries: { status: "refunded" } }]), "refunded");
assert(es.validSession("cs_test_a1B2c3D4e5") && !es.validSession("../etc") && !es.validSession("cs_"), "only real-looking session ids are looked up");
const rf = await import("../../supabase/functions/entry-refund/index.ts");
const P = (o) => rf.refundPlan({ entryStatus: "paid", paidPence: 4000, refundedPence: 0, refundPence: 0, cancel: true, ...o });
assert.deepEqual([P({ refundPence: 4000 }).finalStatus, P({ refundPence: 4000 }).refundPence], ["refunded", 4000], "a full refund ends the entry as refunded");
assert.equal(P({ refundPence: 1000, cancel: true }).finalStatus, "cancelled", "a part refund and cancel: cancelled");
assert.equal(P({ refundPence: 1000, cancel: false }).finalStatus, "paid", "a goodwill part refund keeps the entry");
assert.equal(P({ refundPence: 0, cancel: true }).finalStatus, "cancelled", "cancel with no refund");
assert.equal(P({ refundPence: 4000, cancel: false }).finalStatus, "refunded", "refunding everything always ends the entry, even if cancel was not asked for");
assert.equal(P({ refundPence: 3500, refundedPence: 1000 }).error, "That is more than is left to refund (30.00 pounds).", "cannot refund more than is left");
assert.equal(P({ refundPence: 3000, refundedPence: 1000 }).finalStatus, "refunded", "the last of the money ends it");
assert(P({ refundPence: 0, cancel: false }).error, "nothing to do is refused");
assert(P({ entryStatus: "cancelled", refundPence: 100 }).error && P({ entryStatus: "refunded" }).error, "an already cancelled or refunded entry cannot be changed again");
assert(P({ entryStatus: "comped", refundPence: 100 }).error, "a free entry has no payment to refund"); assert.equal(P({ entryStatus: "comped", paidPence: 0 }).finalStatus, "cancelled", "a free entry can be cancelled");
assert(P({ refundPence: -5 }).error && P({ refundPence: 12.5 }).error, "only whole positive pence");
assert(rf.refundEmail({ name: "A", competition: "C", refundedPence: 4000, cancelled: true, reason: "Injury", entriesEmail: "x" }).includes("refunded £40.00 to the card"), "refund email");
// the confirmation email is the same whichever function sends it (a paid entry or a free one)
const sample = { name: "A", competition: "C", date: "2027-05-15", event: "Full power", equipment: "Classic", pence: 4000, under18: false, entriesEmail: "x@y.co", category: "Open", division: "South West (guest)", club: "Implexus Gym", discountPence: 2000, refundsUntil: "Saturday" };
assert.equal(co.confirmationEmail(sample), wh.confirmationEmail(sample), "both functions write the same email");
assert(co.confirmationEmail(sample).includes("Discount applied: £20.00 off") && co.confirmationEmail({ ...sample, discountPence: 0 }).indexOf("Discount") < 0, "the discount shows only when there is one");
assert(co.MESSAGES.discount_used && co.MESSAGES.discount_expired && co.MESSAGES.discount_not_yours && co.MESSAGES.discount_invalid, "plain words for each discount problem");
const t0 = 1_000_000; let allowed = 0; for (let i = 0; i < 12; i++) if (co.allowTry("1.2.3.4|a@b.co", t0 + i)) allowed++;
assert.equal(allowed, 8, "only 8 discount code checks in 10 minutes per address, so codes cannot be guessed"); assert(co.allowTry("1.2.3.4|a@b.co", t0 + 11 * 60 * 1000), "...and it frees up again after the window"); assert(co.allowTry("9.9.9.9|z@b.co", t0), "other addresses are not affected");
assert(es.validEntry("123e4567-e89b-12d3-a456-426614174000") && !es.validEntry("1; drop table"), "entry ids are checked");

{ // extras: separate lines on the payment page, and in both confirmation emails
  const sp = co.sessionParams({ entryId: "e", email: "a@b.co", name: "A", pence: 10049, competition: "C", siteUrl: "https://x.y", expiresAt: 1, extras: [{ name: "Photo package", pence: 4049 }] });
  assert.strictEqual(sp["line_items[0][price_data][unit_amount]"], 6000, "the entry line is the total less the extras");
  assert.strictEqual(sp["line_items[1][price_data][unit_amount]"], 4049); assert.strictEqual(sp["line_items[1][price_data][product_data][name]"], "Photo package");
  assert.strictEqual(sp["line_items[0][price_data][unit_amount]"] + sp["line_items[1][price_data][unit_amount]"], 10049, "the lines add up to the total charged");
  assert.strictEqual(co.sessionParams({ entryId: "e", email: "a@b.co", name: "A", pence: 6000, competition: "C", siteUrl: "https://x.y", expiresAt: 1 })["line_items[0][price_data][unit_amount]"], 6000, "no extras: unchanged");
  const m = { name: "A", competition: "C", date: "d", event: "e", equipment: "q", pence: 10049, under18: false, entriesEmail: "x", extras: [{ name: "T-shirt", option: "Medium", pence: 2000 }, { name: "Photo package", pence: 4049 }] };
  for (const mod of [co, wh]) { const t = mod.confirmationEmail(m); assert(t.includes("Extra: T-shirt (Medium), £20.00") && t.includes("Extra: Photo package, £40.49") && t.includes("Paid: £100.49"), "extras are listed in the email"); }
  assert(!co.confirmationEmail({ ...m, extras: undefined }).includes("Extra:"), "no extras, no extra lines");
}

{ // waiting list function helpers
  const wl = await import("../../supabase/functions/waitlist/index.ts");
  const tok = wl.newToken();
  assert(/^[0-9a-f]{48}$/.test(tok) && tok !== wl.newToken(), "offer tokens are long and random");
  assert.strictEqual(await wl.sha256Hex("abc"), crypto.createHash("sha256").update("abc").digest("hex"), "the hash matches what the database computes (sha256 hex)");
  assert.strictEqual(wl.offerLink("https://www.ynepf.co.uk/", "2027-test open", "tok"), "https://www.ynepf.co.uk/enter?c=2027-test%20open&offer=tok", "the personal link");
  const who = { name: "Ann", competition: "Spring Open", date: "13 March 2027", entriesEmail: "e@x.co" };
  assert(wl.joinedEmail({ ...who, position: 3, hours: 48 }).includes("number 3") && wl.joinedEmail({ ...who, position: 3, hours: 48 }).includes("48 hours"), "joined email");
  const o = wl.offerEmail({ ...who, link: "https://x/enter?c=a&offer=b", expiresAt: "2027-01-02T12:00:00Z" });
  assert(o.includes("https://x/enter?c=a&offer=b") && /Saturday,? 2 January 2027 at 12:00/.test(o), "offer email has the link and the deadline in UK time: " + o);
  assert(wl.reminderEmail({ ...who, expiresAt: "2027-07-02T12:00:00Z", slug: "a", siteUrl: "https://x" }).includes("2 July 2027 at 13:00"), "summer deadlines are shown in British Summer Time");
  assert(wl.expiredEmail({ ...who, slug: "a", siteUrl: "https://x/" }).includes("https://x/enter?c=a"), "expired email says how to rejoin");
  assert.strictEqual(wl.errorCode("ERROR: not_full\nCONTEXT"), "not_full"); assert.strictEqual(wl.errorCode("boom"), "unknown");
  let n = 0; for (let i = 0; i < 10; i++) if (wl.allowTry("k", 1000)) n++; assert.strictEqual(n, 6, "joining is rate limited");
}
console.log("function helper tests passed");
