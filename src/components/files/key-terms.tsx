import { Card } from "@/components/ui";
import type { Terms } from "@/lib/ai/review";
import { TERM_KEYS } from "@/lib/llm/review-schema";

export const TERM_LABELS: Record<(typeof TERM_KEYS)[number], string> = {
  parties: "Parties",
  fee: "Fee",
  term: "Term",
  effective_date: "Effective date",
  renewal: "Renewal",
  governing_law: "Governing law",
};

/** Key terms read from the agreement by the AI review, each with its source quote. Missing ones say so; nothing is guessed. */
export function KeyTerms({ terms }: { terms: Terms }) {
  return (
    <Card className="p-4" data-testid="key-terms">
      <h2 className="text-sm font-semibold">Key terms</h2>
      <p className="mt-0.5 text-xs text-muted">Read from the agreement by AI, with the words they came from. Check them against the document.</p>
      <dl className="mt-3 space-y-2 text-sm">
        {TERM_KEYS.map((k) => {
          const t = terms[k];
          return (
            <div key={k} className="grid gap-x-3 sm:grid-cols-[8rem_1fr]" data-testid={`term-${k}`}>
              <dt className="font-medium">{TERM_LABELS[k]}</dt>
              <dd>
                {t?.found ? (
                  <>
                    <span>{t.value}</span>
                    <span className="block text-xs text-muted">
                      {t.page ? `p.${t.page}: ` : ""}“{t.quote}”
                    </span>
                  </>
                ) : (
                  <span className="text-muted">not found</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
