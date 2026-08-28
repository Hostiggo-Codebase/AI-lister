import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "./env";
import type { ImportJob, NewJobInput, ImportBatch } from "./types";
import type { ValidatedDraft } from "./schema";
import type { Provider } from "./providers";

/* ------------------------------------------------------------------ *
 * Storage abstraction: Supabase when configured, else in-process.    *
 * ------------------------------------------------------------------ */

export interface Store {
  mode: "supabase" | "memory";
  createJob(input: NewJobInput): Promise<ImportJob>;
  getJob(id: string): Promise<ImportJob | null>;
  listJobs(limit?: number): Promise<ImportJob[]>;
  updateJob(id: string, patch: Partial<ImportJob>): Promise<ImportJob>;
  claimNextQueued(): Promise<ImportJob | null>;
  createBatch(input: {
    source_url: string;
    provider: Provider;
    host_name: string | null;
    job_ids: string[];
  }): Promise<ImportBatch>;
  getBatch(id: string): Promise<ImportBatch | null>;
  listBatches(limit?: number): Promise<ImportBatch[]>;
  putPhoto(
    jobId: string,
    idx: number,
    bytes: Buffer,
    contentType: string,
  ): Promise<{ path: string; publicUrl: string }>;
  commitListing(job: ImportJob, draft: ValidatedDraft): Promise<{ listingId: string }>;
}

const now = () => new Date().toISOString();

function blankJob(input: NewJobInput): ImportJob {
  return {
    id: randomUUID(),
    batch_id: input.batch_id ?? null,
    host_id: input.host_id ?? null,
    source_url: input.source_url,
    external_listing_id: input.external_listing_id ?? null,
    provider: input.provider,
    consent: input.consent,
    status: "queued",
    stage: "queued",
    options: input.options ?? {},
    tier_used: null,
    raw_html_bytes: null,
    truncated: null,
    truncation_reasons: [],
    llm_model: null,
    raw_extraction: null,
    validated_draft: null,
    validation_report: [],
    fx: null,
    coverage: null,
    recommendations: [],
    ical: null,
    photos: [],
    logs: [],
    error: null,
    listing_id: null,
    created_at: now(),
    updated_at: now(),
  };
}

/* ----------------------------- memory ----------------------------- */

type MemDB = {
  jobs: Map<string, ImportJob>;
  listings: Map<string, unknown>;
  batches: Map<string, ImportBatch>;
};
const g = globalThis as unknown as { __hostiggoDB?: MemDB };
const mem: MemDB = (g.__hostiggoDB ??= {
  jobs: new Map(),
  listings: new Map(),
  batches: new Map(),
});

const MIRROR_DIR = path.join(process.cwd(), "public", "import-mirror");

class MemoryStore implements Store {
  mode = "memory" as const;

  async createJob(input: NewJobInput) {
    const job = blankJob(input);
    mem.jobs.set(job.id, job);
    return structuredClone(job);
  }
  async getJob(id: string) {
    const j = mem.jobs.get(id);
    return j ? structuredClone(j) : null;
  }
  async listJobs(limit = 25) {
    return [...mem.jobs.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }
  async updateJob(id: string, patch: Partial<ImportJob>) {
    const j = mem.jobs.get(id);
    if (!j) throw new Error(`job ${id} not found`);
    Object.assign(j, patch, { updated_at: now() });
    return structuredClone(j);
  }
  async claimNextQueued() {
    const next = [...mem.jobs.values()]
      .filter((j) => j.status === "queued")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (!next) return null;
    next.status = "running";
    next.updated_at = now();
    return structuredClone(next);
  }
  async createBatch(input: {
    source_url: string;
    provider: Provider;
    host_name: string | null;
    job_ids: string[];
  }) {
    const batch: ImportBatch = {
      id: randomUUID(),
      source_url: input.source_url,
      provider: input.provider,
      host_name: input.host_name,
      job_ids: input.job_ids,
      created_at: now(),
    };
    mem.batches.set(batch.id, batch);
    return structuredClone(batch);
  }
  async getBatch(id: string) {
    const b = mem.batches.get(id);
    return b ? structuredClone(b) : null;
  }
  async listBatches(limit = 20) {
    return [...mem.batches.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((b) => structuredClone(b));
  }
  async putPhoto(jobId: string, idx: number, bytes: Buffer, contentType: string) {
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";
    const dir = path.join(MIRROR_DIR, jobId);
    await fs.mkdir(dir, { recursive: true });
    const file = `${idx}.${ext}`;
    await fs.writeFile(path.join(dir, file), bytes);
    return { path: `${jobId}/${file}`, publicUrl: `/import-mirror/${jobId}/${file}` };
  }
  async commitListing(job: ImportJob, draft: ValidatedDraft) {
    const listingId = randomUUID();
    mem.listings.set(listingId, {
      id: listingId,
      host_id: job.host_id,
      ...draft,
      status: "draft",
      imported_from_job_id: job.id,
      created_at: now(),
    });
    return { listingId };
  }
}

/* ---------------------------- supabase ---------------------------- */

class SupabaseStore implements Store {
  mode = "supabase" as const;
  private db: SupabaseClient;
  constructor() {
    this.db = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  private rowToJob = (r: Record<string, unknown>) => r as unknown as ImportJob;

  async createJob(input: NewJobInput) {
    const job = blankJob(input);
    const { error } = await this.db.from("import_jobs").insert(job);
    if (error) throw error;
    return job;
  }
  async getJob(id: string) {
    const { data, error } = await this.db
      .from("import_jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? this.rowToJob(data) : null;
  }
  async listJobs(limit = 25) {
    const { data, error } = await this.db
      .from("import_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(this.rowToJob);
  }
  async updateJob(id: string, patch: Partial<ImportJob>) {
    const { data, error } = await this.db
      .from("import_jobs")
      .update({ ...patch, updated_at: now() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return this.rowToJob(data);
  }
  async claimNextQueued() {
    // Atomic-ish claim: flip the oldest queued row to running.
    const { data: cand } = await this.db
      .from("import_jobs")
      .select("id")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!cand) return null;
    const { data, error } = await this.db
      .from("import_jobs")
      .update({ status: "running", updated_at: now() })
      .eq("id", (cand as { id: string }).id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? this.rowToJob(data) : null;
  }
  async createBatch(input: {
    source_url: string;
    provider: Provider;
    host_name: string | null;
    job_ids: string[];
  }) {
    const batch: ImportBatch = {
      id: randomUUID(),
      source_url: input.source_url,
      provider: input.provider,
      host_name: input.host_name,
      job_ids: input.job_ids,
      created_at: now(),
    };
    const { error } = await this.db.from("import_batches").insert(batch);
    if (error) throw error;
    return batch;
  }
  async getBatch(id: string) {
    const { data, error } = await this.db
      .from("import_batches")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as ImportBatch | null) ?? null;
  }
  async listBatches(limit = 20) {
    const { data, error } = await this.db
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ImportBatch[];
  }
  async putPhoto(jobId: string, idx: number, bytes: Buffer, contentType: string) {
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";
    const key = `${jobId}/${idx}.${ext}`;
    const { error } = await this.db.storage
      .from(env.supabaseBucket)
      .upload(key, bytes, { contentType, upsert: true });
    if (error) throw error;
    const { data } = this.db.storage.from(env.supabaseBucket).getPublicUrl(key);
    return { path: key, publicUrl: data.publicUrl };
  }
  async commitListing(job: ImportJob, draft: ValidatedDraft) {
    const listingId = randomUUID();
    const { error } = await this.db.from("listings").insert({
      id: listingId,
      host_id: job.host_id,
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      property_type: draft.property_type,
      room_type: draft.room_type,
      address_line: draft.address.line,
      city: draft.address.city,
      state: draft.address.state,
      country: draft.address.country,
      pincode: draft.address.postal_code,
      lat: draft.location.lat,
      lng: draft.location.lng,
      max_guests: draft.capacity.max_guests,
      bedrooms: draft.capacity.bedrooms,
      beds: draft.capacity.beds,
      bathrooms: draft.capacity.bathrooms,
      base_price: draft.pricing.nightly_amount,
      currency: draft.pricing.currency,
      cleaning_fee: draft.pricing.cleaning_fee,
      amenities: draft.amenities,
      house_rules: draft.house_rules,
      cancellation_policy: draft.cancellation_policy,
      min_nights: draft.availability.min_nights,
      max_nights: draft.availability.max_nights,
      check_in_time: draft.availability.check_in_time,
      check_out_time: draft.availability.check_out_time,
      status: "draft",
      imported_from_job_id: job.id,
    });
    if (error) throw error;
    const rows = job.photos
      .filter((p) => p.status === "mirrored" && p.public_url)
      .map((p, i) => ({
        listing_id: listingId,
        storage_path: p.storage_path,
        public_url: p.public_url,
        sort_order: i,
        is_cover: i === 0,
        caption: p.caption,
      }));
    if (rows.length) {
      const { error: pe } = await this.db.from("listing_photos").insert(rows);
      if (pe) throw pe;
    }
    return { listingId };
  }
}

let _store: Store | null = null;
export function getStore(): Store {
  if (!_store) _store = hasSupabase() ? new SupabaseStore() : new MemoryStore();
  return _store;
}
