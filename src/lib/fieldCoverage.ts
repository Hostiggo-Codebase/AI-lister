import type { ValidatedDraft } from "./schema";
import type { FxConversion } from "./fx";

/**
 * The Hostiggo onboarding flow, in order, as described in the "Import from an
 * Airbnb link" brainstorm. Each row is scored against the imported draft so the
 * review screen can show green / amber / red.
 */
export type CoverageStatus = "auto" | "partial" | "manual" | "missing";

export type CoverageRow = {
  id: string;
  label: string;
  required: boolean; // required to publish
  status: CoverageStatus;
  value: string; // short human summary of what we imported
  note: string; // what the host still needs to do, if anything
};

export type Coverage = {
  rows: CoverageRow[];
  summary: {
    auto: number;
    partial: number;
    manual: number;
    missing: number;
    required_unresolved: number; // required rows that are missing
    percent_prefilled: number;
  };
};

const j = (xs: (string | number | null | undefined)[]) =>
  xs.filter((x) => x !== null && x !== undefined && x !== "").join(", ");

export function computeCoverage(
  draft: ValidatedDraft,
  fx: FxConversion | null,
  consentGiven: boolean,
): Coverage {
  const rows: CoverageRow[] = [];
  const add = (r: CoverageRow) => rows.push(r);

  const photos = draft.photos.length;
  const amen = draft.amenities.length;
  const cap = draft.capacity;
  const rules = draft.house_rules.length;
  const hasCheckTimes = !!(
    draft.availability.check_in_time || draft.availability.check_out_time
  );
  const safetyDevices = draft.amenities.filter((a) =>
    ["smoke_alarm", "carbon_monoxide_alarm", "first_aid_kit", "fire_extinguisher", "security_cameras"].includes(
      a,
    ),
  );

  add({
    id: "property_type",
    label: "Property type",
    required: true,
    status: draft.property_type ? "auto" : "missing",
    value: draft.property_type,
    note: draft.property_type ? "Mapped from source; confirm it's the closest of the 19 types." : "Not detected.",
  });

  add({
    id: "stay_type",
    label: "Stay type",
    required: true,
    status: draft.room_type ? "auto" : "missing",
    value: draft.room_type,
    note: "Maps 1:1 from the source room type.",
  });

  add({
    id: "location",
    label: "Location",
    required: true,
    status: draft.address.city ? "partial" : "missing",
    value: j([draft.address.line, draft.address.city, draft.address.state, draft.address.postal_code]) ||
      (draft.location.lat != null ? `~${draft.location.lat}, ${draft.location.lng}` : ""),
    note: "OTAs hide the exact street address & pincode until booking — host must confirm the precise address and map pin.",
  });

  const capTotals = [cap.max_guests, cap.bedrooms, cap.beds, cap.bathrooms].filter(
    (x) => x != null,
  ).length;
  add({
    id: "capacity",
    label: "Capacity",
    required: true,
    status: cap.max_guests == null ? "missing" : capTotals >= 3 ? "auto" : "partial",
    value: j([
      cap.max_guests != null ? `${cap.max_guests} guests` : null,
      cap.bedrooms != null ? `${cap.bedrooms} BR` : null,
      cap.beds != null ? `${cap.beds} beds` : null,
      cap.bathrooms != null ? `${cap.bathrooms} bath` : null,
    ]),
    note: "Totals import cleanly; the per-bedroom sleeping split usually needs a quick host review.",
  });

  add({
    id: "amenities",
    label: "Amenities / facilities",
    required: false,
    status: amen === 0 ? "missing" : "auto",
    value: `${amen} mapped` + (amen ? `: ${draft.amenities.slice(0, 6).join(", ")}${amen > 6 ? "…" : ""}` : ""),
    note: "Source amenities are mapped to the Hostiggo set; anything unmatched is dropped.",
  });

  add({
    id: "photos",
    label: "Photos",
    required: true,
    status: photos >= 3 ? "auto" : photos > 0 ? "partial" : "missing",
    value: `${photos} photo${photos === 1 ? "" : "s"} (re-hosted)`,
    note:
      photos >= 3
        ? "First photo becomes the cover — host can reorder."
        : "Need at least 3 photos to publish.",
  });

  add({
    id: "title",
    label: "Listing title",
    required: true,
    status: draft.title && draft.title !== "Untitled listing" ? "auto" : "missing",
    value: draft.title,
    note: "Comes straight from the source title.",
  });

  add({
    id: "description",
    label: "Description",
    required: true,
    status: draft.description ? "auto" : "missing",
    value: draft.description ? `${draft.description.length} chars` : "",
    note: "Imported from the source description.",
  });

  add({
    id: "booking_mode",
    label: "Booking mode",
    required: false,
    status: "manual",
    value: "",
    note: "Instant-book vs request-to-book — not reliably exposed; host chooses.",
  });

  const priceStatus: CoverageStatus =
    fx?.inr_amount != null ? "partial" : draft.pricing.nightly_amount != null ? "partial" : "missing";
  add({
    id: "pricing",
    label: "Pricing",
    required: true,
    status: priceStatus,
    value:
      fx?.inr_amount != null
        ? `₹${fx.inr_amount}/night` +
          (fx.source_currency !== "INR" ? ` (from ${fx.source_amount} ${fx.source_currency})` : "")
        : draft.pricing.nightly_amount != null
          ? `${draft.pricing.nightly_amount} ${draft.pricing.currency}`
          : "",
    note: "Base nightly rate imports (converted to INR); the weekend price differential isn't exposed — host sets it.",
  });

  add({
    id: "discounts",
    label: "Discounts",
    required: false,
    status: draft.pricing.weekly_discount_pct != null ? "partial" : "manual",
    value: draft.pricing.weekly_discount_pct != null ? `${draft.pricing.weekly_discount_pct}% weekly` : "",
    note: "Weekly/monthly discounts sometimes import; the new-listing promo is Hostiggo-specific.",
  });

  add({
    id: "addons",
    label: "Add-ons",
    required: false,
    status: "manual",
    value: "",
    note: "Breakfast, chef, treks, transport, photography — no OTA equivalent, always host-entered.",
  });

  add({
    id: "house_rules",
    label: "House rules",
    required: false,
    status: rules > 0 || hasCheckTimes ? "auto" : "missing",
    value: j([
      hasCheckTimes ? `in ${draft.availability.check_in_time ?? "?"} / out ${draft.availability.check_out_time ?? "?"}` : null,
      rules ? `${rules} rule${rules === 1 ? "" : "s"}` : null,
    ]),
    note: "Check-in/out and house rules map directly when present.",
  });

  add({
    id: "safety",
    label: "Safety details",
    required: false,
    status: safetyDevices.length ? "partial" : "missing",
    value: safetyDevices.join(", "),
    note: "Devices come from the source safety section; 'weapons on property' is rarely stated — defaults to host confirmation.",
  });

  add({
    id: "eligibility_consent",
    label: "Eligibility & consent",
    required: true,
    status: consentGiven ? "manual" : "missing",
    value: consentGiven ? "ownership attested at import" : "",
    note: "Hostiggo consent — always confirmed by the host, never imported. Re-confirmed at publish.",
  });

  const count = (s: CoverageStatus) => rows.filter((r) => r.status === s).length;
  const requiredUnresolved = rows.filter((r) => r.required && r.status === "missing").length;
  const prefilled = rows.filter((r) => r.status === "auto" || r.status === "partial").length;

  return {
    rows,
    summary: {
      auto: count("auto"),
      partial: count("partial"),
      manual: count("manual"),
      missing: count("missing"),
      required_unresolved: requiredUnresolved,
      percent_prefilled: Math.round((prefilled / rows.length) * 100),
    },
  };
}
