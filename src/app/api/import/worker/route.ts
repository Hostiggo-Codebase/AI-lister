import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { runPipeline } from "@/lib/pipeline";
import type { ImportJob } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z
  .object({
    jobId: z.string().uuid().optional(),
    all: z.boolean().optional(),
    max: z.number().int().min(1).max(40).optional(),
  })
  .partial();

/**
 * Process one job. With `{jobId}` it re-runs that specific job; otherwise it
 * claims the oldest queued job. In production this is invoked by a cron/queue;
 * in the playground the "Process" button hits it directly.
 */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const body = p.data;
  const store = getStore();

  let job: ImportJob | null;
  if (body?.jobId) {
    job = await store.getJob(body.jobId);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    job = await store.updateJob(job.id, {
      status: "running",
      stage: "queued",
      error: null,
      logs: [],
      photos: [],
      fx: null,
      coverage: null,
      recommendations: [],
    });
  } else if (body?.all) {
    // Drain the queue (used by the multi-listing batch flow).
    const ids: string[] = [];
    const limit = body.max ?? 20;
    for (let i = 0; i < limit; i++) {
      const next = await store.claimNextQueued();
      if (!next) break;
      const d = await runPipeline(next);
      ids.push(d.id);
    }
    return NextResponse.json({ processed: ids.length, jobIds: ids });
  } else {
    job = await store.claimNextQueued();
    if (!job) return NextResponse.json({ processed: false, reason: "no queued jobs" });
  }

  const done = await runPipeline(job);
  return NextResponse.json({ processed: true, job: done });
}
