# hostiggo_testing_schema — reference

Reconstructed from the live DB on 2026-08-30 (`inspect_schema.py`) plus the
Supabase schema export. Run `python dump_schema.py` for the authoritative,
complete version straight from Postgres.

> This is the schema the import service writes to. `app/schema_map.py` maps the
> importer's fields onto these columns.

---

## Listing tables (what the importer touches)

### `listings`  — PK `listing_id` (serial)

| column | type | notes |
|---|---|---|
| `listing_id` | integer | **PK**, auto |
| `title` | text | NOT NULL |
| `description` | text | NOT NULL |
| `price_weekday` | numeric | nightly rate |
| `price_weekend` | numeric | |
| `num_guests` | integer | |
| `num_bedrooms` | integer | |
| `num_beds` | integer | |
| `num_bathrooms` | integer | **integer**, not numeric |
| `is_active` | boolean | default `true` (importer writes `false` = draft) |
| `created_at` / `updated_at` | timestamp | default `CURRENT_TIMESTAMP` |
| `host_uuid` | uuid | FK → `host(host_uuid)` |
| `check_in_time` / `check_out_time` | time | |
| `address_line1` / `address_line2` | text | |
| `landmark` | text | |
| `longitude` / `latitude` | numeric | |
| `location_id` | integer | FK → `locations(location_id)` |
| `booking_mode` | text | |
| `currency` | text | default `'INR'` |
| `lisiting_status` | bigint | default `1`, FK → `listing_status(listing_status)` *(sic — column is spelled "lisiting")* |
| `property_type_id` | integer | FK → `property_types(id)` |
| `stay_type_id` | integer | FK → `stay_types(id)` |
| `pincode` | integer | **integer** |
| `icalLink` | text | camelCase — quote it: `"icalLink"` |
| `cancellation_policy` | text | NOT NULL, default `'moderate'` |
| *(added by importer, `sql/004`)* `source`, `import_id`, `external_url`, `external_listing_id`, `import_confirmed_by_host`, `min_nights`, `max_nights` | | |

### `listing_media` — PK `id` (uuid)
`id` uuid · `listing_id` integer NOT NULL · `media_url` text NOT NULL · `media_type` text NOT NULL · `is_cover` boolean (default false) · `uploaded_at` timestamptz
*(importer adds: `source`, `source_url`, `import_id`)*

### `listing_bedrooms` — PK `id` (serial)
`id` · `listing_id` integer NOT NULL · `bedroom_index` integer NOT NULL · `beds` integer NOT NULL · `bathrooms` integer NOT NULL · `max_guests` integer NOT NULL  *(all NOT NULL)*

### `listing_amenities` — composite key, no `id`
`listing_id` integer NOT NULL · `amenity_id` integer NOT NULL

### `listing_discounts` — PK `id` (serial)
`id` · `listing_id` integer NOT NULL · `discount_type` text NOT NULL · `percent` numeric · `enabled` boolean (default true) · `valid_from` / `valid_to` timestamptz · `min_stay_nights` integer

### `listing_house_rules` — PK `id`
`id` integer NOT NULL · `listing_id` integer NOT NULL · `check_in_time` / `check_out_time` time · `smoking_allowed` / `pets_allowed` / `parties_allowed` boolean (default false) · `quiet_hours` **boolean** (default false)

### `listing_safety`
`listing_id` integer NOT NULL · `security_camera` · `noise_monitoring` · `weapons` · `smoke_alarm` — all boolean, default false  *(no fire_extinguisher / first_aid_kit / co_alarm columns)*

---

## Catalog tables

### `property_types` — PK `id`
`id` integer · `type_id` **text slug** (`house`, `apartment`, `guest-house`, `hotel`, `bnb`, …) · `name` text NOT NULL · `description` · `icon` · `category` (`popular` / …)
FK target from `listings.property_type_id` = `property_types.id`.

### `stay_types` — PK `id`
`id` integer · `type_id` **text slug** (`entire`, `private`, `shared`) · `title` text NOT NULL · `description` · `logo_url`

### `amenities` — PK `amenity_id`
`amenity_id` integer · `name` text NOT NULL (`WiFi`, `Free Parking`, `Pet Friendly`, …) · `icon` · `category` (`guest-first` / …)

---

## Other tables (from the Supabase export, not touched by the importer)

- **`users`** — PK `user_id` uuid → `auth.users(id)`. `name` NOT NULL, `email`, `phone`, `age`, notification/privacy booleans.
- **`host`** — PK `host_uuid` uuid. `user_id` uuid UNIQUE → `auth.users(id)`, `is_verified`, `verified_at`, `photo`, `about`.
- **`host_documents`** — PK `id`. aadhar / pan / passport number+image fields, `host_uuid`.
- **`booking_status`** — PK `status_id`. `status_name` UNIQUE, `description`.
- **`payment_gateways`** — PK `payment_gatway_id`. `name` UNIQUE, `description`.
- **`locations`** — referenced by `listings.location_id` (columns not yet captured — run `dump_schema.py`).
- **`listing_status`** — referenced by `listings.lisiting_status`.

---

## Import-service tables (owned by this service, `sql/001`–`004`)

`listing_imports` · `import_batches` · `external_taxonomy_map` · `listing_ical_feeds`
— see `sql/001_import_tables.sql`.
