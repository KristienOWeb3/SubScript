export type RecentRecipient = {
  id: string;
  chain: string;
  type: "dns" | "wallet";
  target: string;
  label: string;
  profilePic?: string | null;
  address?: string | null;
};

export type RecipientTransaction = {
  incoming?: boolean;
  dnsName?: string | null;
  name?: string | null;
  counterpartyAddress?: string | null;
  pic?: string | null;
  recipientChain?: string | null;
};

export const formatShortAddress = (addr: string): string => {
  if (!addr) return "";
  const clean = addr.trim();
  if (clean.length < 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
};

const networkKey = (chain: string) => ({ base: "8453", arb: "42161", eth: "1", sol: "solana" }[chain] || chain);
const normalizeHandle = (dns: string) => dns.trim().replace(/^@/, "").replace(/\.sub$/i, "").toLowerCase();
const identity = (value: string) => {
  const clean = value.trim().replace(/^@/, "");
  return /^0x/i.test(clean) || /\.sub$/i.test(clean) ? clean.toLowerCase() : clean;
};
const fullTarget = (value: string) => Boolean(value && !value.includes("…") && !value.includes("..."));

export function recentRecipients(chain: string, transactions: RecipientTransaction[], stored: RecentRecipient[]): RecentRecipient[] {
  const key = networkKey(chain);
  const candidates: RecentRecipient[] = transactions.filter(tx => !tx.incoming).flatMap(tx => {
    if (!tx.recipientChain) return [];
    const txChain = networkKey(tx.recipientChain);
    if (txChain !== key) return [];
    const address = tx.counterpartyAddress || (/^0x[0-9a-f]{40}$/i.test(tx.name || "") ? tx.name : null);
    const dns = tx.dnsName || (/\.sub$/i.test(tx.name || "") ? tx.name : null);
    const target = dns ? `${normalizeHandle(dns)}.sub` : address;
    if (!target || !fullTarget(target)) return [];
    const label = dns ? target : formatShortAddress(target);
    return [{ id: `recent-${target}`, chain: txChain, type: dns ? ("dns" as const) : ("wallet" as const), target, label, address: address || null, profilePic: tx.pic }];
  });

  candidates.push(...stored.filter(item => networkKey(item.chain) === key).map(item => ({
    ...item,
    label: item.type === "dns" ? item.target : formatShortAddress(item.target || item.address || item.label),
  })));

  // Strict deduplication: never repeat the same wallet address or DNS handle
  const seenAddresses = new Set<string>();
  const seenDns = new Set<string>();
  const seenTargets = new Set<string>();

  // Map known DNS names to addresses for cross-identity resolution
  const dnsToAddress = new Map<string, string>();
  for (const item of candidates) {
    if (item.type === "dns" && item.address) {
      dnsToAddress.set(normalizeHandle(item.target), item.address.toLowerCase());
    }
  }

  return candidates.filter(item => {
    if (!fullTarget(item.target)) return false;
    const targetId = identity(item.target);
    if (seenTargets.has(targetId)) return false;

    if (item.type === "dns") {
      const handle = normalizeHandle(item.target);
      if (seenDns.has(handle)) return false;

      const linkedAddr = dnsToAddress.get(handle) || (item.address ? item.address.toLowerCase() : null);
      if (linkedAddr && seenAddresses.has(linkedAddr)) return false;

      seenDns.add(handle);
      seenTargets.add(targetId);
      if (linkedAddr) seenAddresses.add(linkedAddr);
      return true;
    }

    // Wallet address
    const isSolana = key === "solana" || item.chain === "solana";
    const rawAddr = isSolana ? (item.address || item.target) : (item.address || item.target).toLowerCase();
    if (seenAddresses.has(rawAddr)) return false;

    seenAddresses.add(rawAddr);
    seenTargets.add(targetId);
    return true;
  }).slice(0, 5);
}
