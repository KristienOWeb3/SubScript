"use client";

import { PayrollContent } from "./PayrollContent";

/* Standalone /merchant/payroll route. The dashboard renders <PayrollContent embedded /> as an
   in-page tab; this page keeps the full-chrome standalone view working for direct links. */
export default function PayrollPage() {
    return <PayrollContent />;
}
