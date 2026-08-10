import { markdownForSlug, markdownSlugs } from "../_content/markdown";

/* Serves the plain-Markdown twin of each docs page at /docs/<slug>.md (and /docs/index.md for the
   overview). Agents get the prose with no markup to strip; /llms.txt points here.

   This is a route handler rather than a page so the response is real text/markdown — a Next.js
   page would wrap it in an HTML document, which is the exact thing these exist to avoid. */

export const dynamic = "force-static";

export function generateStaticParams() {
  return markdownSlugs.map((slug) => ({ slug: [`${slug || "index"}.md`] }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const segments = slug ?? [];

  /* Only ever one segment, and it must end in .md — anything else is a real 404 rather than a
     docs page we failed to find. */
  if (segments.length !== 1 || !segments[0].endsWith(".md")) {
    return new Response("Not found", { status: 404 });
  }

  const name = segments[0].slice(0, -3);
  const markdown = markdownForSlug(name === "index" ? "" : name);

  if (markdown === null) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
