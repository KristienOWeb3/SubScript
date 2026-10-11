export type SendRecipient = {
  address: string;
  alias: string | null;
  profilePic: string | null;
  hasAccount: boolean;
};

/** An address is already a destination; its optional account metadata must not block sending. */
export async function resolveSendRecipient(
  input: string,
  signal: AbortSignal,
  timeoutMs = 8_000,
): Promise<SendRecipient> {
  const normalized = input.trim().toLowerCase();
  const isAddress = /^0x[a-f0-9]{40}$/.test(normalized);
  const fallback = { address: normalized, alias: null, profilePic: null, hasAccount: false };
  if (!isAddress && !/^[^.\s]+\.sub$/.test(normalized)) {
    throw new Error("Enter a wallet address or a .sub name.");
  }

  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const query = isAddress ? `address=${normalized}` : `alias=${encodeURIComponent(normalized)}`;
    const response = await fetch(`/api/merchant/alias?${query}`, { signal: controller.signal });
    if (!response.ok) throw new Error("Recipient lookup is unavailable. Try again.");
    const data = await response.json();
    if (controller.signal.aborted) throw new Error("Recipient lookup was cancelled.");
    if (isAddress) return {
      ...fallback,
      alias: data.success && typeof data.alias === "string" ? data.alias : null,
      profilePic: data.success && typeof data.profile_pic === "string" ? data.profile_pic : null,
      hasAccount: Boolean(data.success && (data.alias || data.profile_pic)),
    };
    if (data.success !== true || typeof data.address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(data.address)) {
      throw new Error("This .sub name could not be found. Check the name or try again.");
    }
    return { address: data.address, alias: typeof data.alias === "string" ? data.alias : normalized, profilePic: typeof data.profile_pic === "string" ? data.profile_pic : null, hasAccount: true };
  } catch (error) {
    if (signal.aborted) throw error;
    if (isAddress) return fallback;
    if (timedOut) throw new Error("Recipient lookup took too long. Try again.");
    if (error instanceof Error && /^(Recipient lookup|This \.sub)/.test(error.message)) throw error;
    throw new Error("Recipient lookup is unavailable. Try again.");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
