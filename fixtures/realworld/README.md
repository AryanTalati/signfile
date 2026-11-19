# Real-world agreement templates (detection tests)

Published contract templates that the field detector was **not** designed
around. They contain bracketed placeholders only, no personal data.

| File | Source | License |
|---|---|---|
| `commonpaper-psa-v1.1.docx` | Common Paper Professional Services Agreement, Version 1.1 (Cover Page + Standard Terms), https://commonpaper.com/standards/professional-services-agreement/ | CC BY 4.0 (Common Paper) |
| `commonpaper-csa-v1.0-cover.pdf` | Common Paper Cloud Service Agreement, Version 1.0, Cover Page PDF, https://commonpaper.com/standards/cloud-service-agreement/ | CC BY 4.0 (Common Paper) |
| `bonterms-cloud-terms-example-cover.docx` | Bonterms, Example Cover Page for Bonterms Cloud Terms (committee draft 4.0), https://bonterms.com | CC0 1.0 |

Files are unmodified copies, downloaded Nov 18, 2026. Expected results are in
`manifest.json`.

## Held-out tests (not committed)

To check the rules weren't just fitted to the files above, the detector was
run, **unchanged**, on documents it had never seen. These aren't committed:
Y Combinator publishes the SAFE without an open license.

**Y Combinator Post-Money SAFE (Valuation Cap)**, as YC's DOCX (converted by
our LibreOffice) and as an independently produced PDF copy. Both gave
identical results. Signature page: `[COMPANY]` block (By:, printed
[name]/[title]), `INVESTOR:` block (By:, Name:, Title:, Address:, Email:).

| | Before fixes (Nov 18) | After fixes |
|---|---|---|
| Expected signer fields found (2 signatures, investor name, title) | 4/4 | 4/4 |
| Wrong field types | 1 (second Address line labelled "Email") | 0 |
| Parties separated | **No**: all 10 fields assigned to "client" (conf 0.40) | Yes: [COMPANY] block vs INVESTOR block |
| Flagged for review | 10/10 | 8/8 (correct: in an investment document, which party is "firm" is a guess) |

**What it showed:** party words outside our vocabulary (Investor) and bracketed
headings ([COMPANY]) weren't recognised as party headings, and roles leaked
from one block into the next. **Fixes, all generic:** short upper-case headings
directly above a block now delimit parties even when the word is unknown; a
closer unnamed heading ends the block of a known party word further up; roles
are inherited only from fields with direct evidence (no chaining); a label
that owns the blank on its own row can't also label the line above it.
