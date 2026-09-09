import type { ReactNode } from "react";
import Link from "next/link";

/* Shared presentational blocks used by every docs page. These are pure mark-up, so they stay
   server components — only CodeBlock carries the client boundary.

   Ivory design system (matches /terms, the customer dashboard, and the landing page): warm cream
   surfaces, opaque white cards with hairline black/10 borders, SubScript Blue #2775CA accent, and
   near-black #111827 ink. No liquid-glass, no teal. */

export function DocsHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#2775CA]">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-black tracking-tight text-[#111827] sm:text-4xl">{title}</h1>
      {children}
    </div>
  );
}

export function DocsLead({ children }: { children: ReactNode }) {
  return <p className="mt-4 max-w-3xl text-sm leading-relaxed text-black/70">{children}</p>;
}

export function Callout({
  tone = "blue",
  title,
  children,
}: {
  tone?: "blue" | "teal" | "cyan" | "amber" | "red" | "plain";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    /* "teal" and "cyan" are kept as aliases so existing pages that pass them don't break; both now
       resolve to the SubScript Blue accent. */
    blue: "border-[#2775CA]/20 bg-[#2775CA]/[0.06] text-black/75",
    teal: "border-[#2775CA]/20 bg-[#2775CA]/[0.06] text-black/75",
    cyan: "border-[#2775CA]/20 bg-[#2775CA]/[0.06] text-black/75",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-900",
    red: "border-red-500/25 bg-red-500/10 text-red-900",
    plain: "border-black/10 bg-black/[0.03] text-black/70",
  }[tone];

  return (
    <div className={`rounded-2xl border p-5 text-xs leading-relaxed ${styles}`}>
      {title && <p className="font-bold text-[#111827]">{title}</p>}
      {title ? <div className="mt-2">{children}</div> : children}
    </div>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function DocsCard({
  icon,
  title,
  children,
  href,
}: {
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
  href?: string;
}) {
  const body = (
    <div className="h-full rounded-2xl border border-black/10 bg-white/60 p-5 shadow-sm transition hover:border-[#2775CA]/40 hover:shadow-md">
      {icon && <div className="mb-3">{icon}</div>}
      {title && <h3 className="text-sm font-bold text-[#111827]">{title}</h3>}
      <div className={`text-xs leading-relaxed text-black/60 ${title ? "mt-2" : ""}`}>{children}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function ApiBadge({ method, path }: { method: string; path: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span className="rounded-md bg-[#2775CA]/10 px-2 py-1 font-bold text-[#2775CA]">{method}</span>
      <span className="text-black/70">{path}</span>
    </div>
  );
}

export function ApiTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<string>>;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white/60 shadow-sm">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="border-b border-black/10 bg-black/[0.03] text-[9px] uppercase tracking-widest text-black/45">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.06] text-black/70">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-4 py-3 leading-relaxed ${cellIndex === 0 ? "font-mono font-semibold text-[#2775CA]" : cellIndex === 1 ? "font-mono text-black/55" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white/60 p-4 shadow-sm">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-black/40">{label}</p>
      <p className="mt-2 break-all font-mono text-[11px] text-[#111827]">{value}</p>
    </div>
  );
}

export function Steps({ items }: { items: Array<{ title: string; text: string }> }) {
  return (
    <ol className="space-y-3 text-sm leading-relaxed text-black/70">
      {items.map((item, index) => (
        <li key={item.title} className="flex gap-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2775CA]/10 text-xs font-bold text-[#2775CA]">
            {index + 1}
          </span>
          <div>
            <p className="font-bold text-[#111827]">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-black/55">{item.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CheckList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
      <ul className="mt-4 space-y-3 text-xs leading-relaxed text-black/60">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-[#2775CA]/10 text-center text-[10px] font-bold leading-4 text-[#2775CA]">✓</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PageFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-12 border-t border-black/10 pt-6 text-xs leading-relaxed text-black/45">
      {children ?? (
        <>
          <p>© 2026 SubScript Protocol. All rights reserved.</p>
          <p className="mt-1">Built for programmable USDC payments on Arc Network.</p>
        </>
      )}
    </footer>
  );
}

/* Reading-order pager. `sectionHref` is passed in to avoid importing the registry here. */
export function DocsPager({
  previous,
  next,
  sectionHref: toHref,
}: {
  previous?: { title: string; slug: string };
  next?: { title: string; slug: string };
  sectionHref: (section: { slug: string }) => string;
}) {
  return (
    <nav aria-label="Docs pagination" className="mt-12 grid grid-cols-1 gap-4 border-t border-black/10 pt-6 sm:grid-cols-2">
      {previous ? (
        <Link
          href={toHref(previous)}
          className="group flex items-center gap-3 rounded-2xl border border-black/10 bg-white/60 p-4 shadow-sm transition hover:border-[#2775CA]/40 hover:shadow-md"
        >
          <span className="text-[#2775CA] transition group-hover:-translate-x-0.5">←</span>
          <span>
            <span className="block text-[9px] font-bold uppercase tracking-widest text-black/40">Previous</span>
            <span className="block text-xs font-semibold text-[#111827]">{previous.title}</span>
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={toHref(next)}
          className="group flex items-center justify-end gap-3 rounded-2xl border border-black/10 bg-white/60 p-4 text-right shadow-sm transition hover:border-[#2775CA]/40 hover:shadow-md"
        >
          <span>
            <span className="block text-[9px] font-bold uppercase tracking-widest text-black/40">Next</span>
            <span className="block text-xs font-semibold text-[#111827]">{next.title}</span>
          </span>
          <span className="text-[#2775CA] transition group-hover:translate-x-0.5">→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
