import Anthropic from "@anthropic-ai/sdk";
import { env, hasLLM } from "./env";
import { LISTING_DRAFT_JSON_SCHEMA, RawExtractionSchema, type RawExtraction } from "./schema";
import type { ParsedPage } from "./tier1";
import type { Provider } from "./providers";

export type ExtractionResult = {
  engine: "anthropic" | "mock";
  model: string;
  raw: RawExtraction;
  warnings: string[];
};

const SYSTEM = `You extract a structured homestay/vacation-rental listing from the raw content of an online travel agency (OTA) page.
Rules:
- Use ONLY information present in the provided content. Never invent amenities, prices, coordinates, or addresses.
- If a value is not present, omit it or use null. Do not guess.
- "description" should be the host's full property description, cleaned of navigation/boilerplate.
- "photos" must be direct image URLs found in the content (og:image, gallery <img> src/srcset, JSON-LD image arrays, or the EMBEDDED STATE JSON). Exclude UI icons, avatars, map tiles and "platform-assets" images.
- Prices: report the nightly rate and its ISO-4217 currency (INR for ₹/Rs). The nightly rate is the smallest per-night figure — not a multi-night total or a figure that includes fees.
- Mine the EMBEDDED STATE JSON for price, guest capacity, bedrooms, beds, bathrooms, coordinates, city and the amenities list when the visible text does not contain them. PRE-EXTRACTED HINTS is a best-effort parse of that JSON — treat it as a starting point, not ground truth.
- Return your answer by calling the "emit_listing_draft" tool.`;

function buildContent(page: ParsedPage, provider: Provider): string {
  const embedded = page.embeddedJson.length
    ? JSON.stringify(page.embeddedJson).slice(0, 60000)
    : "";
  const { longDescription, descriptionParts, ...hintsLite } = page.hints;
  return [
    `PROVIDER: ${provider}`,
    `PAGE TITLE: ${page.title ?? ""}`,
    `OPENGRAPH: ${JSON.stringify(page.openGraph)}`,
    `META(description/keywords): ${JSON.stringify({
      description: page.meta.description,
      keywords: page.meta.keywords,
    })}`,
    longDescription
      ? `FULL PROPERTY DESCRIPTION (assembled from the page's own text sections — use this verbatim for "description", only cleaning boilerplate):\n${(descriptionParts.length ? descriptionParts : [longDescription]).join("\n\n---\n\n")}`
      : "",
    `JSON-LD: ${JSON.stringify(page.jsonLd).slice(0, 20000)}`,
    `PRE-EXTRACTED HINTS (from embedded JSON — verify before trusting): ${JSON.stringify(
      hintsLite,
    )}`,
    embedded ? `EMBEDDED STATE JSON (truncated): ${embedded}` : "",
    `CANDIDATE IMAGE URLS: ${JSON.stringify(page.imageUrls.slice(0, 80))}`,
    `VISIBLE TEXT (truncated): ${page.textExcerpt}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function extractListing(
  page: ParsedPage,
  provider: Provider,
  modelOverride?: string,
): Promise<ExtractionResult> {
  const model = modelOverride || env.llmModel;
  if (!hasLLM()) {
    return { engine: "mock", model: "heuristic-mock", ...mockExtract(page) };
  }

  const client = new Anthropic({ apiKey: env.anthropicKey });
  const msg = await client.messages.create({
    model,
    max_tokens: 8192,
    system: SYSTEM,
    tools: [
      {
        name: "emit_listing_draft",
        description: "Return the extracted listing draft.",
        input_schema: LISTING_DRAFT_JSON_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_listing_draft" },
    messages: [{ role: "user", content: buildContent(page, provider) }],
  });

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("LLM returned no tool_use block");

  const parsed = RawExtractionSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      engine: "anthropic",
      model,
      raw: (toolUse.input ?? {}) as RawExtraction,
      warnings: ["LLM output failed strict re-parse: " + parsed.error.message],
    };
  }
  return { engine: "anthropic", model, raw: parsed.data, warnings: [] };
}

/* ------------------------------------------------------------------ *
 * Offline heuristic extractor — good enough for the playground and   *
 * for deterministic tests against the bundled fixtures.              *
 * ------------------------------------------------------------------ */
function mockExtract(page: ParsedPage): { raw: RawExtraction; warnings: string[] } {
  const warnings = ["Using offline heuristic extractor (no ANTHROPIC_API_KEY set)"];
  const ld = page.jsonLd.find(
    (x): x is Record<string, unknown> =>
      !!x &&
      typeof x === "object" &&
      /Hotel|LodgingBusiness|Product|Place|Accommodation|Apartment|House/i.test(
        String((x as Record<string, unknown>)["@type"] ?? ""),
      ),
  );
  const text = page.textExcerpt;
  const h = page.hints;

  // Prefer the smallest sane price candidate harvested from embedded JSON
  // (that's usually the nightly rate rather than a multi-night total).
  const priceCand = [...h.priceCandidates].sort((a, b) => a.amount - b.amount)[0];
  const textPrice =
    text.match(/(?:₹|Rs\.?|INR)\s?([\d,]{3,})/i) ||
    text.match(/([\d,]{3,})\s*(?:per night|\/ ?night|a night)/i);
  const nightly = priceCand?.amount ?? (textPrice ? Number(textPrice[1].replace(/,/g, "")) : null);
  const currency = priceCand?.currency ?? "INR";

  const numOrNull = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const guests = h.personCapacity ?? numOrNull(text.match(/(\d+)\s*guests?/i)?.[1]);
  const bedrooms = h.bedrooms ?? numOrNull(text.match(/(\d+)\s*bedrooms?/i)?.[1]);
  const beds = h.beds ?? numOrNull(text.match(/(\d+)\s*beds?/i)?.[1]);
  const bathrooms =
    h.bathrooms ?? numOrNull(text.match(/(\d+(?:\.\d)?)\s*(?:bath|bathrooms?)/i)?.[1]);

  const amenityHaystack = (h.amenityNames.join(" ") + " " + text).toLowerCase();
  const amenityHits = [
    "wifi",
    "air conditioning",
    "kitchen",
    "free parking",
    "pool",
    "washer",
    "dryer",
    "tv",
    "breakfast",
    "geyser",
    "hot water",
    "power backup",
    "balcony",
    "garden",
    "mountain view",
    "sea view",
    "workspace",
    "elevator",
    "pets allowed",
    "self check",
    "smoke alarm",
  ].filter((a) => new RegExp(a.replace(/ /g, "[ -]?"), "i").test(amenityHaystack));

  const ldImages = ld?.image
    ? (Array.isArray(ld.image) ? ld.image : [ld.image]).map(String)
    : [];
  const photos = [...new Set([...ldImages, ...page.imageUrls])]
    .filter((u) => /^https?:/.test(u))
    .slice(0, 40)
    .map((url) => ({ url }));

  const addr = (ld?.address ?? {}) as Record<string, unknown>;
  const geo = (ld?.geo ?? {}) as Record<string, unknown>;
  const agg = (ld?.aggregateRating ?? {}) as Record<string, unknown>;

  return {
    warnings,
    raw: {
      title:
        (ld?.name as string) ||
        page.openGraph.title ||
        page.title ||
        "Imported listing",
      summary: page.openGraph.description || page.meta.description || null,
      description:
        // longest wins: the full write-up usually only lives in embedded JSON
        [
          h.longDescription,
          ld?.description as string | undefined,
          page.meta.description,
          page.openGraph.description,
        ]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .sort((a, b) => b.length - a.length)[0] || text.slice(0, 1200),
      property_type: /villa/i.test(text)
        ? "villa"
        : /apartment|flat/i.test(text)
          ? "apartment"
          : /cottage/i.test(text)
            ? "cottage"
            : "homestay",
      room_type: /entire (home|place|villa|apartment)/i.test(text)
        ? "entire_place"
        : /private room/i.test(text)
          ? "private_room"
          : "entire_place",
      address: {
        line: (addr.streetAddress as string) ?? null,
        city: (addr.addressLocality as string) ?? h.city ?? null,
        state: (addr.addressRegion as string) ?? null,
        country: (addr.addressCountry as string) ?? "India",
        postal_code: (addr.postalCode as string) ?? null,
      },
      location: {
        lat: geo.latitude != null ? Number(geo.latitude) : h.lat,
        lng: geo.longitude != null ? Number(geo.longitude) : h.lng,
      },
      capacity: {
        max_guests: guests ?? 2,
        bedrooms,
        beds,
        bathrooms,
      },
      pricing: {
        nightly_amount:
          nightly ??
          ((ld?.priceRange as string | undefined)?.match(/\d+/)?.[0]
            ? Number((ld!.priceRange as string).match(/\d+/)![0])
            : null),
        currency,
        cleaning_fee: null,
        weekly_discount_pct: null,
      },
      amenities: amenityHits,
      house_rules: /no smoking/i.test(text) ? ["No smoking"] : [],
      cancellation_policy: /free cancellation/i.test(text) ? "flexible" : "unknown",
      availability: {
        min_nights: text.match(/minimum (?:stay|nights?)[^\d]{0,10}(\d+)/i)
          ? Number(text.match(/minimum (?:stay|nights?)[^\d]{0,10}(\d+)/i)![1])
          : null,
        max_nights: null,
        check_in_time: text.match(/check[- ]?in[^\d]{0,12}(\d{1,2}[:.]?\d{0,2}\s?[ap]?m?)/i)?.[1] ?? null,
        check_out_time: text.match(/check[- ]?out[^\d]{0,12}(\d{1,2}[:.]?\d{0,2}\s?[ap]?m?)/i)?.[1] ?? null,
      },
      photos,
      host: { name: (ld?.author as Record<string, unknown>)?.name as string ?? null, languages: [] },
      ratings: {
        overall: agg.ratingValue != null ? Number(agg.ratingValue) : null,
        count: agg.reviewCount != null ? Number(agg.reviewCount) : null,
      },
    },
  };
}
