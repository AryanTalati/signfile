# Decisions

Living record of what signfile includes, what it leaves out, and why. Updated whenever a decision is made or changed.

## Assumptions

- **Who the buyer is.** Astra AI is the first customer. The wider market is AI agencies, IT consultancies, dev shops and MSPs. Their clients are businesses, so the flow is B2B: the person we email may not be the authorized signer, the client's legal team may ask for changes, and the firm usually countersigns.
- **One agreement per File.** A File is one job or engagement for one client. Each File carries one agreement with up to two signing parties by default (client, then firm), in sequence. Templates may define more roles in signing order.
- **The agreement is unseen.** We will not see the MIND client agreement in advance. Detection must be generic (labels, underscore runs, drawn lines, layout heuristics) with a manual editor and an "append a signature page" fallback, so any PDF or DOCX can be signed.
- **Email link is enough identity.** Possession of the unique signing link, plus ESIGN/UETA consent and a full audit trail (IP, user agent, timestamps, hashes), is the identity standard. This is normal for commercial B2B agreements.
- **Email may not arrive.** Grading cannot depend on inbox delivery. The signing link is shown in the app right after sending, and every email is recorded in an in-app outbox.
- **Render free tier, kept awake.** We stay on Render's free tier (512 MB RAM, sleeps after 15 min idle, ~50 s cold start). A free external uptime pinger hits `/api/health` every 10 min. That keeps Render awake for the 3-minute test, and the DB query inside it keeps the Supabase free project from pausing after a week idle. One always-on service uses ~744 of the 750 free instance-hours a month. `/api/health?deep=1` converts a realistic multi-page DOCX and reports memory, to prove 512 MB is enough for LibreOffice. The pinger uses the light check only, so it doesn't spike memory every 10 min. **Measured on Render free (Nov 18):** a 4-page DOCX converts in 9.2 s (11.3 s before LibreOffice's profile was pre-built into the image) with the container peaking at 257 MB of 512 MB. Fine for the 3-minute test, but DOCX conversion must start immediately on upload and show progress.
- **App and DB in the same region.** Supabase is in Oregon (us-west-2). The Render service also runs in Oregon, the Blueprint default, now pinned with `region: oregon` in `render.yaml`. Measured on the live service: 3-4 ms per DB query.
- **Supabase session pooler (port 5432), not the transaction pooler (6543).** Originally the app used the transaction pooler with `prepare: false`. Under concurrent load (E2E suite, 9 workers), requests hung for 2 minutes until Postgres' statement timeout fired. `pg_stat_activity` showed backends `active` and waiting on `ClientRead`: Postgres was waiting mid-query for data the pooler never forwarded. The same suite over the session pooler passed 18/18 twice, in ~22 s instead of 3 minutes with failures. Session mode suits one long-lived server; the transaction pooler is built for serverless fan-out. `prepare: false` is kept since it's harmless.
- **Connection budget for session mode.** Each session-mode client connection holds one pooler server connection, and Supabase's default Pool Size is **15 per database/role**. Every one of our connections uses the `postgres` role. Postgres `max_connections` is 60; Supabase's own services use ~9. Budget: app pool **3** (`DB_POOL_MAX`) + 1 health-check connection = 4 per process. A Render deploy briefly runs old + new instances (8), plus a local dev server or Docker E2E run (4), plus 1-2 scripts = ~14, under 15. Idle connections close after 20 s and are recycled every 30 min. The Supabase dashboard/Studio connects directly and doesn't count. 3 connections handled the full parallel E2E suite (9 workers) without slowdown. If the instance count or pool size grows, raise Pool Size in Supabase's Database settings first.
- **Local dev and production share one database.** `npm run db:setup` migrates production, so migrations run before pushing code that needs them. Demo data is shared, which is fine for test data.
- **Incident (Nov 18): stuck wake-up on Render free.** After the instance slept, Render never restarted Node. There was no app output, and a redeploy of the same cached image also hung at "Deploying...". The same image started in 4.3 s locally under free-tier limits, and **Restart service** fixed it. Memory wasn't involved: 52 MB after startup, 209 MB peak during a DOCX conversion. Mitigation: the uptime pinger keeps the instance from sleeping. Runbook if it recurs: Render → Manual Deploy → Restart service.
- **Known limitation of the free hosting tier: 0.1 CPU.** Render's free instance has 0.1 CPU and 512 MB. Document processing (DOCX conversion ~9-10 s, PDF parsing, detection) is CPU-bound, so uploads are processed **one at a time**. Up to 3 more wait, and beyond that the upload page shows "Waiting for other documents to finish…" and retries for ~1 minute. Signing, viewing and the dashboard are light and unaffected. One person testing (the grading scenario) sees no queue; a team uploading several documents at the same moment would wait in line. **Scaling path:** (1) a larger Render instance (Starter 0.5 CPU or Standard 1 CPU) cuts conversion to ~1-2 s with no code change; (2) then move conversion + detection to a separate worker (an Inngest step or a dedicated Render worker service) so the web instance never does CPU-heavy work, and raise the queue limits. Testing follows the same constraint: the live site gets a short smoke test (1 worker, desktop); the full suite (desktop + phone, full parallelism) runs against the local Docker image.
- **AI costs are capped.** The README tells operators to set a monthly spend limit in the Anthropic console. If the limit is hit, the non-AI fallbacks take over.
- **Test data only.** Seed data, generated agreements and E2E fixtures use fictional names and example.com addresses.

## Included (and why)

### Phase 1: the core signing path (must be flawless)
| Feature | Why |
|---|---|
| Company signup, team members (admin/member), branding (name, logo, color) on emails + signing page | Sold to many firms, so multi-tenant from day one. Clients should see the firm's brand, not ours. |
| Upload PDF or DOCX; DOCX converted with LibreOffice headless | Firms keep agreements in Word. Converting server-side means one PDF pipeline. |
| Rule-based field detection (labels, underscore runs, drawn lines, role guess from headings) | Works with no AI and no network. The test agreement is unseen, so detection is generic. |
| Drag/resize review editor | Detection is never fully trusted. A human confirms before sending. |
| "Append a signature page" fallback | Scanned or unusual documents must still be signable. Prevents dead ends. |
| Create File: template, client legal name, signer, reference, firm-filled values (fee, start date…) | The firm fills the deal-specific details once, and they are stamped into the document. |
| Signing page: ESIGN/UETA consent, guided next field, draw/type signature, mobile-first | Legally sound consent, and most clients open links on phones. |
| Sequential signing (client, then firm countersign) | Matches how B2B agreements are executed. |
| Request changes (comment), decline (reason), forward to the authorized signer | B2B realities. Every one is logged, so there are no dead ends. |
| Deterministic seal: stamp values, append audit certificate, SHA-256 of original and final | Tamper evidence and a defensible record without depending on AI or third parties. |
| File dashboard (status, timeline, resend, void, download, copy link), outbox, public `/verify` | Operators need to see and act on every File. `/verify` lets anyone check a signed PDF. |
| Owner side of request changes: see the comment, upload a revised agreement as a new template version (fields carried over when pages match), resend on the same File; both versions in the timeline | Legal redlines are the most common B2B outcome. Without this loop, "request changes" would be a dead end. |
| `expired` File status with a branded expired page | Links shouldn't live forever. The client must know which firm to contact for a new link. |
| Certificate timestamps in UTC with each signer's local time + time zone | UTC is unambiguous for the record. Local time matches what the signer saw. |
| Edge cases: encrypted PDFs rejected clearly, large files, rotated pages, links opened twice, expired/voided links | "It works" means it works on documents and behaviour we didn't plan for. |
| Template + fields snapshotted into each File at send | Editing a template later must never change an agreement already sent. |

### Phase 2: automation and integration surface
CSV bulk create, REST API with hashed API keys, HMAC-signed webhooks, scheduled same-thread reminders that stop and notify the owner, Claude-assisted field labeling with confidence flags, Gmail send-as-firm and reply reading. *Why:* the brief says "automates it on every file". API + webhooks let any CRM integrate without us building connectors.

### Phase 3: reply handling with the owner in control
AI classifies replies (question, wants to talk, sign later, decline, out-of-office, unclear). Code routes each class. Every outbound message needs owner approval. Calendar slots are owner-approved. Drive archive and Slack notifications. *Why:* the slow part of manual signing is the back-and-forth, and firms will only trust it if they approve every message.

### Phase 4: product completeness
MIND sync on completion, onboarding checklist, pricing page (no billing), data export and per-client deletion, help page, E2E tests. *Why:* "close to a product a company could buy and run today".

### Engineering decisions
| Decision | Why |
|---|---|
| Next.js App Router + TypeScript, one Docker app on Render | One deployable. LibreOffice has to be inside the image. |
| Postgres on Supabase, Drizzle ORM + SQL migrations | Durable managed Postgres with pgvector available later. Drizzle is light, typed, and emits plain SQL migrations. |
| PDFs and logos in a private Supabase Storage bucket behind `storage.ts` | Render's disk is ephemeral. Keeping large blobs out of Postgres rows keeps the DB small. Same vendor as the DB, so one less account. |
| Hand-rolled email+password auth (argon2id via `@node-rs/argon2`, DB sessions, httpOnly cookie) | Small surface, and it fits the company/role model. The argon2 package ships prebuilt binaries, so the Docker build needs no native compilation. |
| Per-client deletion = hard delete of whole Files (files, recipients, events, outbox, documents, storage objects) via one privileged purge function; a PII-free `deletion_log` row records it | Redacting fields inside events would still leave names, emails and signatures in the sealed PDF and certificate, which can't be edited without breaking the hash. A record that's half redacted is neither private nor a valid audit trail. The insert-only trigger on `events` blocks UPDATE always and DELETE unless the purge function sets a transaction-local flag, so the audit log can't be edited piecemeal. The UI warns the firm to export first, since they may have their own retention duties. |
| Encrypted PDFs: **reject** ones that need a password to open, with a clear message; **accept** ones that open without a password but carry permission restrictions, stripping the restrictions (qpdf in the Docker image) before detection and stamping | Password-protected files can't be read without the password, and asking for it is a dead end for the firm. Permission-restricted PDFs open normally in every viewer and are common exports from contract tools, so rejecting them would surprise users. |
| Test agreements are generated, not hand-picked: `npm run gen:agreements` writes 12 fixtures + a ground-truth `manifest.json` (expected outcome, signer roles/pages, known traps) and self-checks each file | The detector is tested against layouts it wasn't designed around: table-cell signature blocks, dot leaders, drawn lines with labels below, two columns, initials boxes, scans, rotated pages, AcroForms, large files, encryption. Fixed-date output keeps regenerated files byte-identical. |
| RLS enabled on every table with **no policies**, and Supabase's `anon`/`authenticated` roles revoked | The server is the only client, and it connects as the table owner, so RLS doesn't affect it. If the Data API were ever switched on, nothing would be exposed. Tenant isolation is enforced in our query layer (`company_id` on every query). `npm run db:verify` checks this, plus the insert-only audit log and the purge function, against the real DB. |
| Health memory = non-reclaimable container memory (`anon + shmem + kernel` from cgroup `memory.stat`), not `memory.current` | `memory.current` includes page cache and drifted to the 512 MB limit without any OOM risk. The non-reclaimable figure shows real headroom: 164 MB peak during a DOCX conversion locally. |
| Public demo account (Astra AI, credentials on the login page and in the README) with a one-click "Log in to the demo" | Graders and prospects can test in seconds without signing up. `npm run seed` resets it. Everything in it is test data. |
| Login throttle keyed on IP+email (8 failures / 15 min) and IP (30), never email alone | Locking by email alone would let anyone lock out any account, including the public demo. Wrong-password responses take the same time whether or not the email exists (a dummy argon2 verify). |
| Signup retries with a new slug if two companies with the same name sign up at once | Found by the E2E suite (parallel desktop + phone signups). A unique-constraint race must not show users a generic error. |
| `purge_company()` deletes a whole company, the second way past the insert-only events trigger, and logs it to `deletion_log` (scope `company`, row counts only). `deletion_log.company_id` has **no** foreign key so the log outlives the company. `npm run purge:company` dry-runs by default, removes storage objects, and refuses the demo company | Needed for account deletion and to clean up E2E test companies from the shared DB. First used Nov 18 to remove an account created with real personal data on the live site. Afterwards, a hash-based scan of every text/JSON column found zero remaining copies of the address. |
| Client IP = Cloudflare's `CF-Connecting-IP` (fallback `True-Client-IP`), via one `getClientIp()` helper used by the login throttle, sessions and the audit trail. `X-Forwarded-For` is never trusted in production | Tested on the live Render URL: a client-sent `X-Forwarded-For: 1.2.3.4` stays as the *first* entry (`1.2.3.4, <client>, <Cloudflare edge>, <Render internal>`), so reading the first entry let anyone pick their IP and bypass the throttle. Cloudflare rejects requests that send their own `CF-Connecting-IP` (error 1000) and overwrites `True-Client-IP`. `X-Real-IP` isn't passed through. If no trusted header is present, the IP is recorded as unknown rather than guessed. Unit tests use the real header sets captured from production. |
| **Rule-based field detection** (no AI on Day 2): blanks (underscores, dot leaders, drawn lines split into table cells, empty boxes, form widgets) + labels (same phrase, left, grid row label, below, above, or a label with empty space beside it) + a signature-block filter + party roles (own label, "on behalf of", column heading, firm name, defined terms like `(the "Provider")`, unnamed upper-case headings) | Works offline and deterministically, and every field carries a confidence and a "why". Below 0.7 is flagged in the editor until a person confirms it. The signature-block filter is what keeps "Effective Date" and deal-term fill-ins out. |
| Detection is measured, not assumed: `npm run eval:detection` runs 12 generated + 3 real-world agreements (Common Paper PSA/CSA, Bonterms; CC BY / CC0) against a ground-truth manifest and writes `fixtures/detection-report.md` | Shows exactly where detection is weak. The tuned set is at 15/15 documents and 96/96 expected fields. A **held-out** test (YC SAFE, DOCX + PDF, run unchanged) found every signer field, but initially failed to separate the two parties, so the rules were generalised (see `fixtures/realworld/README.md`). Known weak spots: party names outside our vocabulary fall back to "first block = client" and are flagged; anything scanned gets "append a signature page". |
| Permission-only encrypted PDFs are decrypted with qpdf; damaged PDFs are repaired with qpdf; password-protected PDFs are rejected with instructions | qpdf is small (installed in the Docker image) and handles both cases deterministically. |
| A Docker `tools` target (same OS layer as production: LibreOffice + qpdf + fonts) runs the eval and scripts | Detection results match production exactly, without installing LibreOffice on developer machines. |
| Field editor: pick a type then click the page to add; drag to move; corner handle to resize; select then one click to retype or reassign; ⌘Z undo, ⌘D duplicate, arrows nudge, Delete removes; autosave | You asked for one-or-two-click edits, and it must work with zero detected fields. Every detected field shows its confidence; under 70% gets an amber dashed outline, ⚠ and a review list with "Looks right". |
| Saves carry the PDF's hash; the server rejects a save made against an older PDF, and autosave pauses during "append a signature page" | Found by E2E: an in-flight autosave of the empty field list could land after the append and wipe the new signature-page fields. |
| Signup transaction uses `lock_timeout = 5s` and retries | A signup must fail fast and retry, never hang on another transaction's lock. |
| Uploads are processed **one at a time** (3 may wait; more get "busy", which the upload page retries automatically for ~1 min), and abandoned uploads stop processing | Render free has 0.1 CPU. A live E2E run with 9 parallel workers queued so much conversion/parsing work that even logins timed out for an hour, while abandoned uploads kept running. Queueing keeps the site responsive for everyone. A grader uploading one document is unaffected. Live tests run with 2 workers; local/Docker runs keep full parallelism. |
| Every AI feature has a non-AI fallback (`AI_ENABLED=false` or no key), and the test suite runs with AI disabled | The product must work if the API is down, the key is missing or the spend limit is hit. |
| Event-driven workflow (Inngest) with AI steps, no agents | Predictable, auditable, retryable. State lives in Postgres, not in prompts. |
| Sealing runs synchronously in the final-signature request | The critical path must not depend on a queue or integration being up. |
| All LLM calls through one wrapper with zod-validated structured outputs | Provider swappable, outputs validated, and easy to disable (rule-based fallback). |
| Field coordinates stored normalized (0–1) relative to the page as displayed | Survives rotated pages and any rendering scale. Converted to PDF space only when stamping. |
| Signing tokens: 32 random bytes (base64url), stored in DB, unique index; a "copy link" re-reads them | The firm needs to copy the link again later. Tokens are revoked on void, forward or completion. |
| Outbox written before any send attempt; sending is best-effort with retries | Every email is visible in-app even if the provider fails. |
| Hash both the uploaded original (DOCX or PDF) and the PDF that was signed, plus the final sealed PDF | The certificate proves which source document was signed. |

## Left out (and why)

| Left out | Why |
|---|---|
| SMS / WhatsApp | B2B agreements are sent and signed by email. Adds cost, compliance work and phone-number collection for little gain. |
| Native CRM connectors (HubSpot, Salesforce…) | The REST API + signed webhooks (+ Zapier on top of them) cover every CRM without one-off connectors. |
| Microsoft Teams / Outlook | Time-boxed to one ecosystem (Google + Slack). The integration layer is pluggable, so these can be added later. |
| Stripe billing | Pricing page only. Billing doesn't help get an agreement signed, and it adds risk to a 7-day build. |
| Identity verification beyond the email link (ID scan, KBA, SMS OTP) | Not needed for commercial B2B agreements under ESIGN/UETA. The audit trail covers it. |
| SSO (SAML/OIDC) | Enterprise feature. Small firms use email+password. |
| Autonomous / multi-agent design | Not predictable or auditable enough for legal documents. Code and humans decide next steps. |
| n8n / Zapier as the core | The workflow must be in our code and DB to be reliable and multi-tenant. Zapier can sit on top of webhooks. |
| AI memory of client conversations | Privacy risk and prompt bloat. Each AI call gets a small fixed input about one File. |
| AI explaining contract terms directly to clients | Liability: that's legal advice. Drafts go to the owner, cite a clause, and need approval. |
| In-app editing of agreement text | Agreements are drafted in Word. Editing PDFs breaks fidelity and the hash chain. Changes are requested, then a new version is uploaded. |
| Certificate-based PDF digital signature (PAdES) | Needs a trusted CA certificate. A self-signed one shows warnings in Acrobat. SHA-256 + `/verify` + the audit certificate give tamper evidence. *Revisit if ahead.* |

## Tools and services used

| Tool / service | Used for | On the critical signing path? |
|---|---|---|
| Next.js + TypeScript | App, signing page, REST API | Yes |
| Render (Docker) | Hosting the single app | Yes |
| LibreOffice headless | DOCX → PDF | Yes (DOCX only) |
| Supabase Postgres | All state | Yes |
| Supabase Storage | PDFs, logos | Yes |
| Drizzle ORM | Schema, migrations, queries | Yes |
| pdfjs-dist | Browser rendering; server-side text + line extraction | Yes |
| pdf-lib | Stamping, certificate page, append signature page | Yes |
| zod | Input + LLM output validation | Yes |
| Resend | Platform email fallback | No (outbox + in-app link) |
| Inngest | Workflow steps, reminders, waits for approvals/replies | No (Phase 2+) |
| Claude API (via `src/lib/llm`) | Field labeling, reply classification, drafts | No (rule-based fallback) |
| Gmail API | Send as firm, read replies | No |
| Google Calendar / Drive | Call slots + Meet; archive signed PDFs | No |
| Slack | Owner notifications | No |
| MIND MCP server | Knowledge-graph sync on completion | No |
| Playwright | E2E test of the full path (desktop + mobile) | Test only |
| Claude Code | Development assistant | — |
