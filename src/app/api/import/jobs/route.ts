import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { validateImportUrl, type Provider } from "@/lib/providers";
import { FIXTURES } from "@/lib/fixtures";
import { env, hasLLM, hasSupabase } from "@/lib/env";

export const runtime = "nodejs";

const Body = z.object({
  url: z.string().default(""),
  consent: z.literal(true, { message: "Host consent is required to import a listing." }),
  host_id: z.string().uuid().nullish(),
  options: z
    .object({
      forceTier2: z.boolean().optional(),
      skipPhotoMirror: z.boolean().optional(),
      llmModel: z.string().optional(),
      fixtureKey: z.string().optional(),
    })
    .optional(),
});

export async function GET() {
  const store = getStore();
  const jobs = await store.listJobs(30);
  return NextResponse.json({
    mode: {
      storage: store.mode,
      llm: hasLLM() ? "anthropic" : "mock",
      supabase: hasSupabase(),
      maxPhotos: env.maxPhotos,
      tier2Enabled: env.tier2Enabled,
    },
    jobs,
  });
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { url, consent, host_id, options } = parsed.data;

  const opts: Record<string, unknown> = {
    forceTier2: options?.forceTier2,
    skipPhotoMirror: options?.skipPhotoMirror,
    llmModel: options?.llmModel,
  };

  let sourceUrl: string;
  let provider: Provider;
  if (options?.fixtureKey) {
    // Fixture mode: use the bundled page + its canonical URL, skip live fetch.
    const fx = FIXTURES[options.fixtureKey];
    if (!fx) return NextResponse.json({ error: "unknown fixture" }, { status: 400 });
    opts.rawHtmlOverride = fx.html;
    sourceUrl = fx.url;
    provider = fx.provider;
  } else {
    const check = validateImportUrl(url);
    if (!check.ok || !check.url) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    sourceUrl = check.url;
    provider = check.provider;
  }

  const store = getStore();
  const job = await store.createJob({
    source_url: sourceUrl,
    provider,
    consent,
    host_id: host_id ?? null,
    options: opts,
  });

  return NextResponse.json({ job }, { status: 201 });
}
