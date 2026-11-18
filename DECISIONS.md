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
- **One Supabase connection string.** The app, migrations and scripts all connect through the shared transaction pooler (port 6543) with prepared statements off (`prepare: false` in every postgres-js client). Drizzle's migrator works through it: each migration runs inside one transaction. `MIGRATION_DATABASE_URL` (session pooler) is optional. The server connects as the DB owner. The Supabase Data API is off.
- **Local dev and production share one database.** `npm run db:setup` migrates production, so migrations run before pushing code that needs them. Demo data is shared, which is fine for test data.
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
