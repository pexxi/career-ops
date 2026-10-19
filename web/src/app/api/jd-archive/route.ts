import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { jdArchiveForReport } from "@/lib/career-ops";
import { inlineDisposition } from "@/lib/content-disposition.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the saved posting for a report from jds/: the full-page screenshot
// (type=pdf) or the page text (type=md). Written by archive-posting.mjs so the
// posting stays readable after the live page closes.
export async function GET(req: NextRequest) {
  const n = (req.nextUrl.searchParams.get("n") ?? "").trim();
  const type = req.nextUrl.searchParams.get("type") === "md" ? "md" : "pdf";
  if (!/^\d+$/.test(n)) return new Response("invalid report number", { status: 400 });

  const file = jdArchiveForReport(n)[type];
  if (!file) return new Response("no saved posting for this report", { status: 404 });

  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": type === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": inlineDisposition(path.basename(file)),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("could not read the saved posting", { status: 500 });
  }
}
