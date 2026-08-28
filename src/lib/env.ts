/** Central env access. Everything is optional: absent values switch the
 *  pipeline into local/offline mode (in-memory store, fixtures, mock LLM). */

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseBucket: process.env.SUPABASE_IMPORT_BUCKET || "listing-imports",

  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  llmModel: process.env.IMPORT_LLM_MODEL || "claude-sonnet-5",

  maxPhotos: num(process.env.IMPORT_MAX_PHOTOS, 40),
  tier2Enabled: (process.env.IMPORT_TIER2_ENABLED ?? "true") !== "false",
  fetchTimeoutMs: num(process.env.IMPORT_FETCH_TIMEOUT_MS, 15000),
  photoMaxBytes: num(process.env.IMPORT_PHOTO_MAX_BYTES, 8_000_000),
};

export const hasSupabase = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);
export const hasLLM = () => Boolean(env.anthropicKey);

export type RuntimeMode = {
  storage: "supabase" | "memory";
  llm: "anthropic" | "mock";
  tier2: "playwright" | "unavailable";
};
