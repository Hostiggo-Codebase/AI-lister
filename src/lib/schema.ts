import { z } from "zod";
import { AMENITIES, normalizeAmenity, type Amenity } from "./amenities";
import { env } from "./env";

export const PROPERTY_TYPES = [
  "house",
  "apartment",
  "villa",
  "cottage",
  "homestay",
  "guesthouse",
  "bungalow",
  "farmstay",
  "houseboat",
  "treehouse",
  "hostel",
  "boutique_hotel",
  "other",
] as const;

export const ROOM_TYPES = ["entire_place", "private_room", "shared_room"] as const;

export const CANCELLATION_POLICIES = [
  "flexible",
  "moderate",
  "firm",
  "strict",
  "non_refundable",
  "unknown",
] as const;

/* ------------------------------------------------------------------ *
 * 1. The strict JSON Schema handed to the LLM (structured output).   *
 * ------------------------------------------------------------------ */
export const LISTING_DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "property_type", "room_type", "capacity", "pricing"],
  properties: {
    title: { type: "string", maxLength: 120 },
    summary: { type: ["string", "null"], maxLength: 400 },
    description: { type: "string" },
    property_type: { type: "string", enum: PROPERTY_TYPES as unknown as string[] },
    room_type: { type: "string", enum: ROOM_TYPES as unknown as string[] },
    address: {
      type: "object",
      additionalProperties: false,
      properties: {
        line: { type: ["string", "null"] },
        city: { type: ["string", "null"] },
        state: { type: ["string", "null"] },
        country: { type: ["string", "null"] },
        postal_code: { type: ["string", "null"] },
      },
    },
    location: {
      type: "object",
      additionalProperties: false,
      properties: {
        lat: { type: ["number", "null"] },
        lng: { type: ["number", "null"] },
      },
    },
    capacity: {
      type: "object",
      additionalProperties: false,
      required: ["max_guests"],
      properties: {
        max_guests: { type: "integer", minimum: 1, maximum: 50 },
        bedrooms: { type: ["integer", "null"], minimum: 0, maximum: 30 },
        beds: { type: ["integer", "null"], minimum: 0, maximum: 60 },
        bathrooms: { type: ["number", "null"], minimum: 0, maximum: 30 },
      },
    },
    pricing: {
      type: "object",
      additionalProperties: false,
      required: ["nightly_amount", "currency"],
      properties: {
        nightly_amount: { type: "number", minimum: 0 },
        currency: { type: "string", description: "ISO 4217, e.g. INR, USD" },
        cleaning_fee: { type: ["number", "null"], minimum: 0 },
        weekly_discount_pct: { type: ["number", "null"], minimum: 0, maximum: 100 },
      },
    },
    amenities: {
      type: "array",
      items: { type: "string" },
      description: "Free text is fine; server normalizes to the Hostiggo enum.",
    },
    house_rules: { type: "array", items: { type: "string" } },
    cancellation_policy: {
      type: "string",
      enum: CANCELLATION_POLICIES as unknown as string[],
    },
    availability: {
      type: "object",
      additionalProperties: false,
      properties: {
        min_nights: { type: ["integer", "null"], minimum: 1 },
        max_nights: { type: ["integer", "null"], minimum: 1 },
        check_in_time: { type: ["string", "null"] },
        check_out_time: { type: ["string", "null"] },
      },
    },
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string" },
          caption: { type: ["string", "null"] },
        },
      },
    },
    host: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        languages: { type: "array", items: { type: "string" } },
      },
    },
    ratings: {
      type: "object",
      additionalProperties: false,
      properties: {
        overall: { type: ["number", "null"], minimum: 0, maximum: 5 },
        count: { type: ["integer", "null"], minimum: 0 },
      },
    },
  },
} as const;

/* ------------------------------------------------------------------ *
 * 2. Lenient zod schema for what the LLM actually returns.           *
 * ------------------------------------------------------------------ */
const nn = z.union([z.string(), z.number(), z.null()]).optional();
export const RawExtractionSchema = z
  .object({
    title: z.string().optional(),
    summary: z.string().nullish(),
    description: z.string().optional(),
    property_type: z.string().optional(),
    room_type: z.string().optional(),
    address: z
      .object({
        line: z.string().nullish(),
        city: z.string().nullish(),
        state: z.string().nullish(),
        country: z.string().nullish(),
        postal_code: z.string().nullish(),
      })
      .partial()
      .optional(),
    location: z
      .object({ lat: nn, lng: nn })
      .partial()
      .optional(),
    capacity: z
      .object({ max_guests: nn, bedrooms: nn, beds: nn, bathrooms: nn })
      .partial()
      .optional(),
    pricing: z
      .object({
        nightly_amount: nn,
        currency: z.string().nullish(),
        cleaning_fee: nn,
        weekly_discount_pct: nn,
      })
      .partial()
      .optional(),
    amenities: z.array(z.string()).optional(),
    house_rules: z.array(z.string()).optional(),
    cancellation_policy: z.string().nullish(),
    availability: z
      .object({
        min_nights: nn,
        max_nights: nn,
        check_in_time: z.string().nullish(),
        check_out_time: z.string().nullish(),
      })
      .partial()
      .optional(),
    photos: z
      .array(
        z.union([
          z.string(),
          z.object({ url: z.string(), caption: z.string().nullish() }),
        ]),
      )
      .optional(),
    host: z
      .object({ name: z.string().nullish(), languages: z.array(z.string()).optional() })
      .partial()
      .optional(),
    ratings: z.object({ overall: nn, count: nn }).partial().optional(),
  })
  .passthrough();

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

/* ------------------------------------------------------------------ *
 * 3. The validated, commit-ready draft.                              *
 * ------------------------------------------------------------------ */
export type ValidatedDraft = {
  title: string;
  summary: string | null;
  description: string;
  property_type: (typeof PROPERTY_TYPES)[number];
  room_type: (typeof ROOM_TYPES)[number];
  address: {
    line: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postal_code: string | null;
  };
  location: { lat: number | null; lng: number | null };
  capacity: {
    max_guests: number;
    bedrooms: number | null;
    beds: number | null;
    bathrooms: number | null;
  };
  pricing: {
    nightly_amount: number | null;
    currency: string;
    cleaning_fee: number | null;
    weekly_discount_pct: number | null;
  };
  amenities: Amenity[];
  house_rules: string[];
  cancellation_policy: (typeof CANCELLATION_POLICIES)[number];
  availability: {
    min_nights: number | null;
    max_nights: number | null;
    check_in_time: string | null;
    check_out_time: string | null;
  };
  photos: { url: string; caption: string | null }[];
  host: { name: string | null; languages: string[] };
  ratings: { overall: number | null; count: number | null };
};

export type FieldStatus = "ok" | "coerced" | "clamped" | "dropped" | "missing";
export type FieldNote = { path: string; status: FieldStatus; note: string };

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/[, ]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const toInt = (v: unknown): number | null => {
  const n = toNum(v);
  return n == null ? null : Math.round(n);
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
};

const CURRENCY_SYMBOL: Record<string, string> = {
  "₹": "INR",
  Rs: "INR",
  "rs.": "INR",
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

function nearestEnum<T extends readonly string[]>(
  v: string | null,
  options: T,
  fallback: T[number],
): { value: T[number]; matched: boolean } {
  if (!v) return { value: fallback, matched: false };
  const s = v.toLowerCase().replace(/[\s-]+/g, "_");
  if ((options as readonly string[]).includes(s))
    return { value: s as T[number], matched: true };
  const hit = options.find((o) => s.includes(o) || o.includes(s));
  return hit ? { value: hit, matched: true } : { value: fallback, matched: false };
}

/**
 * Normalize + validate a raw LLM extraction into a commit-ready draft,
 * emitting a per-field report of everything that was changed.
 */
export function validateDraft(raw: RawExtraction): {
  draft: ValidatedDraft;
  report: FieldNote[];
} {
  const report: FieldNote[] = [];
  const add = (path: string, status: FieldStatus, note: string) =>
    report.push({ path, status, note });

  // title / description
  const title = str(raw.title);
  if (!title) add("title", "missing", "No title extracted");
  const description = str(raw.description);
  if (!description) add("description", "missing", "No description extracted");

  // property_type / room_type
  const pt = nearestEnum(str(raw.property_type), PROPERTY_TYPES, "homestay");
  if (!pt.matched)
    add("property_type", raw.property_type ? "coerced" : "missing", `-> ${pt.value}`);
  const rt = nearestEnum(str(raw.room_type), ROOM_TYPES, "entire_place");
  if (!rt.matched)
    add("room_type", raw.room_type ? "coerced" : "missing", `-> ${rt.value}`);

  // location
  let lat = toNum(raw.location?.lat);
  let lng = toNum(raw.location?.lng);
  if (lat != null && (lat < -90 || lat > 90)) {
    add("location.lat", "dropped", `out of range (${lat})`);
    lat = null;
  }
  if (lng != null && (lng < -180 || lng > 180)) {
    add("location.lng", "dropped", `out of range (${lng})`);
    lng = null;
  }

  // capacity
  let maxGuests = toInt(raw.capacity?.max_guests);
  if (maxGuests == null) {
    add("capacity.max_guests", "missing", "defaulted to 2");
    maxGuests = 2;
  } else if (maxGuests !== clamp(maxGuests, 1, 50)) {
    add("capacity.max_guests", "clamped", `${maxGuests} -> ${clamp(maxGuests, 1, 50)}`);
    maxGuests = clamp(maxGuests, 1, 50);
  }
  const bedrooms = toInt(raw.capacity?.bedrooms);
  const beds = toInt(raw.capacity?.beds);
  const bathrooms = toNum(raw.capacity?.bathrooms);

  // pricing
  let currency = (str(raw.pricing?.currency) || "").toUpperCase();
  const rawCur = str(raw.pricing?.currency) || "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    const mapped =
      CURRENCY_SYMBOL[rawCur] ||
      CURRENCY_SYMBOL[rawCur.toLowerCase()] ||
      (/₹|rs\b|inr|rupee/i.test(rawCur) ? "INR" : "");
    if (mapped) {
      add("pricing.currency", "coerced", `"${rawCur}" -> ${mapped}`);
      currency = mapped;
    } else {
      add("pricing.currency", "missing", "defaulted to INR");
      currency = "INR";
    }
  }
  let nightly = toNum(raw.pricing?.nightly_amount);
  if (nightly == null) add("pricing.nightly_amount", "missing", "left null for host to set");
  else if (nightly < 0) {
    add("pricing.nightly_amount", "dropped", "negative");
    nightly = null;
  }
  const cleaningFee = toNum(raw.pricing?.cleaning_fee);
  let weeklyDisc = toNum(raw.pricing?.weekly_discount_pct);
  if (weeklyDisc != null && weeklyDisc !== clamp(weeklyDisc, 0, 100)) {
    add("pricing.weekly_discount_pct", "clamped", `${weeklyDisc}`);
    weeklyDisc = clamp(weeklyDisc, 0, 100);
  }

  // amenities
  const seen = new Set<Amenity>();
  for (const a of raw.amenities ?? []) {
    const norm = normalizeAmenity(a);
    if (!norm) {
      add(`amenities["${a}"]`, "dropped", "no enum match");
      continue;
    }
    seen.add(norm);
  }
  const amenities = [...seen];

  // cancellation policy
  const cp = nearestEnum(str(raw.cancellation_policy), CANCELLATION_POLICIES, "unknown");

  // availability
  const minNights = toInt(raw.availability?.min_nights);
  const maxNights = toInt(raw.availability?.max_nights);

  // photos: dedupe, https-ify, strip query noise, cap
  const photoSeen = new Set<string>();
  const photos: { url: string; caption: string | null }[] = [];
  let dropped = 0;
  for (const p of raw.photos ?? []) {
    const rawUrl = typeof p === "string" ? p : p?.url;
    const caption = typeof p === "string" ? null : str(p?.caption);
    if (!rawUrl) continue;
    let u: URL;
    try {
      u = new URL(rawUrl, "https://x");
    } catch {
      dropped++;
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname === "x") {
      dropped++;
      continue;
    }
    u.protocol = "https:";
    for (const k of [...u.searchParams.keys()])
      if (/^(w|h|width|height|quality|q|im_|_|aki_policy|cs|impolicy)/i.test(k))
        u.searchParams.delete(k);
    const key = u.origin + u.pathname;
    if (photoSeen.has(key)) continue;
    photoSeen.add(key);
    photos.push({ url: u.toString(), caption });
  }
  if (dropped) add("photos", "dropped", `${dropped} invalid photo URL(s)`);
  if (photos.length > env.maxPhotos) {
    add("photos", "clamped", `${photos.length} -> ${env.maxPhotos}`);
    photos.length = env.maxPhotos;
  }
  if (photos.length === 0) add("photos", "missing", "no photos extracted");

  const draft: ValidatedDraft = {
    title: title ?? "Untitled listing",
    summary: str(raw.summary),
    description: description ?? "",
    property_type: pt.value,
    room_type: rt.value,
    address: {
      line: str(raw.address?.line),
      city: str(raw.address?.city),
      state: str(raw.address?.state),
      country: str(raw.address?.country),
      postal_code: str(raw.address?.postal_code),
    },
    location: { lat, lng },
    capacity: { max_guests: maxGuests, bedrooms, beds, bathrooms },
    pricing: {
      nightly_amount: nightly ?? null,
      currency,
      cleaning_fee: cleaningFee,
      weekly_discount_pct: weeklyDisc ?? null,
    },
    amenities,
    house_rules: (raw.house_rules ?? []).map(str).filter((x): x is string => !!x),
    cancellation_policy: cp.value,
    availability: {
      min_nights: minNights,
      max_nights: maxNights,
      check_in_time: str(raw.availability?.check_in_time),
      check_out_time: str(raw.availability?.check_out_time),
    },
    photos,
    host: {
      name: str(raw.host?.name),
      languages: (raw.host?.languages ?? []).map(str).filter((x): x is string => !!x),
    },
    ratings: { overall: toNum(raw.ratings?.overall), count: toInt(raw.ratings?.count) },
  };

  // Fields that survived untouched still deserve an "ok" acknowledgement.
  for (const [path, present] of [
    ["title", !!title],
    ["description", !!description],
    ["pricing.nightly_amount", nightly != null],
    ["location", lat != null && lng != null],
    ["amenities", amenities.length > 0],
    ["photos", photos.length > 0],
  ] as const) {
    if (present && !report.some((r) => r.path === path))
      add(path, "ok", "extracted cleanly");
  }

  return { draft, report };
}

export function isCommittable(draft: ValidatedDraft): string[] {
  const errs: string[] = [];
  if (!draft.title || draft.title === "Untitled listing") errs.push("title required");
  if (!draft.description) errs.push("description required");
  if (draft.pricing.nightly_amount == null) errs.push("nightly price required");
  if (!draft.address.city) errs.push("city required");
  return errs;
}

export { AMENITIES };
