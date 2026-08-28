import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getStore();
  const batch = await store.getBatch(id);
  if (!batch) return NextResponse.json({ error: "not found" }, { status: 404 });

  const jobs = await Promise.all(batch.job_ids.map((jid) => store.getJob(jid)));
  return NextResponse.json({
    batch,
    jobs: jobs
      .filter((j): j is NonNullable<typeof j> => !!j)
      .map((j) => ({
        id: j.id,
        source_url: j.source_url,
        external_listing_id: j.external_listing_id,
        status: j.status,
        stage: j.stage,
        tier_used: j.tier_used,
        title: j.validated_draft?.title ?? null,
        nightly_inr: j.validated_draft?.pricing.nightly_amount ?? null,
        photos: j.photos.filter((p) => p.status === "mirrored").length,
        coverage_pct: j.coverage?.summary.percent_prefilled ?? null,
        required_unresolved: j.coverage?.summary.required_unresolved ?? null,
        recommendations: j.recommendations.length,
        listing_id: j.listing_id,
        error: j.error,
      })),
  });
}
