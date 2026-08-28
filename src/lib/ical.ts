import { env } from "./env";

/**
 * Minimal RFC-5545 iCalendar parser — enough to pull the busy/blocked date
 * ranges out of an OTA export feed (Airbnb / Booking / Vrbo all publish these).
 * No external dependency.
 */
export type IcalEvent = {
  uid: string | null;
  summary: string | null;
  start: string | null; // YYYY-MM-DD
  end: string | null; // YYYY-MM-DD (exclusive, per iCal DTEND for all-day)
  status: string | null;
  source: "reserved" | "blocked" | "other";
};

export type IcalFeed = {
  url: string;
  fetched_at: string;
  calendar_name: string | null;
  event_count: number;
  events: IcalEvent[];
  blocked_dates: string[]; // flat sorted list of every YYYY-MM-DD that is unavailable
  error: string | null;
};

function unfold(raw: string): string[] {
  // Continuation lines start with a space or tab.
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .reduce<string[]>((acc, line) => {
      if (/^[ \t]/.test(line) && acc.length) acc[acc.length - 1] += line.slice(1);
      else acc.push(line);
      return acc;
    }, []);
}

function parseIcalDate(v: string): string | null {
  const m = v.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function eachDate(start: string, endExclusive: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const end = new Date(endExclusive + "T00:00:00Z");
  let guard = 0;
  while (d < end && guard++ < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function parseIcal(text: string): Omit<IcalFeed, "url" | "fetched_at" | "error"> {
  const lines = unfold(text);
  let calendarName: string | null = null;
  const events: IcalEvent[] = [];
  let cur: Partial<IcalEvent> & { _raw?: Record<string, string> } | null = null;

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const keyPart = line.slice(0, idx);
    const value = line.slice(idx + 1).trim();
    const key = keyPart.split(";")[0].toUpperCase();

    if (key === "X-WR-CALNAME") calendarName = value;
    else if (line.toUpperCase().startsWith("BEGIN:VEVENT")) cur = {};
    else if (line.toUpperCase().startsWith("END:VEVENT")) {
      if (cur) {
        const summary = cur.summary ?? null;
        const status = cur.status ?? null;
        const s = /reserv|booked|guest/i.test(`${summary} ${status}`)
          ? "reserved"
          : /not available|blocked|unavailable|closed|owner/i.test(`${summary} ${status}`)
            ? "blocked"
            : "other";
        events.push({
          uid: cur.uid ?? null,
          summary,
          start: cur.start ?? null,
          end: cur.end ?? null,
          status,
          source: s as IcalEvent["source"],
        });
      }
      cur = null;
    } else if (cur) {
      if (key === "UID") cur.uid = value;
      else if (key === "SUMMARY") cur.summary = value;
      else if (key === "STATUS") cur.status = value;
      else if (key === "DTSTART") cur.start = parseIcalDate(value);
      else if (key === "DTEND") cur.end = parseIcalDate(value);
    }
  }

  const blocked = new Set<string>();
  for (const e of events) {
    if (!e.start) continue;
    const end = e.end ?? e.start;
    for (const d of eachDate(e.start, end)) blocked.add(d);
  }

  return {
    calendar_name: calendarName,
    event_count: events.length,
    events,
    blocked_dates: [...blocked].sort(),
  };
}

export async function fetchIcal(url: string): Promise<IcalFeed> {
  const base: IcalFeed = {
    url,
    fetched_at: new Date().toISOString(),
    calendar_name: null,
    event_count: 0,
    events: [],
    blocked_dates: [],
    error: null,
  };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ...base, error: "invalid iCal URL" };
  }
  if (!/^https?:$/.test(u.protocol)) return { ...base, error: "URL must be http(s)" };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), env.fetchTimeoutMs);
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: { "user-agent": "HostiggoImporter/1.0", accept: "text/calendar,*/*" },
    }).finally(() => clearTimeout(t));
    if (!res.ok) return { ...base, error: `HTTP ${res.status}` };
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text))
      return { ...base, error: "response is not an iCalendar feed" };
    return { ...base, ...parseIcal(text) };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
