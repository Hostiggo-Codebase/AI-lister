import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { fetchIcal } from "@/lib/ical";

export const runtime = "nodejs";

const Body = z.object({ url: z.string().min(1) });

/**
 * Attach an iCal availability feed to an import job. Hostiggo keeps the feed URL
 * per listing and re-pulls it on a schedule; this endpoint does the first pull
 * and previews the blocked dates.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: "url required" }, { status: 400 });

  const store = getStore();
  const job = await store.getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const feed = await fetchIcal(p.data.url);
  await store.updateJob(id, { ical: feed });
  return NextResponse.json({ ical: feed });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getStore();
  const job = await store.getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  await store.updateJob(id, { ical: null });
  return NextResponse.json({ ok: true });
}
