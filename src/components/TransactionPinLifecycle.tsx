"use client";

import { useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cancelTransactionPinPrompt } from "@/components/TransactionPinPrompt";

/** Route changes and the app unmount cancel outstanding authorization and erase its fields. */
export default function TransactionPinLifecycle() {
    const pathname = usePathname();
    const search = useSearchParams()?.toString();
    useLayoutEffect(() => () => cancelTransactionPinPrompt(), [pathname, search]);
    return null;
}
