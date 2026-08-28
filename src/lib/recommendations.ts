import type { ValidatedDraft } from "./schema";

export type Recommendation = {
  id: string;
  severity: "high" | "medium" | "low";
  field: string;
  title: string;
  detail: string;
};

const HIGH_VALUE_AMENITIES = [
  "wifi",
  "air_conditioning",
  "kitchen",
  "free_parking",
  "washer",
  "power_backup",
  "hot_water",
  "workspace",
];

/**
 * Rule-based listing-quality review. Runs on every import so the host lands on
 * the review screen with a punch-list of improvements. (An optional LLM pass can
 * be layered on top later for prose-quality feedback.)
 */
export function buildRecommendations(draft: ValidatedDraft): Recommendation[] {
  const recs: Recommendation[] = [];
  const push = (r: Recommendation) => recs.push(r);

  // Photos
  if (draft.photos.length < 3)
    push({
      id: "photos_min",
      severity: "high",
      field: "photos",
      title: `Only ${draft.photos.length} photo(s) imported`,
      detail: "Listings need at least 3 photos to publish. Add more before going live — 15–25 is ideal.",
    });
  else if (draft.photos.length < 8)
    push({
      id: "photos_few",
      severity: "medium",
      field: "photos",
      title: `${draft.photos.length} photos is on the low side`,
      detail: "Listings with 15+ photos convert noticeably better. Add room-by-room shots, the exterior, and any views.",
    });

  // Title
  if (draft.title && draft.title !== "Untitled listing") {
    if (draft.title.length < 20)
      push({
        id: "title_short",
        severity: "medium",
        field: "title",
        title: "Title is very short",
        detail: "Aim for 35–50 characters. Lead with the standout feature (view, location, space).",
      });
    if (draft.title.length > 65)
      push({
        id: "title_long",
        severity: "low",
        field: "title",
        title: "Title may be truncated in search",
        detail: "Keep it under ~50 characters so it isn't cut off on listing cards.",
      });
    if (/\b(best|amazing|awesome|perfect|luxury|luxurious)\b/i.test(draft.title))
      push({
        id: "title_hype",
        severity: "low",
        field: "title",
        title: "Title uses generic hype words",
        detail: "Swap superlatives for concrete detail — 'Rooftop 2BR near Metro' beats 'Amazing luxury stay'.",
      });
  }

  // Description
  const dl = draft.description.trim().length;
  if (dl > 0 && dl < 300)
    push({
      id: "desc_thin",
      severity: "high",
      field: "description",
      title: "Description is thin",
      detail: `${dl} characters. Add the space layout, the neighbourhood, who it suits, and how to get there. Target 600–1500 characters.`,
    });
  if (dl >= 300 && dl < 600)
    push({
      id: "desc_short",
      severity: "medium",
      field: "description",
      title: "Description could be fuller",
      detail: "Add a paragraph on the neighbourhood and transport links — guests filter on this.",
    });
  if (dl > 0 && !/\b(metro|station|airport|km|min(ute)?s?|walk|drive|nearby|close to)\b/i.test(draft.description))
    push({
      id: "desc_no_location_cues",
      severity: "medium",
      field: "description",
      title: "No distance / transport cues in the description",
      detail: "Mention walking time to landmarks and distance to the station/airport.",
    });

  // Amenities
  const have = new Set<string>(draft.amenities);
  const missingHV = HIGH_VALUE_AMENITIES.filter((a) => !have.has(a));
  if (draft.amenities.length < 5)
    push({
      id: "amen_few",
      severity: "high",
      field: "amenities",
      title: `Only ${draft.amenities.length} amenities mapped`,
      detail: "Either the source lists few, or the mapping missed some. Review and tick everything the property actually has.",
    });
  if (missingHV.length)
    push({
      id: "amen_high_value",
      severity: "medium",
      field: "amenities",
      title: "High-value amenities not set",
      detail: `Guests filter hard on: ${missingHV.join(", ")}. Confirm whether the property has these.`,
    });
  if (!draft.amenities.some((a) => ["smoke_alarm", "fire_extinguisher", "first_aid_kit"].includes(a)))
    push({
      id: "amen_safety",
      severity: "medium",
      field: "safety",
      title: "No safety equipment listed",
      detail: "Add smoke alarm / fire extinguisher / first-aid kit — many guests won't book without them.",
    });

  // Capacity coherence
  const c = draft.capacity;
  if (c.beds != null && c.max_guests != null && c.beds * 2 < c.max_guests)
    push({
      id: "cap_beds_guests",
      severity: "low",
      field: "capacity",
      title: "Guest count looks high for the bed count",
      detail: `${c.max_guests} guests but ${c.beds} bed(s). Double-check the sleeping arrangement.`,
    });
  if (c.bedrooms != null && c.bathrooms != null && c.bathrooms === 0)
    push({
      id: "cap_no_bath",
      severity: "medium",
      field: "capacity",
      title: "No bathrooms recorded",
      detail: "Set the bathroom count — it's a hard filter for most guests.",
    });

  // Pricing
  if (draft.pricing.nightly_amount == null)
    push({
      id: "price_missing",
      severity: "high",
      field: "pricing",
      title: "No nightly price imported",
      detail: "The source hid the rate (common on Airbnb). Set the INR weekday and weekend price before publishing.",
    });
  if (draft.pricing.currency !== "INR")
    push({
      id: "price_currency",
      severity: "medium",
      field: "pricing",
      title: `Price is in ${draft.pricing.currency}`,
      detail: "Converted to INR at a static rate — confirm the final number against your own pricing.",
    });

  // House rules
  if (!draft.availability.check_in_time || !draft.availability.check_out_time)
    push({
      id: "rules_check_times",
      severity: "medium",
      field: "house_rules",
      title: "Check-in / check-out times missing",
      detail: "Set both — guests plan travel around them and it reduces messaging.",
    });
  if (draft.house_rules.length === 0)
    push({
      id: "rules_none",
      severity: "low",
      field: "house_rules",
      title: "No house rules imported",
      detail: "Add rules on smoking, pets, parties and quiet hours to set expectations up front.",
    });

  // Cancellation
  if (draft.cancellation_policy === "unknown")
    push({
      id: "cancellation",
      severity: "low",
      field: "cancellation_policy",
      title: "Cancellation policy not detected",
      detail: "Pick a policy (flexible / moderate / firm / strict).",
    });

  // Location
  if (draft.location.lat == null)
    push({
      id: "geo_missing",
      severity: "medium",
      field: "location",
      title: "No map coordinates",
      detail: "Drop the map pin manually so distance-based search works.",
    });

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
