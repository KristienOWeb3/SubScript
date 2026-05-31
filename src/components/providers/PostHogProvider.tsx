"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { ReactNode } from "react";

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
  return <Provider client={posthog}>{children}</Provider>;
}
