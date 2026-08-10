import CodeBlock from "../_components/CodeBlock";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { vibePrompt } from "../_content/samples";

export const metadata = docsMetadata("vibecoder", {
  description:
    "A copy-paste prompt that tells an AI coding agent how to integrate SubScript correctly: pick the right endpoint, persist the ids, and fulfill only from a verified webhook.",
});

export default function VibecoderPage() {
  const { previous, next } = pagerFor("vibecoder");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="AI integration" title="Vibecoder prompt">
        <DocsLead>
          If you are building with an AI coding agent, paste this directly into it. The important thing is that
          your app stores the SubScript <span className="font-mono">intent_id</span> beside your own user record
          and waits for the signed webhook before unlocking access.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="What this prompt is defending against">
        <p>
          Agents integrate payment APIs from pattern memory, and the patterns they have memorised are card
          processors. Left alone they tend to make the same four mistakes: pick{" "}
          <span className="font-mono">/api/intent</span> for a subscription because the title said &quot;monthly&quot;,
          unlock access from the success redirect, re-serialize the webhook body before verifying its signature,
          and put the secret key somewhere the browser can read it. Every constraint in the prompt below maps to
          one of those.
        </p>
      </Callout>

      <CodeBlock code={vibePrompt} language="prompt" />

      <Callout tone="teal" title="Review these three things in whatever it writes">
        <ul className="mt-1 list-disc space-y-1.5 pl-5">
          <li>
            <span className="font-semibold text-white/80">The webhook reads raw bytes.</span> Look for{" "}
            <span className="font-mono">await req.text()</span>, not{" "}
            <span className="font-mono">await req.json()</span>. Parsing first changes the signed bytes and every
            signature will fail — or worse, the agent &quot;fixes&quot; it by skipping verification.
          </li>
          <li>
            <span className="font-semibold text-white/80">The event id is claimed before fulfillment.</span> A
            UNIQUE insert on <span className="font-mono">event.id</span> that runs <em>before</em> the unlock, not
            an <span className="font-mono">if (alreadyProcessed)</span> check that races under concurrent retries.
          </li>
          <li>
            <span className="font-semibold text-white/80">No key reaches the client.</span> Grep the diff for{" "}
            <span className="font-mono">NEXT_PUBLIC_</span> near anything named secret or webhook.
          </li>
        </ul>
      </Callout>

      <p className="max-w-3xl text-sm leading-relaxed text-white/70">
        Agents can also read this guide directly. Every page has a plain-Markdown twin — append{" "}
        <span className="font-mono">.md</span> to any docs URL — and{" "}
        <a href="/llms.txt" className="font-semibold text-[#00d2b4] hover:underline">
          /llms.txt
        </a>{" "}
        indexes the whole set alongside the CLI commands that scaffold an integration.
      </p>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
