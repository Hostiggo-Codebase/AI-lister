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
- "photos" must be direct image URLs found in the content (og:image, gallery <img> src/srcset, JSON-LD image arrays).
- Prices: report the nightly rate and its ISO-4217 currency (INR for ₹/Rs).
- Return your answer by calling the "emit_listing_draft" tool.`;

function buildContent(page: ParsedPage, provider: Provider): string {
  return [
    `PROVIDER: ${provider}`,
    `PAGE TITLE: ${page.title ?? ""}`,
    `OPENGRAPH: ${JSON.stringify(page.openGraph)}`,
    `META(description/keywords): ${JSON.stringify({
      description: page.meta.description,
      keywords: page.meta.keywords,
    })}`,
    `JSON-LD: ${JSON.stringify(page.jsonLd).slice(0, 12000)}`,
    page.nextData
      ? `EMBEDDED STATE (truncated): ${JSON.stringify(page.nextData).slice(0, 12000)}`
      : "",
    `CANDIDATE IMAGE URLS: ${JSON.stringify(page.imageUrls.slice(0, 60))}`,
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
    max_tokens: 4096,
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

  const priceMatch =
    text.match(/(?:₹|Rs\.?|INR)\s?([\d,]{3,})/i) ||
    text.match(/\$\s?([\d,]{2,})/) ||
    text.match(/([\d,]{3,})\s*(?:per night|\/ ?night|a night)/i);
  const currency = priceMatch
    ? /\$/.test(priceMatch[0])
      ? "USD"
      : "INR"
    : "INR";

  const guestsMatch = text.match(/(\d+)\s*guests?/i);
  const bedroomsMatch = text.match(/(\d+)\s*bedrooms?/i);
  const bedsMatch = text.match(/(\d+)\s*beds?/i);
  const bathMatch = text.match(/(\d+(?:\.\d)?)\s*(?:bath|bathrooms?)/i);

  const amenityHits = [
    "wifi",
    "air conditioning",
    "kitchen",
    "free parking",
    "pool",
    "washer",
    "tv",
    "breakfast",
    "geyser",
    "power backup",
    "balcony",
    "garden",
    "mountain view",
    "pets allowed",
  ].filter((a) => new RegExp(a.replace(/ /g, "[ -]?"), "i").test(text));

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
        (ld?.description as string) ||
        page.meta.description ||
        page.openGraph.description ||
        text.slice(0, 1200),
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
        city: (addr.addressLocality as string) ?? null,
        state: (addr.addressRegion as string) ?? null,
        country: (addr.addressCountry as string) ?? "India",
        postal_code: (addr.postalCode as string) ?? null,
      },
      location: {
        lat: geo.latitude != null ? Number(geo.latitude) : null,
        lng: geo.longitude != null ? Number(geo.longitude) : null,
      },
      capacity: {
        max_guests: guestsMatch ? Number(guestsMatch[1]) : 2,
        bedrooms: bedroomsMatch ? Number(bedroomsMatch[1]) : null,
        beds: bedsMatch ? Number(bedsMatch[1]) : null,
        bathrooms: bathMatch ? Number(bathMatch[1]) : null,
      },
      pricing: {
        nightly_amount: priceMatch
          ? Number(priceMatch[1].replace(/,/g, ""))
          : (ld?.priceRange as string | undefined)?.match(/\d+/)?.[0]
            ? Number((ld!.priceRange as string).match(/\d+/)![0])
            : null,
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
