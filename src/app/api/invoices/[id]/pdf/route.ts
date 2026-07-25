import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const payment = await prisma.paymentLinkPayment.findFirst({
            where: {
                OR: [
                    { id },
                    { txHash: id },
                ]
            },
        });

        if (!payment) {
            return new NextResponse("Invoice not found", { status: 404 });
        }

        const invoiceId = `INV-${payment.id.slice(0, 8).toUpperCase()}`;
        const amountUsdc = (Number(payment.amountUsdc) / 1_000_000).toFixed(2);
        const dateStr = new Date(payment.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>Invoice ${invoiceId} — SubScript</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #ffffff; margin: 0; padding: 40px; }
        .invoice-box { max-width: 800px; margin: auto; padding: 40px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: rgba(18, 18, 20, 0.8); }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 20px; margin-bottom: 30px; }
        .brand { font-size: 24px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #ffffff; }
        .brand span { color: #00d2b4; font-style: italic; text-transform: lowercase; }
        .invoice-title { font-size: 20px; font-weight: 700; color: #00d2b4; }
        .details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; font-size: 13px; color: #a0a0a0; }
        .details strong { color: #ffffff; }
        .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .table th, .table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
        .table th { background: rgba(255, 255, 255, 0.03); color: #808080; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
        .table td { font-size: 14px; }
        .total-row { font-size: 18px; font-weight: 800; color: #00d2b4; text-align: right; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #606060; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 20px; }
        .mono { font-family: monospace; }
        @media print { body { background: #ffffff; color: #000000; } .invoice-box { border: none; background: none; } }
    </style>
</head>
<body>
    <div class="invoice-box">
        <div class="header">
            <div class="brand">SUBSCRIPT <span>invoice</span></div>
            <div class="invoice-title">${invoiceId}</div>
        </div>
        <div class="details">
            <div>
                <p><strong>Merchant Wallet:</strong><br><span class="mono">${payment.merchantAddress}</span></p>
                <p><strong>Subscriber Wallet:</strong><br><span class="mono">${payment.payerAddress}</span></p>
            </div>
            <div>
                <p><strong>Date:</strong> ${dateStr}</p>
                <p><strong>Transaction Hash:</strong><br><span class="mono">${payment.txHash || "N/A"}</span></p>
            </div>
        </div>
        <table class="table">
            <thead>
                <tr>
                    <th>Description</th>
                    <th>Status</th>
                    <th style="text-align: right;">Amount (USDC)</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>SubScript Subscription / Payment Service</td>
                    <td><span style="color: #00d2b4; font-weight: bold;">PAID</span></td>
                    <td style="text-align: right;" class="mono">${amountUsdc} USDC</td>
                </tr>
            </tbody>
        </table>
        <div class="total-row">
            Total Paid: ${amountUsdc} USDC
        </div>
        <div class="footer">
            SubScript Protocol &mdash; Verifiable On-Chain USDC Escrow &amp; Subscription Engine
        </div>
    </div>
    <script>
        if (window.location.search.includes('print=true')) { window.print(); }
    </script>
</body>
</html>`;

        return new NextResponse(html, {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Disposition": `inline; filename="${invoiceId}.html"`,
            },
        });
    } catch (error: any) {
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
