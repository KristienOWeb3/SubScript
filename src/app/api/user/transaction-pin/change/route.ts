import { manageTransactionPin } from "@/lib/auth/transactionPinManagement";
export const runtime = "nodejs";
export function POST(request: Request) { return manageTransactionPin(request, 'change'); }
