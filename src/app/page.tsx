import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-3xl font-semibold">Hostiggo OTA Listing Importer</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-400">
        Asynchronous tiered extraction pipeline: Tier 1 fetch → truncation detection →
        Tier 2 headless fallback → LLM extraction with strict JSON Schema → server
        validation → Supabase photo mirroring → commit.
      </p>
      <Link
        href="/import-tester"
        className="mt-6 inline-block rounded bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black"
      >
        Open the Import Tester playground →
      </Link>
    </main>
  );
}
