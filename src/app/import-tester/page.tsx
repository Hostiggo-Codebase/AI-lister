"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectProvider } from "@/lib/providers";
import type { ImportJob, Stage } from "@/lib/types";

const STAGES: Stage[] = [
  "queued",
  "tier1_fetch",
  "truncation_check",
  "tier2_scrape",
  "llm_extract",
  "validate",
  "photo_mirror",
  "done",
];
const STAGE_LABEL: Record<Stage, string> = {
  queued: "Queued",
  tier1_fetch: "Tier 1 fetch",
  truncation_check: "Truncation check",
  tier2_scrape: "Tier 2 scrape",
  llm_extract: "LLM extract",
  validate: "Validate",
  photo_mirror: "Mirror photos",
  done: "Done",
};

type Mode = {
  storage: string;
  llm: string;
  supabase: boolean;
  maxPhotos: number;
  tier2Enabled: boolean;
};
type Fixture = { key: string; label: string; url: string; provider: string };

const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ");

export default function ImportTester() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);

  const [url, setUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [forceTier2, setForceTier2] = useState(false);
  const [skipPhotoMirror, setSkipPhotoMirror] = useState(false);
  const [fixtureKey, setFixtureKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [tab, setTab] = useState<"draft" | "report" | "raw" | "photos">("draft");
  const [draftText, setDraftText] = useState("");
  const [commitMsg, setCommitMsg] = useState<string | null>(null);

  const provider = useMemo(() => (url ? detectProvider(url) : "unknown"), [url]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    const r = await fetch("/api/import/jobs").then((x) => x.json());
    setMode(r.mode);
    setJobs(r.jobs);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadJobs();
    fetch("/api/import/fixtures")
      .then((x) => x.json())
      .then((r) => setFixtures(r.fixtures));
  }, [loadJobs]);

  // poll the selected job while it is running
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selectedId) return;
    const tick = async () => {
      const r = await fetch(`/api/import/jobs/${selectedId}`).then((x) => x.json());
      if (r.job) {
        setJob(r.job);
        if (r.job.validated_draft && tab === "draft" && !draftText)
          setDraftText(JSON.stringify(r.job.validated_draft, null, 2));
        if (["succeeded", "failed", "committed"].includes(r.job.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          loadJobs();
        }
      }
    };
    tick();
    pollRef.current = setInterval(tick, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selectJob = (id: string) => {
    setSelectedId(id);
    setJob(null);
    setDraftText("");
    setCommitMsg(null);
    setTab("draft");
  };

  async function startImport() {
    setErr(null);
    setCommitMsg(null);
    setBusy(true);
    try {
      const fx = fixtures.find((f) => f.key === fixtureKey);
      const res = await fetch("/api/import/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: fx ? fx.url : url,
          consent,
          options: {
            forceTier2,
            skipPhotoMirror,
            fixtureKey: fixtureKey || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to create job");
      selectJob(data.job.id);
      await fetch("/api/import/worker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: data.job.id }),
      });
      loadJobs();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    if (!job) return;
    setBusy(true);
    setCommitMsg(null);
    setDraftText("");
    try {
      await fetch("/api/import/worker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      setSelectedId(job.id + ""); // retrigger poll effect
      setSelectedId(job.id);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!job) return;
    setCommitMsg(null);
    setErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftText);
    } catch {
      setErr("Draft JSON is invalid");
      return;
    }
    const res = await fetch(`/api/import/jobs/${job.id}/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: parsed }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr((data.error || "commit failed") + (data.issues ? `: ${data.issues.join(", ")}` : ""));
      return;
    }
    setCommitMsg(`Committed → listing ${data.listingId}`);
    fetch(`/api/import/jobs/${job.id}`).then((x) => x.json()).then((r) => setJob(r.job));
    loadJobs();
  }

  const currentStageIdx = job ? STAGES.indexOf(job.stage) : -1;

  return (
    <div className="mx-auto max-w-7xl p-6 text-sm">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Hostiggo · OTA Listing Importer — Playground</h1>
        <p className="mt-1 text-neutral-500">
          Paste an existing Airbnb / Booking.com / Agoda / MakeMyTrip / Goibibo listing URL,
          confirm host consent, and watch the tiered extraction pipeline build a Hostiggo draft.
        </p>
        {mode && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge>storage: {mode.storage}</Badge>
            <Badge>LLM: {mode.llm}</Badge>
            <Badge>tier 2: {mode.tier2Enabled ? "enabled" : "off"}</Badge>
            <Badge>max photos: {mode.maxPhotos}</Badge>
          </div>
        )}
      </header>

      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* -------- left: form + job list -------- */}
        <aside className="space-y-4">
          <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <label className="block font-medium">Listing URL</label>
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setFixtureKey("");
              }}
              placeholder="https://www.airbnb.co.in/rooms/…"
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <div className="mt-1 text-xs">
              provider:{" "}
              <span className={cls(provider === "unknown" ? "text-red-500" : "text-emerald-600")}>
                {provider}
              </span>
            </div>

            <label className="mt-3 block font-medium">…or load a bundled fixture</label>
            <select
              value={fixtureKey}
              onChange={(e) => {
                setFixtureKey(e.target.value);
                const f = fixtures.find((x) => x.key === e.target.value);
                if (f) setUrl(f.url);
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">— none (live fetch) —</option>
              {fixtures.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>

            <div className="mt-3 space-y-1">
              <Check checked={forceTier2} onChange={setForceTier2} label="Force Tier 2 (headless)" />
              <Check checked={skipPhotoMirror} onChange={setSkipPhotoMirror} label="Skip photo mirroring" />
              <Check checked={consent} onChange={setConsent} label="Host consents to import their own listing" />
            </div>

            <button
              onClick={startImport}
              disabled={busy || !consent || (!fixtureKey && provider === "unknown")}
              className="mt-3 w-full rounded bg-black px-3 py-2 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {busy ? "Working…" : "Start import"}
            </button>
            {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
          </section>

          <section className="rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="border-b border-neutral-200 px-3 py-2 font-medium dark:border-neutral-800">
              Recent jobs
            </div>
            <ul className="max-h-[50vh] overflow-auto">
              {jobs.map((j) => (
                <li key={j.id}>
                  <button
                    onClick={() => selectJob(j.id)}
                    className={cls(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900",
                      selectedId === j.id && "bg-neutral-100 dark:bg-neutral-900",
                    )}
                  >
                    <span className="truncate">{j.provider} · {j.source_url.replace(/^https?:\/\//, "")}</span>
                    <StatusPill status={j.status} />
                  </button>
                </li>
              ))}
              {jobs.length === 0 && <li className="px-3 py-4 text-xs text-neutral-500">No jobs yet.</li>}
            </ul>
          </section>
        </aside>

        {/* -------- right: job detail -------- */}
        <main>
          {!job && <p className="text-neutral-500">Select or start a job.</p>}
          {job && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={job.status} />
                {job.tier_used && <Badge>tier {job.tier_used}</Badge>}
                {job.truncated != null && (
                  <Badge>{job.truncated ? "truncated → tier 2" : "tier 1 complete"}</Badge>
                )}
                {job.llm_model && <Badge>{job.llm_model}</Badge>}
                <button
                  onClick={rerun}
                  disabled={busy}
                  className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
                >
                  Re-run pipeline
                </button>
              </div>

              {/* stage timeline */}
              <div className="flex flex-wrap gap-1">
                {STAGES.map((s, i) => (
                  <span
                    key={s}
                    className={cls(
                      "rounded px-2 py-1 text-xs",
                      job.status === "failed" && i === currentStageIdx
                        ? "bg-red-500 text-white"
                        : i < currentStageIdx || job.status === "succeeded" || job.status === "committed"
                          ? "bg-emerald-500 text-white"
                          : i === currentStageIdx
                            ? "bg-amber-400 text-black"
                            : "bg-neutral-200 text-neutral-500 dark:bg-neutral-800",
                    )}
                  >
                    {STAGE_LABEL[s]}
                  </span>
                ))}
              </div>

              {job.truncation_reasons?.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                  <b>Truncation signals:</b> {job.truncation_reasons.join(" · ")}
                </div>
              )}
              {job.error && (
                <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30">
                  {job.error}
                </div>
              )}

              {/* logs */}
              <details open className="rounded border border-neutral-200 dark:border-neutral-800">
                <summary className="cursor-pointer px-3 py-2 font-medium">Pipeline log ({job.logs.length})</summary>
                <pre className="max-h-56 overflow-auto px-3 pb-3 text-xs leading-relaxed">
                  {job.logs
                    .map((l) => `${l.ts.slice(11, 19)} [${l.stage}] ${l.level === "info" ? "" : l.level.toUpperCase() + " "}${l.msg}`)
                    .join("\n")}
                </pre>
              </details>

              {/* tabs */}
              <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
                {(["draft", "report", "raw", "photos"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cls(
                      "px-3 py-1.5 text-xs capitalize",
                      tab === t ? "border-b-2 border-black font-medium dark:border-white" : "text-neutral-500",
                    )}
                  >
                    {t === "raw" ? "raw LLM JSON" : t === "report" ? "validation report" : t}
                  </button>
                ))}
              </div>

              {tab === "draft" && (
                <div>
                  <p className="mb-1 text-xs text-neutral-500">
                    Editable validated draft — edit the JSON, then commit into the Hostiggo listing tables.
                  </p>
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    spellCheck={false}
                    className="h-96 w-full rounded border border-neutral-300 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={commit}
                      disabled={!draftText || job.status === "committed"}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {job.status === "committed" ? "Committed" : "Commit to Hostiggo"}
                    </button>
                    {job.listing_id && <span className="text-xs">listing: <code>{job.listing_id}</code></span>}
                    {commitMsg && <span className="text-xs text-emerald-600">{commitMsg}</span>}
                  </div>
                </div>
              )}

              {tab === "report" && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="py-1">Field</th>
                      <th>Status</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(job.validation_report ?? []).map((r, i) => (
                      <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                        <td className="py-1 font-mono">{r.path}</td>
                        <td>
                          <span
                            className={cls(
                              "rounded px-1.5 py-0.5",
                              r.status === "ok" && "bg-emerald-100 text-emerald-700",
                              r.status === "coerced" && "bg-blue-100 text-blue-700",
                              r.status === "clamped" && "bg-amber-100 text-amber-700",
                              r.status === "dropped" && "bg-red-100 text-red-700",
                              r.status === "missing" && "bg-neutral-200 text-neutral-600",
                            )}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td>{r.note}</td>
                      </tr>
                    ))}
                    {(job.validation_report ?? []).length === 0 && (
                      <tr><td colSpan={3} className="py-3 text-neutral-500">No report yet.</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {tab === "raw" && (
                <pre className="max-h-[32rem] overflow-auto rounded border border-neutral-200 p-3 text-xs dark:border-neutral-800">
                  {JSON.stringify(job.raw_extraction, null, 2) || "—"}
                </pre>
              )}

              {tab === "photos" && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {(job.photos ?? []).map((p) => (
                    <figure key={p.idx} className="rounded border border-neutral-200 p-1 text-xs dark:border-neutral-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.public_url || p.original_url}
                        alt=""
                        className="h-28 w-full rounded object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")}
                      />
                      <figcaption className="mt-1 flex items-center justify-between">
                        <span>#{p.idx}</span>
                        <span
                          className={cls(
                            p.status === "mirrored" && "text-emerald-600",
                            p.status === "failed" && "text-red-500",
                            p.status === "pending" && "text-neutral-400",
                          )}
                        >
                          {p.status}
                        </span>
                      </figcaption>
                      {p.error && <div className="text-red-500">{p.error}</div>}
                    </figure>
                  ))}
                  {(job.photos ?? []).length === 0 && (
                    <p className="text-neutral-500">No photos mirrored.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      {children}
    </span>
  );
}
function StatusPill({ status }: { status: string }) {
  const c: Record<string, string> = {
    queued: "bg-neutral-300 text-neutral-800",
    running: "bg-amber-400 text-black",
    succeeded: "bg-emerald-500 text-white",
    committed: "bg-emerald-700 text-white",
    failed: "bg-red-500 text-white",
  };
  return <span className={cls("rounded px-1.5 py-0.5 text-xs", c[status])}>{status}</span>;
}
function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
