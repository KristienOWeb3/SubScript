import { redirect } from "next/navigation";
import { getSafeRelativePath } from "@/utils/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedParams)) {
    if (typeof value === "string") {
      if (key === "next") {
        const safe = getSafeRelativePath(value);
        if (safe) params.set(key, safe);
      } else {
        params.set(key, value);
      }
    } else if (Array.isArray(value)) {
      value.forEach((v) => {
        if (key === "next") {
          const safe = getSafeRelativePath(v);
          if (safe) params.append(key, safe);
        } else {
          params.append(key, v);
        }
      });
    }
  }

  const queryString = params.toString();
  redirect(`/signin${queryString ? `?${queryString}` : ""}`);
}
