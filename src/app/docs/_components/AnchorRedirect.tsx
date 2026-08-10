"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { docsSections, sectionHref } from "./sections";

/* Every section used to be an anchor on one page, and those links are already in the wild —
   the API error envelope ships doc_url: ".../docs#errors" on every 4xx, and /llms.txt and the
   agent skill reference the same form. A fragment never reaches the server, so this runs
   client-side on /docs and forwards a recognised #slug to its own route.

   Scoped to the /docs index deliberately: on a section page a fragment is a real heading
   anchor, and hijacking it would break in-page navigation. */
export default function AnchorRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if ((pathname.replace(/\/+$/, "") || "/docs") !== "/docs") return;

    const applyHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      const target = docsSections.find((section) => section.slug && section.slug === hash);
      if (target) router.replace(sectionHref(target));
    };

    applyHash();
    /* Catch a same-page hash change too (an old in-page nav link, or the back button). */
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [pathname, router]);

  return null;
}
