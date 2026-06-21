"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { ReactNode, useEffect, useRef } from "react";

if (typeof window !== "undefined") {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (key) {
    posthog.init(key, {
      api_host: host || "https://us.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false,
    });
  }
}

interface PostHogProviderProps {
  children: ReactNode;
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
  const pathname = usePathname();
  const lastCapturedUrl = useRef("");

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || typeof window === "undefined") return;

    const url = `${window.location.pathname}${window.location.search}`;
    if (lastCapturedUrl.current === url) return;

    lastCapturedUrl.current = url;
    posthog.capture("$pageview", {
      $current_url: window.location.href,
      path: pathname,
    });
  }, [pathname]);

  return <Provider client={posthog}>{children}</Provider>;
}
