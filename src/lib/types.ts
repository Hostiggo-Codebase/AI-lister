import type { Provider } from "./providers";
import type { RawExtraction, ValidatedDraft, FieldNote } from "./schema";
import type { FxConversion } from "./fx";
import type { Coverage } from "./fieldCoverage";
import type { Recommendation } from "./recommendations";
import type { IcalFeed } from "./ical";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "committed";

export type Stage =
  | "queued"
  | "tier1_fetch"
  | "truncation_check"
  | "tier2_scrape"
  | "llm_extract"
  | "validate"
  | "fx_convert"
  | "coverage"
  | "photo_mirror"
  | "done";

export type LogEntry = {
  ts: string;
  stage: Stage;
  level: "info" | "warn" | "error";
  msg: string;
};

export type MirroredPhoto = {
  idx: number;
  original_url: string;
  storage_path: string | null;
  public_url: string | null;
  content_type: string | null;
  bytes: number | null;
  status: "pending" | "mirrored" | "failed";
  error: string | null;
  caption: string | null;
};

export type ImportOptions = {
  forceTier2?: boolean;
  skipPhotoMirror?: boolean;
  rawHtmlOverride?: string;
  llmModel?: string;
};

export type ImportJob = {
  id: string;
  batch_id: string | null;
  host_id: string | null;
  source_url: string;
  external_listing_id: string | null;
  provider: Provider;
  consent: boolean;
  status: JobStatus;
  stage: Stage;
  options: ImportOptions;
  tier_used: 1 | 2 | null;
  raw_html_bytes: number | null;
  truncated: boolean | null;
  truncation_reasons: string[];
  llm_model: string | null;
  raw_extraction: RawExtraction | null;
  validated_draft: ValidatedDraft | null;
  validation_report: FieldNote[];
  fx: FxConversion | null;
  coverage: Coverage | null;
  recommendations: Recommendation[];
  ical: IcalFeed | null;
  photos: MirroredPhoto[];
  logs: LogEntry[];
  error: string | null;
  listing_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NewJobInput = {
  source_url: string;
  provider: Provider;
  consent: boolean;
  host_id?: string | null;
  options?: ImportOptions;
  batch_id?: string | null;
  external_listing_id?: string | null;
};

export type ImportBatch = {
  id: string;
  source_url: string;
  provider: Provider;
  host_name: string | null;
  job_ids: string[];
  created_at: string;
};
