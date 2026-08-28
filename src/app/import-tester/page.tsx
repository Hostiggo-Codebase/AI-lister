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
  "fx_convert",
  "coverage",
  "photo_mirror",
  "done",
];
const STAGE_LABEL: Record<Stage, string> = {
  queued: "Queued",
  tier1_fetch: "Tier 1",
  truncation_check: "Truncation",
  tier2_scrape: "Tier 2",
  llm_extract: "LLM",
  validate: "Validate",
  fx_convert: "FX→INR",
  coverage: "Coverage",
  photo_mirror: "Photos",
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
type Discovered = { url: string; external_id: string; title: string | null; thumbnail: string | null };

const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ");
const j = (u: string) => fetch(u).then((r) => r.json());
const post = (u: string, body?: unknown) =>
  fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(
    (r) => r.json().then((d) => ({ ok: r.ok, d })),
  );

export default function ImportTester() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [tab, setTab] = useState<"single" | "profile">("single");

  return (
    <div className="mx-auto max-w-7xl p-6 text-sm">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Hostiggo · OTA Listing Importer — Playground</h1>
        <p className="mt-1 text-neutral-500">
          Import an existing Airbnb / Booking / Agoda / MakeMyTrip / Goibibo listing (or a whole host
          profile) into a Hostiggo draft, with field-coverage scoring, FX→INR, iCal sync and
          improvement tips.
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

      <div className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {(["single", "profile"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cls(
              "px-3 py-1.5",
              tab === t ? "border-b-2 border-black font-medium dark:border-white" : "text-neutral-500",
            )}
          >
            {t === "single" ? "Single listing" : "Host profile (multi-listing)"}
          </button>
        ))}
      </div>

      {tab === "single" ? <SingleFlow onMode={setMode} /> : <ProfileFlow onMode={setMode} />}
    </div>
  );
}

/* ================================================================== *
 * SINGLE LISTING FLOW                                                 *
 * ================================================================== */
function SingleFlow({ onMode }: { onMode: (m: Mode) => void }) {
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

  const provider = useMemo(() => (url ? detectProvider(url) : "unknown"), [url]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    const r = await j("/api/import/jobs");
    onMode(r.mode);
    setJobs(r.jobs.filter((x: ImportJob) => !x.batch_id));
  }, [onMode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadJobs();
    j("/api/import/fixtures").then((r) => setFixtures(r.fixtures));
  }, [loadJobs]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selectedId) return;
    const tick = async () => {
      const r = await j(`/api/import/jobs/${selectedId}`);
      if (r.job) {
        setJob(r.job);
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

  async function startImport() {
    setErr(null);
    setBusy(true);
    try {
      const fx = fixtures.find((f) => f.key === fixtureKey);
      const { ok, d } = await post("/api/import/jobs", {
        url: fx ? fx.url : url,
        consent,
        options: { forceTier2, skipPhotoMirror, fixtureKey: fixtureKey || undefined },
      });
      if (!ok) throw new Error(d.error || "failed to create job");
      setSelectedId(d.job.id);
      setJob(null);
      await post("/api/import/worker", { jobId: d.job.id });
      loadJobs();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
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
            <span className={provider === "unknown" ? "text-red-500" : "text-emerald-600"}>{provider}</span>
          </div>

          <label className="mt-3 block font-medium">…or a bundled fixture</label>
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
            <Check checked={consent} onChange={setConsent} label="Host owns this listing" />
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
            {jobs.map((jb) => (
              <li key={jb.id}>
                <button
                  onClick={() => {
                    setSelectedId(jb.id);
                    setJob(null);
                  }}
                  className={cls(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900",
                    selectedId === jb.id && "bg-neutral-100 dark:bg-neutral-900",
                  )}
                >
                  <span className="truncate">{jb.provider} · {jb.source_url.replace(/^https?:\/\//, "")}</span>
                  <StatusPill status={jb.status} />
                </button>
              </li>
            ))}
            {jobs.length === 0 && <li className="px-3 py-4 text-xs text-neutral-500">No jobs yet.</li>}
          </ul>
        </section>
      </aside>

      <main>
        {!job && <p className="text-neutral-500">Select or start a job.</p>}
        {job && <JobDetail job={job} onChanged={(jb) => { setJob(jb); loadJobs(); }} />}
      </main>
    </div>
  );
}

/* ================================================================== *
 * HOST PROFILE (MULTI-LISTING) FLOW                                   *
 * ================================================================== */
function ProfileFlow({ onMode }: { onMode: (m: Mode) => void }) {
  const [url, setUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [forceTier2, setForceTier2] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{ host_name: string | null; tier_used: number; note: string | null; listings: Discovered[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState<Record<string, unknown>[]>([]);
  const [running, setRunning] = useState(false);
  const [openJob, setOpenJob] = useState<ImportJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    j("/api/import/jobs").then((r) => onMode(r.mode));
  }, [onMode]);

  async function doScan() {
    setErr(null);
    setScanning(true);
    setScan(null);
    setBatchId(null);
    try {
      const { ok, d } = await post("/api/import/profile", { url });
      if (!ok) throw new Error(d.error || "scan failed");
      setScan(d.scan);
      setPicked(new Set(d.scan.listings.map((l: Discovered) => l.url)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function importPicked() {
    if (!scan) return;
    setErr(null);
    setRunning(true);
    try {
      const urls = [...picked];
      const { ok, d } = await post("/api/import/batch", {
        urls,
        consent,
        source_url: url,
        host_name: scan.host_name,
        options: { forceTier2 },
      });
      if (!ok) throw new Error(d.error || "batch create failed");
      setBatchId(d.batch.id);
      // drain the queue
      post("/api/import/worker", { all: true, max: urls.length }).then(() => pollBatch(d.batch.id));
      pollBatch(d.batch.id);
    } catch (e) {
      setErr((e as Error).message);
      setRunning(false);
    }
  }

  const pollBatch = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      const r = await j(`/api/import/batch/${id}`);
      if (r.jobs) {
        setBatchRows(r.jobs);
        if (r.jobs.every((x: { status: string }) => ["succeeded", "failed", "committed"].includes(x.status))) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
        }
      }
    };
    tick();
    pollRef.current = setInterval(tick, 1600);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const toggle = (u: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <label className="block font-medium">Host profile / search / wishlist URL</label>
        <div className="mt-1 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.airbnb.co.in/users/show/123456"
            className="w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={doScan}
            disabled={scanning || !url}
            className="shrink-0 rounded bg-black px-3 py-1 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </div>
        <div className="mt-2 flex gap-4">
          <Check checked={forceTier2} onChange={setForceTier2} label="Force Tier 2 for each listing" />
          <Check checked={consent} onChange={setConsent} label="Host owns all these listings" />
        </div>
        {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
      </section>

      {scan && (
        <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <b>{scan.listings.length}</b> listing(s) found
              {scan.host_name && <> for <b>{scan.host_name}</b></>} · tier {scan.tier_used}
              {scan.note && <span className="text-amber-600"> · {scan.note}</span>}
            </div>
            <button
              onClick={importPicked}
              disabled={running || picked.size === 0 || !consent}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Import {picked.size} selected
            </button>
          </div>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {scan.listings.map((l) => (
              <li key={l.url} className="flex items-center gap-2 rounded border border-neutral-200 p-1.5 text-xs dark:border-neutral-800">
                <input type="checkbox" checked={picked.has(l.url)} onChange={() => toggle(l.url)} />
                {l.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.thumbnail} alt="" className="h-10 w-14 rounded object-cover" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.title || `Listing ${l.external_id}`}</div>
                  <div className="truncate text-neutral-500">{l.url.replace(/^https?:\/\//, "")}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {batchId && (
        <section className="rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="border-b border-neutral-200 px-3 py-2 font-medium dark:border-neutral-800">
            Batch progress {running && "· running…"}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="px-3 py-1">Listing</th>
                <th>Status</th>
                <th>Tier</th>
                <th>₹/night</th>
                <th>Photos</th>
                <th>Coverage</th>
                <th>Tips</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batchRows.map((r) => {
                const row = r as {
                  id: string; status: string; stage: string; tier_used: number | null;
                  title: string | null; nightly_inr: number | null; photos: number;
                  coverage_pct: number | null; required_unresolved: number | null;
                  recommendations: number; source_url: string; error: string | null;
                };
                return (
                  <tr key={row.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-1">
                      <div className="max-w-[240px] truncate">{row.title || row.source_url.replace(/^https?:\/\//, "")}</div>
                      {row.error && <div className="text-red-500">{row.error}</div>}
                    </td>
                    <td><StatusPill status={row.status} /> <span className="text-neutral-400">{row.status === "running" ? row.stage : ""}</span></td>
                    <td>{row.tier_used ?? "—"}</td>
                    <td>{row.nightly_inr != null ? `₹${row.nightly_inr}` : "—"}</td>
                    <td>{row.photos}</td>
                    <td>
                      {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                      {row.required_unresolved ? <span className="text-red-500"> ({row.required_unresolved} req)</span> : null}
                    </td>
                    <td>{row.recommendations || "—"}</td>
                    <td>
                      <button
                        onClick={() => j(`/api/import/jobs/${row.id}`).then((x) => setOpenJob(x.job))}
                        className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-700"
                      >
                        open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {openJob && (
        <section className="rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
          <button onClick={() => setOpenJob(null)} className="mb-2 text-xs text-neutral-500">← close</button>
          <JobDetail job={openJob} onChanged={setOpenJob} />
        </section>
      )}
    </div>
  );
}

/* ================================================================== *
 * SHARED JOB DETAIL                                                   *
 * ================================================================== */
function JobDetail({ job, onChanged }: { job: ImportJob; onChanged: (j: ImportJob) => void }) {
  const [tab, setTab] = useState<"coverage" | "tips" | "draft" | "report" | "raw" | "photos" | "ical">("coverage");
  const [draftText, setDraftText] = useState("");
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [icalUrl, setIcalUrl] = useState("");
  const [icalBusy, setIcalBusy] = useState(false);

  // The textarea shows the host's edits once they start typing, otherwise it
  // mirrors the live validated draft — no effect needed, so polling can't
  // clobber edits and switching jobs resets cleanly.
  const [editKey, setEditKey] = useState<string | null>(null);
  const pretty = job.validated_draft ? JSON.stringify(job.validated_draft, null, 2) : "";
  const draftValue = editKey === job.id ? draftText : pretty;
  const onDraftChange = (v: string) => {
    setEditKey(job.id);
    setDraftText(v);
  };

  const currentStageIdx = STAGES.indexOf(job.stage);

  async function rerun() {
    setCommitMsg(null);
    const { d } = await post("/api/import/worker", { jobId: job.id });
    if (d.job) onChanged(d.job);
  }
  async function commit() {
    setErr(null);
    setCommitMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftValue);
    } catch {
      setErr("Draft JSON is invalid");
      return;
    }
    const { ok, d } = await post(`/api/import/jobs/${job.id}/commit`, { draft: parsed });
    if (!ok) {
      setErr((d.error || "commit failed") + (d.issues ? `: ${d.issues.join(", ")}` : ""));
      return;
    }
    setCommitMsg(`Committed → listing ${d.listingId}`);
    j(`/api/import/jobs/${job.id}`).then((r) => onChanged(r.job));
  }
  async function attachIcal() {
    setIcalBusy(true);
    const { d } = await post(`/api/import/jobs/${job.id}/ical`, { url: icalUrl });
    if (d.ical) {
      const r = await j(`/api/import/jobs/${job.id}`);
      onChanged(r.job);
    }
    setIcalBusy(false);
  }

  const cov = job.coverage;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={job.status} />
        {job.tier_used && <Badge>tier {job.tier_used}</Badge>}
        {job.truncated != null && <Badge>{job.truncated ? "→ tier 2" : "tier 1 ok"}</Badge>}
        {job.llm_model && <Badge>{job.llm_model}</Badge>}
        {job.fx && job.fx.source_currency !== "INR" && (
          <Badge>{job.fx.source_amount} {job.fx.source_currency} → ₹{job.fx.inr_amount ?? "?"}</Badge>
        )}
        {cov && <Badge>{cov.summary.percent_prefilled}% pre-filled</Badge>}
        <button onClick={rerun} className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
          Re-run
        </button>
      </div>

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

      {job.error && (
        <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30">{job.error}</div>
      )}

      <details className="rounded border border-neutral-200 dark:border-neutral-800">
        <summary className="cursor-pointer px-3 py-2 font-medium">Pipeline log ({job.logs.length})</summary>
        <pre className="max-h-56 overflow-auto px-3 pb-3 text-xs leading-relaxed">
          {job.logs.map((l) => `${l.ts.slice(11, 19)} [${l.stage}] ${l.level !== "info" ? l.level.toUpperCase() + " " : ""}${l.msg}`).join("\n")}
        </pre>
      </details>

      <div className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {(["coverage", "tips", "draft", "report", "raw", "photos", "ical"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cls(
              "px-3 py-1.5 text-xs capitalize",
              tab === t ? "border-b-2 border-black font-medium dark:border-white" : "text-neutral-500",
            )}
          >
            {t === "raw" ? "raw LLM" : t === "report" ? "validation" : t === "tips" ? `tips (${job.recommendations.length})` : t}
          </button>
        ))}
      </div>

      {tab === "coverage" && cov && (
        <div>
          <div className="mb-2 flex gap-2 text-xs">
            <Badge>auto {cov.summary.auto}</Badge>
            <Badge>partial {cov.summary.partial}</Badge>
            <Badge>manual {cov.summary.manual}</Badge>
            <Badge>missing {cov.summary.missing}</Badge>
            {cov.summary.required_unresolved > 0 && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                {cov.summary.required_unresolved} required field(s) unresolved
              </span>
            )}
          </div>
          <table className="w-full text-xs">
            <tbody>
              {cov.rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 align-top dark:border-neutral-800">
                  <td className="w-40 py-1 font-medium">
                    {r.label}
                    {r.required && <span className="text-red-500"> *</span>}
                  </td>
                  <td className="w-20">
                    <span
                      className={cls(
                        "rounded px-1.5 py-0.5",
                        r.status === "auto" && "bg-emerald-100 text-emerald-700",
                        r.status === "partial" && "bg-amber-100 text-amber-700",
                        r.status === "manual" && "bg-blue-100 text-blue-700",
                        r.status === "missing" && "bg-red-100 text-red-700",
                      )}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="w-56 py-1">{r.value || <span className="text-neutral-400">—</span>}</td>
                  <td className="py-1 text-neutral-500">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "coverage" && !cov && <p className="text-neutral-500">No coverage yet — run the pipeline.</p>}

      {tab === "tips" && (
        <ul className="space-y-2">
          {job.recommendations.map((r) => (
            <li key={r.id} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <span
                  className={cls(
                    "rounded px-1.5 py-0.5 text-xs",
                    r.severity === "high" && "bg-red-100 text-red-700",
                    r.severity === "medium" && "bg-amber-100 text-amber-700",
                    r.severity === "low" && "bg-neutral-200 text-neutral-600",
                  )}
                >
                  {r.severity}
                </span>
                <b>{r.title}</b>
                <span className="text-neutral-400">· {r.field}</span>
              </div>
              <p className="mt-1 text-neutral-600 dark:text-neutral-400">{r.detail}</p>
            </li>
          ))}
          {job.recommendations.length === 0 && <li className="text-neutral-500">No recommendations.</li>}
        </ul>
      )}

      {tab === "draft" && (
        <div>
          <textarea
            value={draftValue}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
            className="h-96 w-full rounded border border-neutral-300 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={commit}
              disabled={!draftValue || job.status === "committed"}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {job.status === "committed" ? "Committed" : "Commit to Hostiggo"}
            </button>
            {job.listing_id && <span className="text-xs">listing: <code>{job.listing_id}</code></span>}
            {commitMsg && <span className="text-xs text-emerald-600">{commitMsg}</span>}
            {err && <span className="text-xs text-red-500">{err}</span>}
          </div>
        </div>
      )}

      {tab === "report" && (
        <table className="w-full text-xs">
          <tbody>
            {(job.validation_report ?? []).map((r, i) => (
              <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="py-1 font-mono">{r.path}</td>
                <td className="w-24">{r.status}</td>
                <td>{r.note}</td>
              </tr>
            ))}
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
              <figcaption className="mt-1 flex justify-between">
                <span>#{p.idx}</span>
                <span className={cls(p.status === "mirrored" && "text-emerald-600", p.status === "failed" && "text-red-500")}>
                  {p.status}
                </span>
              </figcaption>
            </figure>
          ))}
          {(job.photos ?? []).length === 0 && <p className="text-neutral-500">No photos.</p>}
        </div>
      )}

      {tab === "ical" && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            Add the listing&apos;s iCal export URL (Airbnb: Calendar → Availability → Connect calendars →
            Export). Hostiggo re-pulls it on a schedule to keep dates blocked.
          </p>
          <div className="flex gap-2">
            <input
              value={icalUrl}
              onChange={(e) => setIcalUrl(e.target.value)}
              placeholder="https://www.airbnb.com/calendar/ical/12345.ics?s=…"
              className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              onClick={attachIcal}
              disabled={icalBusy || !icalUrl}
              className="shrink-0 rounded bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {icalBusy ? "Fetching…" : "Fetch & preview"}
            </button>
          </div>
          {job.ical && (
            <div className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              {job.ical.error ? (
                <span className="text-red-500">Error: {job.ical.error}</span>
              ) : (
                <>
                  <div>
                    <b>{job.ical.calendar_name || "calendar"}</b> · {job.ical.event_count} event(s) ·{" "}
                    <b>{job.ical.blocked_dates.length}</b> blocked night(s)
                  </div>
                  <div className="mt-1 text-neutral-500">
                    {job.ical.blocked_dates.slice(0, 12).join(", ")}
                    {job.ical.blocked_dates.length > 12 && " …"}
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-neutral-500">events</summary>
                    <pre className="max-h-40 overflow-auto">{JSON.stringify(job.ical.events, null, 1)}</pre>
                  </details>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- bits ---------------------------- */
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
function Check({ checked, onChange, label }: { checked: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
