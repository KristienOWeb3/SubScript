import CodeBlock from "../_components/CodeBlock";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { viemMemoCode } from "../_content/samples";

export const metadata = docsMetadata("contracts", {
  description:
    "The Arc memo transaction payload: how hosted links settle through the SubScript Router, how receive links settle as direct transfers, and how each is verified on-chain.",
});

export default function ContractsPage() {
  const { previous, next } = pagerFor("contracts");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Reference" title="Advanced: Arc memo transaction payload">
        <DocsLead>
          Merchant hosted links settle through the SubScript Router: the receipt token is passed as the router
          memo, and the backend verifies the matching <span className="font-mono">DepositWithMemo</span> event
          before marking the payment paid. User-created receive links settle as direct Arc USDC transfers to the
          requester, with the backend verifying the ERC-20 <span className="font-mono">Transfer</span> call and
          event. Cross-chain CCTP checkout is disabled for hosted payment links until Arc-side mint and memo
          settlement can be verified in one bound flow.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="Why the memo matters">
        <p>
          A bare USDC transfer to a merchant address is ambiguous — several customers can pay identical amounts
          within the same block, and nothing on-chain says which checkout each one settles. The receipt token
          travels as the router memo, which is what lets settlement verification bind a specific transfer to a
          specific intent rather than guessing by amount and timing.
        </p>
        <p className="mt-2">
          This is also why the two link types verify differently: a router deposit carries the memo and is matched
          on the <span className="font-mono">DepositWithMemo</span> event, while a direct receive-link transfer has
          no memo and is matched on the ERC-20 <span className="font-mono">Transfer</span> instead.
        </p>
      </Callout>

      <CodeBlock code={viemMemoCode} language="typescript" />

      <Callout tone="amber" title="Most integrations should not do this">
        <p>
          Calling the router directly means you own settlement verification, memo correctness, gas, and failure
          recovery. Hosted checkout does all of that already. Reach for this path when you are building a wallet,
          an autonomous agent, or infrastructure that must construct its own transactions — not to avoid a
          redirect.
        </p>
      </Callout>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
