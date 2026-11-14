// The automatic waiting list. Three jobs, chosen by "action" in the request:
//
//   join   Someone joins the waiting list for a full competition (name and email). They get an email with their place in the queue.
//   offer  The entry page asks "does this offer link work?" and, if so, gets the name and email to fill in.
//   run    Looks after every waiting list: ends offers that ran out (and emails), sends the one reminder, and offers
//          free places to the people who have waited longest (and emails them a personal link). It also emails priority
//          entry links to everyone on a competition's priority list once the priority window opens. It is run on a timer
//          (see docs/entry-system/schedule-waitlist.sql) and by the entries team's "Check now" button.
//   priority_send  The entries team sends priority links now (to one person or everyone still waiting), or sends a fresh link to someone.
//
// ONE self-contained file: paste it in as index.ts. Deploy with "Verify JWT" switched OFF (the checks are inside).
//
// Secrets: RESEND_API_KEY, MAIL_FROM, NOTIFY_TO, SITE_URL (as the other functions), and a new one, CRON_SECRET: any long random
// text. The timer sends it so only the timer (or a signed-in entries team member) can run the list.
// Supabase fills in SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY by itself.

export const MESSAGES: Record<string, string> = {
  closed: "Entries for this competition are closed, so the waiting list is closed too.",
  not_full: "There are places left, so you can enter now instead of joining the waiting list.",
  already_entered: "You have already entered this competition. Check your email for the confirmation.",
  "invalid:email": "Please check your email address.",
  "invalid:full_name": "Please enter your full name.",
};

export function errorCode(message: string): string {
  const m = String(message ?? "").replace(/^.*?ERROR:\s*/s, "").split("\n")[0].trim();
  return m in MESSAGES ? m : "unknown";
}

// A long random value for the personal link. Only its hash is kept in the database.
export function newToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" });
}
export const offerLink = (siteUrl: string, slug: string, token: string) => `${siteUrl.replace(/\/$/, "")}/enter?c=${encodeURIComponent(slug)}&offer=${encodeURIComponent(token)}`;

type Who = { name: string; competition: string; date?: string; entriesEmail: string };
const sign = (o: Who, more: string[] = []) => [...more, "", `If you have any questions, reply to this email or write to ${o.entriesEmail}.`, "", "YNEPF"].join("\n");

export function joinedEmail(o: Who & { position: number; hours: number }) {
  return sign(o, [
    `Hi ${o.name},`, "",
    `You are on the waiting list for ${o.competition}${o.date ? ` (${o.date})` : ""}. You are number ${o.position} in the queue.`, "",
    `If a place becomes free we will email you a personal link and you will have ${o.hours} hours to use it. You do not need to do anything now.`,
    "If you no longer want a place, you can ignore any email we send you and the place will pass to the next person.",
  ]);
}
export function offerEmail(o: Who & { link: string; expiresAt: string }) {
  return sign(o, [
    `Hi ${o.name},`, "",
    `Good news: a place has come up in ${o.competition}${o.date ? ` (${o.date})` : ""} and it is being held for you.`, "",
    `Enter here: ${o.link}`, "",
    `The place is yours until ${when(o.expiresAt)} (UK time). After that it goes to the next person on the waiting list.`,
    "The link is for you only, so please do not share it. Your entry is only confirmed once you have completed the form and paid.",
  ]);
}
export function reminderEmail(o: Who & { expiresAt: string; slug: string; siteUrl: string }) {
  return sign(o, [
    `Hi ${o.name},`, "",
    `A reminder: the place being held for you in ${o.competition} runs out on ${when(o.expiresAt)} (UK time).`, "",
    "Use the personal link in our earlier email to enter. If you no longer want the place, you do not need to do anything and it will pass to the next person.",
  ]);
}
export function expiredEmail(o: Who & { slug: string; siteUrl: string }) {
  return sign(o, [
    `Hi ${o.name},`, "",
    `The place we were holding for you in ${o.competition} has now gone to the next person on the waiting list, because it was not taken up in time.`, "",
    `If you still want to enter, you can join the waiting list again at ${o.siteUrl.replace(/\/$/, "")}/enter?c=${encodeURIComponent(o.slug)} and you will be added to the back of the queue.`,
  ]);
}

export function priorityEmail(o: Who & { link: string; windowStart: string; opens?: string }) {
  return sign(o, [
    `Hi ${o.name || "there"},`, "",
    `You can enter ${o.competition}${o.date ? ` (${o.date})` : ""} early, with priority entry.`, "",
    `Your personal link works from ${when(o.windowStart)} (UK time)${o.opens ? `, before general entry opens on ${when(o.opens)}` : ""}:`,
    o.link, "",
    "Please enter with the email address this message was sent to, and keep the link to yourself: it only works once. You can still enter when general entry opens if you would rather wait.",
  ]);
}

// Joining is limited so the list cannot be flooded: a handful of tries per address, per few minutes.
const tries: Record<string, number[]> = {};
export function allowTry(key: string, now = Date.now(), max = 6, windowMs = 10 * 60 * 1000): boolean {
  const list = (tries[key] = (tries[key] ?? []).filter((t) => now - t < windowMs));
  if (list.length >= max) return false;
  list.push(now); return true;
}

if (typeof Deno !== "undefined") {
  Deno.serve(async (req: Request) => {
    const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
    const cors = { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, apikey, authorization, x-cron-secret", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" };
    const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

    const url = Deno.env.get("SUPABASE_URL"), svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), anon = Deno.env.get("SUPABASE_ANON_KEY") ?? svc;
    const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    if (!url || !svc || !siteUrl) { console.error("function is not configured"); return reply(500, { error: "not_configured" }); }
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply(400, { error: "bad_request" }); }

    const H = { apikey: svc, authorization: `Bearer ${svc}`, "content-type": "application/json" };
    const rpc = (fn: string, args: Record<string, unknown>) => fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
    const from = Deno.env.get("MAIL_FROM") ?? "YNEPF <onboarding@resend.dev>", copy = Deno.env.get("NOTIFY_TO") ?? "ynepfentries@gmail.com";
    const send = async (to: string, subject: string, text: string): Promise<boolean> => {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], reply_to: copy, subject, text }) });
      if (!r.ok) console.error("Resend failed", r.status);
      return r.ok;
    };
    const comp = async (id: string) => {
      const r = await fetch(`${url}/rest/v1/competitions?id=eq.${encodeURIComponent(id)}&select=id,name,slug,start_date,entry_opens`, { headers: H });
      const [c] = await r.json().catch(() => []);
      return c as { id: string; name: string; slug: string; start_date: string; entry_opens: string | null } | undefined;
    };
    const dateText = (d?: string) => d ? new Date(d).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "long" }) : undefined;
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0];
    const action = String(body.action ?? "");

    // Makes each person's personal link (only its hash is kept) and emails it. If the email fails the person goes back to
    // "waiting to be sent" and the next check tries again.
    const sendPriority = async (c: { id: string; name: string; slug: string; start_date: string; entry_opens: string | null }, people: { id: string; email: string; name: string }[], force: boolean) => {
      const sres = await fetch(`${url}/rest/v1/entry_settings?competition_id=eq.${encodeURIComponent(c.id)}&select=priority_hours`, { headers: H });
      const [st] = await sres.json().catch(() => []);
      const hours = Number(st?.priority_hours ?? 24);
      const windowStart = c.entry_opens ? new Date(new Date(c.entry_opens).getTime() - hours * 3600 * 1000).toISOString() : new Date().toISOString();
      let sent = 0, failed = 0;
      for (const p of people) {
        const tok = newToken();
        const iss = await rpc("priority_issue", { iid: p.id, th: await sha256Hex(tok), force });
        if (!iss.ok) { console.error("priority link not made", await iss.text()); failed++; continue; }
        const ok = await send(p.email, `Your priority entry link: ${c.name}`, priorityEmail({ name: p.name, competition: c.name, date: dateText(c.start_date), entriesEmail: copy, link: offerLink(siteUrl, c.slug, tok).replace("&offer=", "&invite="), windowStart, opens: c.entry_opens ?? undefined }));
        if (ok) sent++; else { failed++; await rpc("priority_unissue", { iid: p.id }); }
      }
      return { sent, failed };
    };

    // ---- someone joins ----------------------------------------------------------------------------------------
    if (action === "join") {
      if (!allowTry(ip + "|" + String(body.email ?? "").toLowerCase())) return reply(429, { error: "slow_down", message: "Too many tries. Please wait a few minutes and try again." });
      // A signed-in entries team member may join an unpublished (test) competition. Decided here from their login.
      let allowUnpublished = false;
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (token && token !== anon && body.preview === true) {
        const who = await fetch(`${url}/rest/v1/rpc/is_entries`, { method: "POST", headers: { apikey: anon!, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
        if (who.ok && (await who.json()) === true) allowUnpublished = true;
      }
      const r = await rpc("waitlist_join", { p: { competition_id: body.competition_id, email: body.email, full_name: body.full_name, allow_unpublished: allowUnpublished } });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = errorCode(out?.message ?? "");
        if (code === "unknown") { console.error("waitlist_join failed", JSON.stringify(out)); return reply(500, { error: "failed", message: "Sorry, something went wrong. Please try again." }); }
        return reply(422, { error: code, message: MESSAGES[code] });
      }
      const c = await comp(String(body.competition_id));
      if (c && !out.already) {
        await send(String(body.email).trim().toLowerCase(), `You are on the waiting list: ${c.name}`,
          joinedEmail({ name: String(body.full_name).trim(), competition: c.name, date: dateText(c.start_date), entriesEmail: copy, position: out.position, hours: out.window_hours ?? 48 }));
      }
      return reply(200, { ok: true, position: out.position, already: !!out.already });
    }

    // ---- does this offer link work? ---------------------------------------------------------------------------------
    if (action === "offer") {
      if (!allowTry(ip + "|offer", Date.now(), 30)) return reply(429, { ok: false, message: "Too many tries. Please wait a few minutes and try again." });
      const r = await rpc("waitlist_offer_info", { p: { competition_id: body.competition_id, offer: body.offer } });
      const out = await r.json().catch(() => ({ ok: false }));
      return reply(200, r.ok ? out : { ok: false });
    }

    // ---- look after the lists ---------------------------------------------------------------------------------------
    if (action === "run") {
      const secret = Deno.env.get("CRON_SECRET") ?? "";
      let allowed = !!secret && req.headers.get("x-cron-secret") === secret;
      if (!allowed) {
        const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (token && token !== anon) {
          const who = await fetch(`${url}/rest/v1/rpc/is_entries`, { method: "POST", headers: { apikey: anon!, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
          allowed = who.ok && (await who.json()) === true;
        }
      }
      if (!allowed) return reply(401, { error: "not_allowed" });

      const listRes = await rpc("waitlist_competitions", {});
      let ids: string[] = await listRes.json().catch(() => []);
      if (body.competition_id) ids = ids.filter((i) => i === body.competition_id);
      const done = { offers: 0, reminders: 0, expired: 0, failed: 0, priority: 0 };
      for (const id of ids) {
        const c = await comp(id);
        if (!c) continue;
        const who = (name: string) => ({ name, competition: c.name, date: dateText(c.start_date), entriesEmail: copy });
        // 1. offers that ran out, and reminders
        const events: { kind: string; email: string; name: string; expires_at: string }[] = await (await rpc("waitlist_sweep", { c: id })).json().catch(() => []);
        for (const e of Array.isArray(events) ? events : []) {
          if (e.kind === "expired") { if (await send(e.email, `Your place has gone to the next person: ${c.name}`, expiredEmail({ ...who(e.name), slug: c.slug, siteUrl }))) done.expired++; else done.failed++; }
          if (e.kind === "reminder") { if (await send(e.email, `Reminder: your place is held until ${when(e.expires_at)}`, reminderEmail({ ...who(e.name), expiresAt: e.expires_at, slug: c.slug, siteUrl }))) done.reminders++; else done.failed++; }
        }
        // 2. offer free places to the longest-waiting
        const next: { waiting_id: string; email: string; name: string }[] = await (await rpc("waitlist_candidates", { c: id })).json().catch(() => []);
        for (const n of Array.isArray(next) ? next : []) {
          const tok = newToken();
          const mk = await rpc("waitlist_make_offer", { wid: n.waiting_id, token_hash: await sha256Hex(tok) });
          if (!mk.ok) { console.error("offer not made", await mk.text()); continue; }
          const expiresAt = String(await mk.json());
          const sent = await send(n.email, `A place has come up: ${c.name}`, offerEmail({ ...who(n.name), link: offerLink(siteUrl, c.slug, tok), expiresAt }));
          if (sent) { done.offers++; await send(copy, `Offered a place: ${n.name} (${c.name})`, `A place in ${c.name} was offered to ${n.name} (${n.email}) from the waiting list. They have until ${when(expiresAt)}.`); }
          else { done.failed++; await rpc("waitlist_unoffer", { wid: n.waiting_id }); }   // keep their place in the queue; try again next time
        }
      }
      // Priority entry links for competitions whose priority window has opened.
      if (!body.competition_id) {
        const pids: string[] = await (await rpc("priority_competitions", {})).json().catch(() => []);
        for (const id of Array.isArray(pids) ? pids : []) {
          const c = await comp(id); if (!c) continue;
          const people: { id: string; email: string; name: string }[] = await (await rpc("priority_pending", { c: id })).json().catch(() => []);
          const r = await sendPriority(c, Array.isArray(people) ? people : [], false);
          done.priority += r.sent; done.failed += r.failed;
        }
      }
      return reply(200, { ok: true, ...done });
    }

    // ---- the entries team sends priority links now ------------------------------------------------------------------
    if (action === "priority_send") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      let allowed = false;
      if (token && token !== anon) {
        const who = await fetch(`${url}/rest/v1/rpc/is_entries`, { method: "POST", headers: { apikey: anon!, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
        allowed = who.ok && (await who.json()) === true;
      }
      if (!allowed) return reply(401, { error: "not_allowed" });
      const c = await comp(String(body.competition_id ?? ""));
      if (!c) return reply(404, { error: "not_found" });
      const only = body.invite_id ? String(body.invite_id) : null;
      const people: { id: string; email: string; name: string }[] = await (await rpc("priority_pending", { c: c.id, only_id: only, include_sent: !!only })).json().catch(() => []);
      const r = await sendPriority(c, Array.isArray(people) ? people : [], !!only);
      return reply(200, { ok: true, ...r });
    }

    return reply(400, { error: "bad_request" });
  });
}
