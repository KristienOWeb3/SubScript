/* Contract health endpoint. Returns 200 when every configured contract has code and
   exposes the function selectors the app calls; 503 when something is missing.
   Wire this into post-deploy CI (curl + fail on non-200) so deployed-vs-code drift
   surfaces loudly instead of as a production revert. Read-only; addresses are public. */
import { NextResponse } from "next/server";
import { auditContracts } from "@/lib/contracts/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
    try {
        const audit = await auditContracts();
        return NextResponse.json(audit, { status: audit.healthy ? 200 : 503 });
    } catch (error: any) {
        return NextResponse.json(
            { healthy: false, error: error?.message || "Contract health check failed" },
            { status: 500 }
        );
    }
}
