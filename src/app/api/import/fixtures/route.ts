import { NextResponse } from "next/server";
import { FIXTURES } from "@/lib/fixtures";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    fixtures: Object.entries(FIXTURES).map(([key, f]) => ({
      key,
      label: f.label,
      url: f.url,
      provider: f.provider,
    })),
  });
}
