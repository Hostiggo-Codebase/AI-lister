-- ===========================================================================
-- hostiggo_testing_schema  —  reconstructed from the dumps you provided
-- (Supabase schema export + inspect_schema.py, 2026-08-30).
--
-- The 10 listing/catalog tables below are exact.
-- `locations` and `listing_status` are referenced by `listings` but their
-- columns were not in the dumps — run `python dump_schema.py` for those.
-- Sequence owners still say `hostiggo_production_schema.*` (Supabase quirk
-- from cloning production -> testing); harmless.
-- ===========================================================================


-- ---- account / host --------------------------------------------------------

CREATE TABLE hostiggo_testing_schema.users (
  name                       text NOT NULL,
  email                      text,
  created_at                 timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  phone                      character varying,
  age                        integer,
  is_active                  boolean DEFAULT true,
  updated_at                 timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  profile_pic_url            text,
  is_verified                boolean,
  emergency_contact          character varying,
  user_id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  email_notifications        boolean NOT NULL DEFAULT true,
  sms_alerts                 boolean NOT NULL DEFAULT true,
  promo_notifications        boolean NOT NULL DEFAULT false,
  host_message_notifications boolean NOT NULL DEFAULT true,
  show_profile_to_hosts      boolean NOT NULL DEFAULT true,
  include_in_search          boolean NOT NULL DEFAULT true,
  activity_status            boolean NOT NULL DEFAULT true,
  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE hostiggo_testing_schema.host (
  is_verified boolean DEFAULT false,
  verified_at timestamp without time zone,
  photo       text,
  host_uuid   uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid UNIQUE,
  about       text,
  CONSTRAINT host_pkey PRIMARY KEY (host_uuid),
  CONSTRAINT host_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE hostiggo_testing_schema.host_documents (
  id                 integer NOT NULL DEFAULT nextval('hostiggo_production_schema.host_documents_id_seq'::regclass),
  aadhar_number      text,
  aadhar_image_front text,
  aadhar_image_back  text,
  pan_number         text,
  pan_image          text,
  passport_number    text,
  passport_image     text,
  host_uuid          uuid,
  CONSTRAINT host_documents_pkey PRIMARY KEY (id)
);


-- ---- lookups --------------------------------------------------------------

CREATE TABLE hostiggo_testing_schema.booking_status (
  status_id   integer NOT NULL DEFAULT nextval('hostiggo_production_schema.booking_status_status_id_seq'::regclass),
  status_name character varying NOT NULL UNIQUE,
  description text,
  CONSTRAINT booking_status_pkey PRIMARY KEY (status_id)
);

CREATE TABLE hostiggo_testing_schema.payment_gateways (
  payment_gatway_id integer NOT NULL DEFAULT nextval('hostiggo_production_schema.payment_gateways_payment_gatway_id_seq'::regclass),
  name              text UNIQUE,
  description       text,
  CONSTRAINT payment_gateways_pkey PRIMARY KEY (payment_gatway_id)
);

CREATE TABLE hostiggo_testing_schema.property_types (
  id          integer NOT NULL DEFAULT nextval('hostiggo_testing_schema.property_types_id_seq'::regclass),
  type_id     text NOT NULL,          -- slug: 'house', 'apartment', 'guest-house', 'hotel', 'bnb', ...
  name        text NOT NULL,          -- 'House', 'Apartment / Flat', ...
  description text,
  icon        text,
  category    text,                   -- 'popular', ...
  CONSTRAINT property_types_pkey PRIMARY KEY (id)
);

CREATE TABLE hostiggo_testing_schema.stay_types (
  id          integer NOT NULL DEFAULT nextval('hostiggo_testing_schema.stay_types_id_seq'::regclass),
  type_id     text NOT NULL,          -- 'entire' | 'private' | 'shared'
  title       text NOT NULL,          -- 'Entire Property' | 'Private Room' | 'Shared Space'
  description text,
  logo_url    text,
  CONSTRAINT stay_types_pkey PRIMARY KEY (id)
);

CREATE TABLE hostiggo_testing_schema.amenities (
  amenity_id integer NOT NULL DEFAULT nextval('hostiggo_testing_schema.amenities_amenity_id_seq'::regclass),
  name       text NOT NULL,           -- 'WiFi', 'Free Parking', 'Pet Friendly', 'Microwave', ...
  icon       text,
  category   text,                    -- 'guest-first', ...
  CONSTRAINT amenities_pkey PRIMARY KEY (amenity_id)
);

-- referenced by listings but columns not captured:
--   hostiggo_testing_schema.locations (location_id ...)
--   hostiggo_testing_schema.listing_status (listing_status ...)


-- ---- listings + children -------------------------------------------------

CREATE TABLE hostiggo_testing_schema.listings (
  listing_id          integer NOT NULL DEFAULT nextval('hostiggo_production_schema.listings_listing_id_seq'::regclass),
  title               text NOT NULL,
  description         text NOT NULL,
  price_weekday       numeric,
  price_weekend       numeric,
  num_guests          integer,
  num_bedrooms        integer,
  num_beds            integer,
  num_bathrooms       integer,
  is_active           boolean DEFAULT true,
  created_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  host_uuid           uuid,
  check_in_time       time without time zone,
  check_out_time      time without time zone,
  address_line1       text,
  address_line2       text,
  landmark            text,
  longitude           numeric,
  latitude            numeric,
  location_id         integer,
  booking_mode        text,
  currency            text DEFAULT 'INR'::text,
  lisiting_status     bigint DEFAULT '1'::bigint,          -- (sic) spelled "lisiting"
  property_type_id    integer,
  stay_type_id        integer,
  pincode             integer,
  "icalLink"          text,                                -- camelCase
  cancellation_policy text NOT NULL DEFAULT 'moderate'::text,
  CONSTRAINT listings_pkey PRIMARY KEY (listing_id),
  CONSTRAINT fk_listing_location        FOREIGN KEY (location_id)      REFERENCES hostiggo_testing_schema.locations(location_id),
  CONSTRAINT listings_host_uuid_fkey    FOREIGN KEY (host_uuid)        REFERENCES hostiggo_testing_schema.host(host_uuid),
  CONSTRAINT listings_lisiting_status_fkey FOREIGN KEY (lisiting_status) REFERENCES hostiggo_testing_schema.listing_status(listing_status),
  CONSTRAINT listings_property_type_fk  FOREIGN KEY (property_type_id) REFERENCES hostiggo_testing_schema.property_types(id),
  CONSTRAINT listings_stay_type_fk      FOREIGN KEY (stay_type_id)     REFERENCES hostiggo_testing_schema.stay_types(id)
);

CREATE TABLE hostiggo_testing_schema.listing_media (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  listing_id  integer NOT NULL,
  media_url   text NOT NULL,
  media_type  text NOT NULL,                              -- 'image' / 'video'
  is_cover    boolean DEFAULT false,
  uploaded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT listing_media_pkey PRIMARY KEY (id)
  -- FK listing_id -> listings(listing_id) (assumed)
);

CREATE TABLE hostiggo_testing_schema.listing_bedrooms (
  id            integer NOT NULL DEFAULT nextval('hostiggo_testing_schema.listing_bedrooms_id_seq'::regclass),
  listing_id    integer NOT NULL,
  bedroom_index integer NOT NULL,
  beds          integer NOT NULL,
  bathrooms     integer NOT NULL,
  max_guests    integer NOT NULL,
  CONSTRAINT listing_bedrooms_pkey PRIMARY KEY (id)
);

CREATE TABLE hostiggo_testing_schema.listing_amenities (
  listing_id integer NOT NULL,
  amenity_id integer NOT NULL
  -- composite key (listing_id, amenity_id); FKs -> listings / amenities (assumed)
);

CREATE TABLE hostiggo_testing_schema.listing_discounts (
  id              integer NOT NULL DEFAULT nextval('hostiggo_testing_schema.listing_discounts_id_seq'::regclass),
  listing_id      integer NOT NULL,
  discount_type   text NOT NULL,                          -- 'weekly' | 'monthly' | 'new_listing'
  percent         numeric,
  enabled         boolean DEFAULT true,
  valid_from      timestamp with time zone,
  valid_to        timestamp with time zone,
  min_stay_nights integer,
  CONSTRAINT listing_discounts_pkey PRIMARY KEY (id)
);

CREATE TABLE hostiggo_testing_schema.listing_house_rules (
  listing_id      integer NOT NULL,
  check_in_time   time without time zone,
  check_out_time  time without time zone,
  smoking_allowed boolean DEFAULT false,
  pets_allowed    boolean DEFAULT false,
  parties_allowed boolean DEFAULT false,
  quiet_hours     boolean DEFAULT false,                  -- NOTE: boolean, not a time range
  id              integer NOT NULL
);

CREATE TABLE hostiggo_testing_schema.listing_safety (
  listing_id       integer NOT NULL,
  security_camera  boolean DEFAULT false,
  noise_monitoring boolean DEFAULT false,
  weapons          boolean DEFAULT false,
  smoke_alarm      boolean DEFAULT false
);


-- ===========================================================================
-- Columns the import service ADDED (sql/004_provenance.sql):
--   listings:      source, import_id, external_url, external_listing_id,
--                  import_confirmed_by_host, min_nights, max_nights
--   listing_media: source, source_url, import_id
--
-- Import-service tables it CREATED (sql/001..003):
--   listing_imports, import_batches, external_taxonomy_map, listing_ical_feeds
-- ===========================================================================
