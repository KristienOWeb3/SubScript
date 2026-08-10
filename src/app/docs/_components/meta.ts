import type { Metadata } from "next";
import { docsSections, sectionHref, sectionNeighbours } from "./sections";

/**
 * Per-page metadata derived from the section registry, so a page's title, description, and
 * canonical URL can never drift from its sidebar entry. Splitting the guide is mostly a
 * discoverability win, and this is where that win is actually banked.
 */
export function docsMetadata(slug: string, overrides?: Partial<Metadata>): Metadata {
  const section = docsSections.find((entry) => entry.slug === slug);
  if (!section) return overrides ?? {};

  const url = sectionHref(section);
  const description = (overrides?.description as string) || section.summary;

  return {
    title: section.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${section.title} · SubScript Docs`,
      description,
      url,
      type: "article",
    },
    ...overrides,
  };
}

/** Reading-order neighbours in the plain shape DocsPager expects. */
export function pagerFor(slug: string) {
  const { previous, next } = sectionNeighbours(slug);
  return {
    previous: previous ? { title: previous.title, slug: previous.slug } : undefined,
    next: next ? { title: next.title, slug: next.slug } : undefined,
  };
}
