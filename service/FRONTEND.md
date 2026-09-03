# Review screen — data contract

How the "Review AI content" screen should read from and write to the import
service. Everything comes from **one call**:

```
GET /v1/imports/{import_id}      ->  { "import": <ImportRecord> }
```

(add `Authorization: Bearer <API_KEY>` in prod.)

Poll it every ~1.5s while `import.status` is `pending` / `fetching`. When it
reaches `needs_review`, render the sections below.

---

## `import.status`

`pending` → `fetching` → `needs_review` → (`published` after commit) · or `failed`
(then `import.error_message` is set).

## Sections and where their data lives

| Review section | Read from | Notes |
|---|---|---|
| **Basic Information** | `normalized_payload.title`, `.property_type`, `.stay_type`, `.address` (`line`,`city`,`state`,`country`,`postal_code`), `.location.{lat,lng}`, `.capacity.{max_guests,bedrooms,beds,bathrooms}` | `property_type` / `stay_type` are slugs — map to your `property_types` / `stay_types` picker |
| **Description** | `normalized_payload.description` (full text), `.summary` | |
| **Property Details** | `normalized_payload.pricing` (`nightly_amount`, `weekend_amount`, `currency`, discounts), `.availability` (`min_nights`, `max_nights`, `check_in_time`, `check_out_time`), `.cancellation_policy`, `.booking_mode` | `pricing.nightly_amount` may be `null` (Airbnb hides it) — pre-fill blank, it's already in `field_coverage.unresolved_required_fields` |
| **Photos** | **`import.mirrored_photos[]`** — each `{ idx, public_url, original_url, status, is_cover, caption }`. Use `public_url` (already re-hosted to your Supabase Storage). `status == "mirrored"` = good | there are 8 of them here. `normalized_payload.photos[]` is the pre-mirror list — prefer `mirrored_photos` |
| **Amenities** | `normalized_payload.amenities[]` (mapped Hostiggo slugs, e.g. `["wifi","kitchen"]`) + `normalized_payload.amenities_unmapped[]` (OTA strings we couldn't map — show as "AI found these, pick the closest") | |
| **House Rules** | `normalized_payload.house_rules` (`smoking_allowed`, `pets_allowed`, `parties_allowed`: bool\|null; `quiet_hours`: string\|null; `additional_rules[]`) | |
| **Safety** | `normalized_payload.safety` (`smoke_alarm`, `carbon_monoxide_alarm`, `fire_extinguisher`, `first_aid_kit`, `security_camera`, `noise_monitoring`, `weapons_on_property`: bool\|null) | |

## Coverage / prompts

`import.field_coverage`:

```jsonc
{
  "rows": [ { "id","label","required","status": "auto|partial|manual|missing","value","note" } ],
  "summary": { "auto","partial","manual","missing","required_unresolved","percent_prefilled" },
  "unresolved_required_fields": ["eligibility.host_confirmed_at","pricing.nightly_amount", ...],
  "host_input_needed": ["address.line","pricing.weekend_amount","booking_mode", ...]
}
```

- Badge each section with its `rows[].status` colour (green/amber/blue/red).
- Disable the final **Publish** button while `summary.required_unresolved > 0` or
  `unresolved_required_fields` is non-empty.
- `import.recommendations[]` = `{ id, severity: "high|medium|low", field, title, detail }`
  — show as tips.

## Saving section edits (before publish)

```
PATCH /v1/imports/{import_id}
{ "normalized_payload": { ...only the fields the host changed... } }
```

Partial objects are **deep-merged** into the current draft, re-validated, and
`field_coverage` + `recommendations` are recomputed. Response is the updated
`{ "import": ... }`. Wire this to each "Save Changes and return to review" button.

Example — host edits the price and a house rule:
```json
{ "normalized_payload": {
    "pricing": { "nightly_amount": 4500, "weekend_amount": 5500 },
    "house_rules": { "smoking_allowed": false }
} }
```

## Publishing

```
POST /v1/imports/{import_id}/commit
{ "confirm": true }                       // the consent checkbox — REQUIRED
```

→ `{ "listing_id": <int>, "skipped": [ ... ] }`

Writes `listings` + `listing_media` (the 8 photos, as your Supabase URLs) +
`listing_bedrooms` + `listing_amenities` + `listing_discounts` +
`listing_house_rules` + `listing_safety`, with `listings.is_active = false`
(draft — host activates it), `source = 'airbnb_import'`, `import_id`, `external_url`.

`skipped` lists any amenity / property-type the AI found that has no row in your
catalog tables — informational, the listing still saves.

## iCal (optional, per listing)

```
POST /v1/imports/{import_id}/ical   { "url": "https://www.airbnb.com/calendar/ical/....ics?s=..." }
```
→ parses it; `import.ical.blocked_dates[]` + `import.ical.events[]`. On commit the
feed URL is written to `listings."icalLink"` and the parsed data to
`listing_ical_feeds`.
