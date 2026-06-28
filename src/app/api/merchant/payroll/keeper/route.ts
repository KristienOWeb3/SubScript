/* Returns the keeper (payroll executor) address so the merchant signs the Permit2 authorization
   with the keeper as the spender — matching exactly what internal/payroll submits. Public info:
   it's just the address derived from the server keeper key. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }
        const keeperKey = process.env.PRIVATE_KEY;
        if (!keeperKey) {
            return NextResponse.json({ error: "Payroll keeper is not configured on the server." }, { status: 500 });
        }
        const keeperAddress = new ethers.Wallet(keeperKey).address;
        return NextResponse.json({ success: true, keeperAddress }, { status: 200 });
    } catch (error: any) {
        console.error("Payroll keeper-address lookup failed:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
