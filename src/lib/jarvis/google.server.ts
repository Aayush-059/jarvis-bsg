// Google Calendar + Gmail through the Lovable connector gateway. Server-only.
const CAL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const MAIL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

type Result = { ok: boolean; reason?: string; [k: string]: unknown };

function headers(connKeyName: "GOOGLE_CALENDAR_API_KEY" | "GOOGLE_MAIL_API_KEY") {
  const lovable = process.env["LOVABLE_API_KEY"];
  const conn = process.env[connKeyName];
  if (!lovable || !conn) return null;
  return { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": conn, "Content-Type": "application/json" };
}

/** fetch with bounded exponential backoff for 429/5xx only. */
async function gw(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  let last = { ok: false, status: 0, data: null as any, text: "network error" };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, init);
      const text = await r.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* non-json */ }
      last = { ok: r.ok, status: r.status, data, text };
      if (r.ok || (r.status !== 429 && r.status < 500)) return last;
    } catch {
      /* network failure: retry */
    }
    await new Promise((res) => setTimeout(res, 400 * 2 ** attempt + Math.random() * 200));
  }
  return last;
}

function fail(what: string, r: { status: number; text: string }): Result {
  console.error(`${what} failed [${r.status}]: ${r.text.slice(0, 500)}`);
  return { ok: false, reason: `${what} failed (Google said ${r.status || "no response"}).` };
}

export async function listEvents(days: number): Promise<Result> {
  const h = headers("GOOGLE_CALENDAR_API_KEY");
  if (!h) return { ok: false, reason: "Google Calendar is not connected." };
  const now = new Date();
  const until = new Date(now.getTime() + Math.min(Math.max(days, 1), 30) * 86400000);
  const q = new URLSearchParams({ timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "25" });
  const r = await gw(`${CAL}/calendars/primary/events?${q}`, { headers: h });
  if (!r.ok) return fail("Reading your calendar", r);
  return {
    ok: true,
    events: (r.data.items ?? []).map((e: any) => ({
      id: e.id,
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
      allDay: !!e.start?.date,
      location: e.location,
    })),
    note: "All-day events: end date is exclusive.",
  };
}

export async function createEvent(input: { summary: string; start: string; end: string; description?: string | undefined; timeZone?: string | undefined }): Promise<Result> {
  const h = headers("GOOGLE_CALENDAR_API_KEY");
  if (!h) return { ok: false, reason: "Google Calendar is not connected." };
  if (Number.isNaN(Date.parse(input.start)) || Number.isNaN(Date.parse(input.end))) return { ok: false, reason: "Start or end time is not a valid date." };
  if (Date.parse(input.end) <= Date.parse(input.start)) return { ok: false, reason: "End must be after start." };
  const tz = input.timeZone || "Asia/Kathmandu";
  const r = await gw(`${CAL}/calendars/primary/events`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ summary: input.summary, description: input.description, start: { dateTime: input.start, timeZone: tz }, end: { dateTime: input.end, timeZone: tz } }),
  });
  if (!r.ok) return fail("Creating the event", r);
  // Verify against real state: read it back.
  const check = await gw(`${CAL}/calendars/primary/events/${encodeURIComponent(r.data.id)}`, { headers: h });
  const verified = check.ok && check.data?.status !== "cancelled";
  return { ok: verified, verified, id: r.data.id, link: r.data.htmlLink, ...(verified ? {} : { reason: "Google accepted it, but I couldn't confirm the event exists." }) };
}

function header(msg: any, name: string) {
  return msg?.payload?.headers?.find((x: any) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function searchEmail(query: string, max: number): Promise<Result> {
  const h = headers("GOOGLE_MAIL_API_KEY");
  if (!h) return { ok: false, reason: "Gmail is not connected." };
  const q = new URLSearchParams({ q: query || "in:inbox", maxResults: String(Math.min(Math.max(max, 1), 10)) });
  const list = await gw(`${MAIL}/users/me/messages?${q}`, { headers: h });
  if (!list.ok) return fail("Searching email", list);
  const ids: string[] = (list.data.messages ?? []).map((m: any) => m.id);
  const metas = await Promise.all(
    ids.map((id) => gw(`${MAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: h })),
  );
  return {
    ok: true,
    emails: metas.filter((m) => m.ok).map((m) => ({
      id: m.data.id,
      from: header(m.data, "From"),
      subject: header(m.data, "Subject"),
      date: header(m.data, "Date"),
      unread: (m.data.labelIds ?? []).includes("UNREAD"),
      snippet_untrusted: m.data.snippet,
    })),
  };
}

function decodeBody(part: any): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    const b64 = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  }
  for (const p of part.parts ?? []) {
    const t = decodeBody(p);
    if (t) return t;
  }
  return "";
}

export async function readEmail(id: string): Promise<Result> {
  const h = headers("GOOGLE_MAIL_API_KEY");
  if (!h) return { ok: false, reason: "Gmail is not connected." };
  if (!/^[a-zA-Z0-9]+$/.test(id)) return { ok: false, reason: "Invalid email id." };
  const r = await gw(`${MAIL}/users/me/messages/${id}?format=full`, { headers: h });
  if (!r.ok) return fail("Reading the email", r);
  return {
    ok: true,
    from: header(r.data, "From"),
    subject: header(r.data, "Subject"),
    date: header(r.data, "Date"),
    // Email bodies can contain prompt-injection; label as untrusted data.
    body_untrusted: decodeBody(r.data.payload).slice(0, 8000),
  };
}

const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const mimeHeader = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

export async function sendEmail(input: { to: string; subject: string; body: string }): Promise<Result> {
  const h = headers("GOOGLE_MAIL_API_KEY");
  if (!h) return { ok: false, reason: "Gmail is not connected." };
  const to = input.to.trim();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) return { ok: false, reason: "That doesn't look like a single valid email address." };
  if (/[\r\n]/.test(input.subject)) return { ok: false, reason: "Subject can't contain line breaks." };
  const raw = b64([`To: ${to}`, `Subject: ${mimeHeader(input.subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", input.body].join("\r\n"))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await gw(`${MAIL}/users/me/messages/send`, { method: "POST", headers: h, body: JSON.stringify({ raw }) });
  if (!r.ok) return fail("Sending the email", r);
  // Verify: the message must exist and carry the SENT label.
  const check = await gw(`${MAIL}/users/me/messages/${r.data.id}?format=minimal`, { headers: h });
  const verified = check.ok && (check.data?.labelIds ?? []).includes("SENT");
  return { ok: verified, verified, sent: verified, id: r.data.id, ...(verified ? {} : { reason: "Gmail accepted it, but I couldn't confirm it's in Sent." }) };
}

/** Constant-time passcode check that gates every server endpoint. */
export function checkPasscode(request: Request): Response | null {
  const expected = process.env["JARVIS_PASSCODE"];
  if (!expected) return Response.json({ error: "Set a JARVIS passcode first.", code: "no_passcode" }, { status: 503 });
  const got = request.headers.get("X-Jarvis-Passcode") ?? "";
  const a = new TextEncoder().encode(got);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0 ? null : Response.json({ error: "Wrong passcode.", code: "bad_passcode" }, { status: 401 });
}
