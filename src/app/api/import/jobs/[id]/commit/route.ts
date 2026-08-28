import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { validateDraft, isCommittable, RawExtractionSchema } from "@/lib/schema";

export const runtime = "nodejs";

/**
 * Commit an (optionally host-edited) draft into the real Hostiggo listing
 * tables. The body may be a full ValidatedDraft-shaped object; we re-run it
 * through validation so nothing unvalidated reaches the DB.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getStore();
  const job = await store.getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (job.status === "committed" && job.listing_id)
    return NextResponse.json({ listingId: job.listing_id, alreadyCommitted: true });

  const bodyRaw = await req.json().catch(() => null);
  const edited = bodyRaw?.draft ?? bodyRaw;
  const hasEdit = edited && typeof edited === "object" && Object.keys(edited).length > 0;
  const source = hasEdit
    ? RawExtractionSchema.parse(edited)
    : (job.validated_draft ?? job.raw_extraction);
  if (!source)
    return NextResponse.json(
      { error: "no draft to commit — run the pipeline first" },
      { status: 400 },
    );

  const { draft, report } = validateDraft(source);
  const errs = isCommittable(draft);
  if (errs.length)
    return NextResponse.json({ error: "draft incomplete", issues: errs }, { status: 422 });

  const { listingId } = await store.commitListing(job, draft);
  await store.updateJob(job.id, {
    status: "committed",
    listing_id: listingId,
    validated_draft: draft,
    validation_report: report,
  });
  return NextResponse.json({ listingId });
}
