"use client";

import { useEffect, useRef, useState } from "react";
import { createOnrampKit, parseOnrampSession, type OnrampSession, type OnrampWidget } from "@circle-fin/onramp-kit";
import { Loader2 } from "lucide-react";
import { Building2 } from "@/components/icons";

type PreparedSession = { session: OnrampSession; widgetBaseUrl: string; canEmbed: boolean };

export default function ArcOnramp({ destinationAddress, disabled, onRefresh }: {
    destinationAddress: string;
    disabled: boolean;
    onRefresh: () => void;
}) {
    const [prepared, setPrepared] = useState<PreparedSession | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [active, setActive] = useState(false);
    const [embedded, setEmbedded] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const widget = useRef<OnrampWidget | null>(null);
    const controller = useRef<AbortController | null>(null);
    const refresh = useRef(onRefresh);
    useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);
    useEffect(() => () => {
        controller.current?.abort();
        widget.current?.close();
    }, []);
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => {
            if (widget.current?.state === "closed") {
                widget.current = null;
                setActive(false);
                refresh.current();
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, [active]);

    async function prepare() {
        setBusy(true);
        setError("");
        setMessage("");
        const abort = new AbortController();
        controller.current = abort;
        try {
            const response = await fetch("/api/user/onramp/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ destinationAddress }),
                signal: abort.signal,
                cache: "no-store",
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not prepare Arc Onramp.");
            if (!["https://onramp.arc.io", "https://onramp-sandbox.arc.io"].includes(data.widgetBaseUrl)) {
                throw new Error("Invalid funding service configuration.");
            }
            const session = parseOnrampSession(data.session);
            if (session.widgetUrl && new URL(session.widgetUrl).origin !== data.widgetBaseUrl) {
                throw new Error("Funding service environment mismatch.");
            }
            if (!abort.signal.aborted) setPrepared({ session, widgetBaseUrl: data.widgetBaseUrl, canEmbed: data.canEmbed === true });
        } catch (err) {
            if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Could not prepare Arc Onramp.");
        } finally {
            if (!abort.signal.aborted) setBusy(false);
        }
    }

    // A separate synchronous click preserves the browser's popup gesture.
    function launch() {
        if (!prepared) return;
        setError("");
        const finish = (text: string, failed = false) => {
            widget.current?.close();
            widget.current = null;
            setActive(false);
            setEmbedded(false);
            setPrepared(null);
            if (failed) setError(text); else setMessage(text);
        };
        try {
            const kit = createOnrampKit({ widgetBaseUrl: prepared.widgetBaseUrl });
            const options = {
                session: prepared.session,
                onDepositSubmitted: () => setMessage("Purchase submitted. Your balance updates when USDC arrives on-chain."),
                onDepositSettled: () => {
                    finish("Funding completed. Refreshing your Arc balance.");
                    refresh.current();
                },
                onDepositNotCompleted: () => finish("The purchase was not completed. You can try again.", true),
                onInitializationError: () => finish("Arc Onramp could not start. Please try again.", true),
                onSessionExpired: () => finish("Your funding session expired. Please try again.", true),
            };
            const result = kit.openWindow(options);
            if (result.status === "opened") {
                widget.current = result.widget;
            } else if (result.reason !== "popup_blocked" && prepared.canEmbed && container.current) {
                setEmbedded(true);
                widget.current = kit.mountIframe({ ...options, container: container.current, title: "Buy USDC with Arc Onramp" });
            } else {
                setError(result.reason === "popup_blocked"
                    ? "Allow popups for this site, then select Open Arc Onramp again."
                    : "Please open SubScript in your browser to buy USDC.");
                return;
            }
            setPrepared(null);
            setActive(true);
            setMessage("Complete your purchase in Arc Onramp.");
        } catch {
            finish("Your funding session is no longer available. Please try again.", true);
        }
    }

    return (
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#222327] p-3.5 text-left space-y-2">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-bold text-[#082824] dark:text-white">Buy USDC</p>
                    <p className="text-[11px] text-black/60 dark:text-white/60">Fund your Arc wallet with Arc Onramp.</p>
                </div>
                <button type="button" disabled={disabled || busy || active || !/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)}
                    onClick={prepared ? launch : () => void prepare()}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#2775CA] px-3 py-2 text-xs font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                    {busy ? "Preparing…" : active ? "Onramp open" : prepared ? "Open Arc Onramp" : "Buy USDC"}
                </button>
            </div>
            <p className="text-[10px] text-black/50 dark:text-white/50">Available payment methods, fees, and verification are shown by the provider.</p>
            {message && <p role="status" className="text-xs text-[#2775CA]">{message}</p>}
            {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {active && <button type="button" className="text-xs underline" onClick={() => {
                widget.current?.close(); widget.current = null; setActive(false); setEmbedded(false); setMessage(""); refresh.current();
            }}>Close onramp</button>}
            <div ref={container} className={active && embedded ? "h-[600px]" : "hidden"} />
        </div>
    );
}
