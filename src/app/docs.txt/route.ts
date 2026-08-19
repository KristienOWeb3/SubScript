import { fullTextDocument } from "@/app/docs/_content/markdown";

/* Serves the whole guide as one plain-text document at /docs.txt, for agents and LLMs that would
   otherwise have to discover and fetch every /docs/<slug>.md twin separately.

   Generated from the same bodies the twins are built from rather than committed as a static file
   under public/ — a hand-maintained copy drifts from the pages it describes, which is exactly what
   happened to llms-full.txt.

   A route handler rather than a page for the same reason as the .md twins: a page would wrap this
   in an HTML document, which is the thing these exist to avoid. */

export const dynamic = "force-static";

export async function GET() {
  return new Response(fullTextDocument(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
