import { notFound } from "next/navigation";
import { isReceiptId } from "@/lib/arc/memo";
import ReceiptClient from "./ReceiptClient";

type PageProps = {
    params: Promise<{ receiptId: string }>;
};

export default async function ReceiptPage({ params }: PageProps) {
    const { receiptId } = await params;
    if (!isReceiptId(receiptId)) {
        notFound();
    }

    return <ReceiptClient receiptId={receiptId} />;
}
