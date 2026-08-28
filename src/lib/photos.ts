import { env } from "./env";
import { getStore } from "./store";
import type { MirroredPhoto } from "./types";
import type { ValidatedDraft } from "./schema";

const OK_TYPES = /^image\/(jpe?g|png|webp|avif)$/i;

/**
 * Download each draft photo and mirror it into our own storage so the
 * Hostiggo listing never hot-links the OTA CDN.
 */
export async function mirrorPhotos(
  jobId: string,
  draft: ValidatedDraft,
  onLog: (level: "info" | "warn", msg: string) => void,
): Promise<MirroredPhoto[]> {
  const store = getStore();
  const out: MirroredPhoto[] = [];
  const targets = draft.photos.slice(0, env.maxPhotos);

  // Bounded concurrency.
  const queue = [...targets.entries()];
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) break;
      const [idx, photo] = next;
      const rec: MirroredPhoto = {
        idx,
        original_url: photo.url,
        storage_path: null,
        public_url: null,
        content_type: null,
        bytes: null,
        status: "pending",
        error: null,
        caption: photo.caption,
      };
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), env.fetchTimeoutMs);
        const res = await fetch(photo.url, {
          signal: ctrl.signal,
          headers: { "user-agent": "HostiggoImporter/1.0" },
        }).finally(() => clearTimeout(t));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
        if (!OK_TYPES.test(ct)) throw new Error(`unsupported type ${ct || "?"}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > env.photoMaxBytes)
          throw new Error(`too large (${buf.byteLength} bytes)`);
        if (buf.byteLength < 1024) throw new Error("suspiciously small");
        const { path, publicUrl } = await store.putPhoto(jobId, idx, buf, ct);
        rec.storage_path = path;
        rec.public_url = publicUrl;
        rec.content_type = ct;
        rec.bytes = buf.byteLength;
        rec.status = "mirrored";
      } catch (e) {
        rec.status = "failed";
        rec.error = (e as Error).message;
        onLog("warn", `photo ${idx} failed: ${rec.error}`);
      }
      out.push(rec);
    }
  });
  await Promise.all(workers);
  out.sort((a, b) => a.idx - b.idx);
  const ok = out.filter((p) => p.status === "mirrored").length;
  onLog("info", `mirrored ${ok}/${targets.length} photos`);
  return out;
}
