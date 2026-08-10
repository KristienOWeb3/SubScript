import type { ReactNode } from "react";
import Link from "next/link";

/* Shared presentational blocks used by every docs page. These are pure mark-up, so they stay
   server components — only CodeBlock carries the client boundary. */

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
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00d2b4]">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
      {children}
    </div>
  );
}

export function DocsLead({ children }: { children: ReactNode }) {
  return <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/70">{children}</p>;
}

export function Callout({
  tone = "teal",
  title,
  children,
}: {
  tone?: "teal" | "cyan" | "amber" | "red" | "plain";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    teal: "border-[#00d2b4]/20 bg-[#00d2b4]/10 text-white/75",
    cyan: "border-cyan-300/20 bg-cyan-300/[0.06] text-white/70",
    amber: "border-amber-300/30 bg-amber-300/10 text-amber-50/85",
    red: "border-red-500/20 bg-red-500/10 text-white/75",
    plain: "border-white/5 bg-black/30 text-white/65",
  }[tone];

  return (
    <div className={`rounded-2xl border p-5 text-xs leading-relaxed ${styles}`}>
      {title && <p className="font-bold text-white/85">{title}</p>}
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
    <div className="h-full rounded-2xl border border-white/5 bg-black/30 p-5 transition hover:border-[#00d2b4]/35 hover:bg-[#00d2b4]/5">
      {icon && <div className="mb-3">{icon}</div>}
      {title && <h3 className="text-sm font-semibold text-white">{title}</h3>}
      <div className={`text-xs leading-relaxed text-white/55 ${title ? "mt-2" : ""}`}>{children}</div>
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
      <span className="rounded-md bg-[#00d2b4]/15 px-2 py-1 font-bold text-[#00d2b4]">{method}</span>
      <span className="text-white/70">{path}</span>
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
    <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/30">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="border-b border-white/5 bg-white/[0.03] text-[9px] uppercase tracking-widest text-white/40">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-white/65">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-4 py-3 leading-relaxed ${cellIndex === 0 ? "font-mono font-semibold text-[#00d2b4]" : cellIndex === 1 ? "font-mono text-white/55" : ""}`}>
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
    <div className="rounded-xl border border-white/5 bg-black/30 p-4">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/35">{label}</p>
      <p className="mt-2 break-all font-mono text-[11px] text-white/80">{value}</p>
    </div>
  );
}

export function Steps({ items }: { items: Array<{ title: string; text: string }> }) {
  return (
    <ol className="space-y-3 text-sm leading-relaxed text-white/70">
      {items.map((item, index) => (
        <li key={item.title} className="flex gap-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00d2b4]/15 text-xs font-bold text-[#00d2b4]">
            {index + 1}
          </span>
          <div>
            <p className="font-semibold text-white">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">{item.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CheckList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-3 text-xs leading-relaxed text-white/60">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-[#00d2b4]/15 text-center text-[10px] font-bold leading-4 text-[#00d2b4]">✓</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PageFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-12 border-t border-white/5 pt-6 text-xs leading-relaxed text-white/40">
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
    <nav aria-label="Docs pagination" className="mt-12 grid grid-cols-1 gap-4 border-t border-white/5 pt-6 sm:grid-cols-2">
      {previous ? (
        <Link
          href={toHref(previous)}
          className="group flex items-center gap-3 rounded-2xl border border-white/5 bg-black/30 p-4 transition hover:border-[#00d2b4]/35"
        >
          <span className="text-[#00d2b4] transition group-hover:-translate-x-0.5">←</span>
          <span>
            <span className="block text-[9px] font-bold uppercase tracking-widest text-white/35">Previous</span>
            <span className="block text-xs font-semibold text-white">{previous.title}</span>
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={toHref(next)}
          className="group flex items-center justify-end gap-3 rounded-2xl border border-white/5 bg-black/30 p-4 text-right transition hover:border-[#00d2b4]/35"
        >
          <span>
            <span className="block text-[9px] font-bold uppercase tracking-widest text-white/35">Next</span>
            <span className="block text-xs font-semibold text-white">{next.title}</span>
          </span>
          <span className="text-[#00d2b4] transition group-hover:translate-x-0.5">→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
