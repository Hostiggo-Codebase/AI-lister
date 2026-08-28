import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { validateImportUrl, detectProvider } from "@/lib/providers";

export const runtime = "nodejs";

const Body = z.object({
  urls: z.array(z.string().min(1)).min(1).max(40),
  consent: z.literal(true, { message: "Host consent is required." }),
  source_url: z.string().optional(),
  host_name: z.string().nullish(),
  options: z
    .object({
      forceTier2: z.boolean().optional(),
      skipPhotoMirror: z.boolean().optional(),
      llmModel: z.string().optional(),
    })
    .optional(),
});

/** Create one import job per discovered listing, grouped under a batch. */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success)
    return NextResponse.json(
      { error: p.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  const { urls, consent, source_url, host_name, options } = p.data;

  const clean: { url: string; provider: ReturnType<typeof detectProvider>; ext: string | null }[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const c = validateImportUrl(raw);
    if (!c.ok || !c.url) continue;
    const ext =
      c.url.match(/\/rooms\/(\d+)/)?.[1] ??
      c.url.match(/\/hotel\/[a-z]{2}\/([a-z0-9-]+)\./i)?.[1] ??
      c.url.match(/-details.*?(\d+)/)?.[1] ??
      null;
    const dedupeKey = ext ?? c.url;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    clean.push({ url: c.url, provider: c.provider, ext });
  }
  if (clean.length === 0)
    return NextResponse.json({ error: "no valid supported URLs in the list" }, { status: 400 });

  const store = getStore();
  const jobIds: string[] = [];
  for (const c of clean) {
    const job = await store.createJob({
      source_url: c.url,
      provider: c.provider,
      consent,
      external_listing_id: c.ext,
      options: options ?? {},
    });
    jobIds.push(job.id);
  }

  const batch = await store.createBatch({
    source_url: source_url ?? clean[0].url,
    provider: clean[0].provider,
    host_name: host_name ?? null,
    job_ids: jobIds,
  });
  // Tag each job with the batch id.
  for (const id of jobIds) await store.updateJob(id, { batch_id: batch.id });

  return NextResponse.json({ batch, jobIds }, { status: 201 });
}
