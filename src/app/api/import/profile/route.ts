import { NextResponse } from "next/server";
import { z } from "zod";
import { scanProfile } from "@/lib/profile";
import { validateImportUrl } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ url: z.string().min(1) });

/** Discover every listing on a host-profile / search / wishlist URL. */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: "url required" }, { status: 400 });

  // Reuse the OTA allow-list, but don't require it to look like a listing URL.
  const check = validateImportUrl(p.data.url);
  if (check.provider === "unknown")
    return NextResponse.json(
      { error: "Unsupported site. Supported: Airbnb, Booking.com, Agoda, MakeMyTrip, Goibibo." },
      { status: 400 },
    );

  try {
    const scan = await scanProfile(p.data.url);
    return NextResponse.json({ scan });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
