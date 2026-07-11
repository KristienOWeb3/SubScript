/* On-page checkout for embedded (custody) wallets. Circle MPC / legacy embedded wallets are not
   browser wallets, so they can't sign the pay page's wagmi transactions. These helpers make the
   IDENTICAL on-chain call a browser wallet would — router depositForMerchant for merchant links,
   direct USDC transfer for peer requests — signed server-side through the custody provider. Because
   the resulting transaction is indistinguishable on-chain, /api/payment-links/verify validates and
   settles it through the exact same path (no special-casing downstream). */
import { getWalletCustody } from "@/lib/custody";
import { ensureUsdcAllowance } from "@/lib/vault/onchain";
import { SUBSCRIPT_ROUTER_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const ROUTER_DEPOSIT_ABI = [
    "function depositForMerchant(address _merchant, uint256 _amount, string _memo)",
];
const USDC_TRANSFER_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
];

/* Pay a merchant payment link from the user's embedded wallet via the router's depositForMerchant,
   carrying the receipt token as the on-chain memo so the DepositWithMemo event binds merchant,
   amount, and receipt exactly as the verifier expects. Returns the confirmed tx hash. */
export async function payMerchantLinkFromEmbedded(
    walletAddress: string,
    merchant: string,
    amountMicros: bigint,
    receiptToken: string,
): Promise<string> {
    const custody = await getWalletCustody(walletAddress);
    await ensureUsdcAllowance(custody, SUBSCRIPT_ROUTER_ADDRESS, amountMicros);
    const { txHash } = await custody.executeContract({
        contractAddress: SUBSCRIPT_ROUTER_ADDRESS,
        abi: ROUTER_DEPOSIT_ABI,
        functionName: "depositForMerchant",
        args: [merchant.toLowerCase(), amountMicros, receiptToken],
    });
    return txHash;
}

/* Pay a peer (user-to-user) request from the user's embedded wallet via a direct USDC transfer to
   the requester — matching the browser wallet's transfer so verify's settlesDirectlyToUser branch
   validates it identically. Returns the confirmed tx hash. */
export async function payPeerLinkFromEmbedded(
    walletAddress: string,
    recipient: string,
    amountMicros: bigint,
): Promise<string> {
    const custody = await getWalletCustody(walletAddress);
    const { txHash } = await custody.executeContract({
        contractAddress: USDC_NATIVE_GAS_ADDRESS,
        abi: USDC_TRANSFER_ABI,
        functionName: "transfer",
        args: [recipient.toLowerCase(), amountMicros],
    });
    return txHash;
}
