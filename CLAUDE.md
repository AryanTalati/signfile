# CLAUDE.md — signfile

Read this before every session. Record every new or changed decision in `DECISIONS.md` and tell the user.

## What we're building
A take-home for **Astra AI** (small AI consulting / IT services firm, maker of MIND). The client brief: every client must sign the same agreement before work starts on a **File**; automate getting it signed on every File, then sell it to every company in the industry (AI agencies, IT consultancies, dev shops, MSPs). B2B: the client's legal team may request changes, the recipient may not be the authorized signer, and the firm usually countersigns. Flow: demo → deal won → client agreement → kickoff.

- Anthony (founder) will test it by getting the **MIND client agreement**, which we have never seen, signed through the live URL. **The system must work for any unseen PDF or DOCX.**
- Graded on: **works** (unseen agreement signed end to end on the live URL), **complete** (close to a product a firm could buy and run today), **decisions hold up** (included/left out and why).
- Deliverables: public GitHub repo, live Render URL, written description, included and left-out features.
- **Deadline: Wed Nov 25, 2026, 12:40 PM MST (19:40 UTC). No commits after that.** Remind the user as it approaches (from Nov 23 on, at the start of each session).
- Test data only. Never real personal info.

## Vocabulary
**"File"** = one job/engagement for one client. Use it everywhere in UI and code (`files` table, `FileStatus`, `/files/[id]`). Never "deal" or "envelope".

## Non-negotiable test path
Unfamiliar PDF/DOCX → upload → fields detected or placed → send → client signs → firm countersigns (if needed) → sealed PDF + audit certificate. No dead ends, under ~3 minutes, works on desktop and phone.
- Never depends on email or any integration: show the signing link in the app right after sending, and keep an in-app **outbox** of every email.
- If detection finds nothing (scanned PDF, odd layout), offer **"Append a signature page"**.
- Every change must keep this path green. Run the E2E test before committing anything that touches it.

## Architecture rules
- **Event-driven workflow with AI steps.** No autonomous agents, no multi-agent. Code and human approvals decide what happens next; AI only interprets text and drafts.
- **All state in Postgres** (statuses, reminder counts, next reminder date, pauses). AI gets a small fixed input about one File. Never feed whole histories into prompts.
- **One LLM wrapper** (`src/lib/llm/`): named functions (`llm.labelFields`, `llm.classifyReply`, `llm.draftAnswer`, …), structured outputs validated with zod, prompt caching for agreement text, provider swappable. Small/fast model for reply classification; larger model only for reading new agreements.
- **AI never** decides signature validity, edits the document, or contacts a client without owner approval. Uncertain detections are flagged for review, never guessed. Drafted answers must cite a clause; if none supports it, the owner gets "no answer found".
- **Signing and sealing are fully deterministic.** If AI is off or fails, the product still works (rule-based detection + human review). Sealing runs in-request, not dependent on Inngest.
- **Multi-tenant from day one.** Every query is filtered by `company_id` (go through the scoped repo helpers; never query tenant tables raw). No cross-company data.
- **Snapshot** the template PDF and fields into each File at send time; later template edits never change in-flight Files.
- Integrations (Gmail, Calendar, Drive, Slack, MIND) are optional and off the critical path; failures are logged, never block signing.
- **Every AI feature has a working non-AI fallback**, switched by `AI_ENABLED=false` (or a missing API key). The test suite runs with AI disabled. A feature isn't done until its fallback is tested.

## Stack
- Next.js (App Router) + TypeScript: app, signing page, REST API. One Docker image on Render; Dockerfile installs LibreOffice headless for DOCX→PDF.
- Postgres on **Supabase** (pgvector later). Drizzle ORM + migrations. Not Render Postgres, not local files. Everything connects via the **session pooler (port 5432)**. The transaction pooler (6543) hung requests under concurrency, see DECISIONS.md. Keep `prepare: false` in every client. **Connection budget:** session mode allows 15 pooler connections per role; the app pool is 3 (`DB_POOL_MAX`) + 1 health check per process. Scripts use `max: 1`. Never raise these without updating the budget in DECISIONS.md. Render and Supabase are both in Oregon (us-west-2), measured at 3-4 ms per query. Still run independent queries in parallel and never loop queries. **Local dev and Render share one database**: `npm run db:setup` migrates production, so run it before pushing code that needs the new schema. `npm run db:verify` checks RLS, grants, the insert-only events table and the purge function.
- Binary files (PDFs, logos) in **Supabase Storage** (private bucket) behind `src/lib/storage.ts`; Render disk is ephemeral.
- pdfjs-dist (render in browser; text + line extraction with coordinates on server), pdf-lib (stamp, certificate, seal).
- Inngest: workflow steps, retries, `waitForEvent` for approvals/replies, scheduled reminders (Phase 2+).
- Claude API via the wrapper. Resend for platform email (fallback); Gmail API to send as the firm and read replies.
- Google Calendar, Google Drive (`drive.file` scope), Slack. MIND MCP sync (check their auth docs first; optional).
- Email + password auth, DB-backed sessions (httpOnly cookie), companies with admin/member roles. Passwords hashed with `@node-rs/argon2` (prebuilt binaries; no native compilation in Docker).
- **Hosting: Render free tier** (512 MB). An external pinger hits `/api/health` every 10 min so Render doesn't sleep and Supabase doesn't pause. `/api/health` runs a lightweight DB query; `/api/health?deep=1` also converts a realistic multi-page DOCX and reports duration + memory (RSS/heap), used to confirm the instance is big enough. Don't add anything heavy to the plain health check.

## Data model (summary; details in migrations)
companies, users, sessions, api_keys (hashed), templates (versioned, archived flag, roles w/ signing order, fields JSON), files (company_id, template snapshot, client legal name, reference, firm-filled values, status, original/final pdf, sha256 of both, owner), recipients (role, name, title, email, order, token, status, values, ip, user agent, timestamps), events (append-only audit log), outbox, webhook_deliveries, agreement_versions/clauses.

Field types: `signature`, `initials`, `date_signed` (auto), `full_name`, `title`, `company`, `text`, `checkbox`, `firm_fill` (filled by firm when creating the File: fee, start date, address…).

File statuses: `draft`, `sent`, `partially_signed`, `completed`, `changes_requested`, `declined`, `voided`, `expired`. An expired link shows a clear expired page with the firm's name and how to get a new link.

Templates are versioned: a revised agreement is a new version of the same template. A File records every agreement version it has used (`file_documents`), and both appear in its timeline.

**Per-client deletion = hard delete of whole Files** (files, recipients, events, outbox, documents, storage objects) through one privileged purge function, the only path allowed past the insert-only trigger on `events`. It writes a PII-free row to `deletion_log`. Never partially redact events. Reason in DECISIONS.md.

Certificate timestamps are in **UTC**, with each signer's local time and IANA time zone (taken from the browser at signing) shown next to them.

Field coordinates are stored normalized (0–1) relative to the page **as displayed** (rotation applied); conversion to PDF user space happens only in the stamping code.

## Feature phases — build in order, never cut from the top
Calendar: Phase 1 = Nov 18–20, Phase 2 = Nov 21, Phase 3 = Nov 22, Phase 4 = Nov 23, Nov 24 = buffer/polish/E2E, Nov 25 morning = final checks, submit before 12:40 PM MST.

**Phase 1 (must be flawless)**
1. Company signup, team members, branding (name, logo, color) on emails + signing page.
2. Upload PDF/DOCX → rule-based detection (Signature/Signed/By/Date/Name/Title/Initials labels, underscore runs, drawn lines; role guess from nearby headings like CLIENT vs company name) → drag/resize review editor → save template.
3. Append-signature-page fallback.
4. Create File: template, client legal name, signer name/title/email, reference, firm-filled fields.
5. Signing page: ESIGN/UETA consent, guided "next field", draw or type signature, mobile-friendly; client then firm (sequential).
   - **Saved signature (Day 3):** a firm user adopts their signature once in their profile (with ESIGN consent); countersigning is then one click, "Sign with my saved signature", still a human action via their own link.
   - **Per-template signing mode (Day 3):** (a) "Firm countersigns after the client" (default) or (b) "Firm signs when sending": the authorized firm signer applies their saved signature at send time, recorded as their own signing event (consent, IP, UA, timestamp), so the agreement completes and seals the moment the client signs. In (b) the firm is signing order 1 and the client is last. Only the authorized signer can apply their own signature: if someone else sends, the File waits for the signer's one-click approval. Never sign on anyone's behalf automatically. **Exception (Nov 20, user decision): auto-countersign**, a standing instruction the countersigner gives *for their own saved signature* in Settings (explicit consent, off by default, no one can turn it on for someone else); when the last other signer finishes, their signature is applied and the File seals, logged as an automatic countersign with the IP/UA where they authorized it.
6. Request changes (comment), decline (reason), forward to the right signer (logged). **Owner side of request changes:** owner sees the comment on the File, uploads a revised agreement as a new template version (fields carried over where page count + sizes match; otherwise re-detected and flagged for review), then resends on the **same File** with fresh links. Both versions stay in the timeline.
7. Seal: stamp values, append audit certificate (File ID, signers, emails, titles, IPs, UAs, timestamps, event log, SHA-256 of original and final), email PDF to all, download in app.
8. File dashboard: status (incl. expired), timeline, resend, void, download, copy link; outbox page; public `/verify` (upload PDF, check hash).
9. Edge cases: reject encrypted PDFs clearly; large files; rotated pages; link opened twice; expired/voided links.

**Phase 2**: CSV bulk create; REST API with API keys; HMAC-signed webhooks (signed, changes_requested, declined, stalled); same-thread reminders on a schedule then stop + notify owner; Claude-assisted field labeling + template summary (flag low confidence); Gmail send-as-firm + reply reading.

**Phase 3**: Reply handling with owner in control — question → owner gets AI draft citing a clause → edits/approves → sent in thread; wants to talk → reply in thread or offer call (calendar free/busy → owner-approved slots → client picks = auto-book with Meet; client proposes = owner approves); "sign later" → pause reminders until date; decline → notify; OOO → shift reminder; unclear → owner. Optional kickoff-call offer after signing. Drive folder per File. Slack notifications.

**Phase 4**: MIND sync on completion (Company → Client → File → Agreement version → key terms → signers → signed date); onboarding checklist; pricing page (no billing); data export + per-client deletion; help page; end-to-end testing.

**Backlog (agreed, not started)**: template delete/archive on the Templates page.

**Only if ahead**: approved-answers library (per company + agreement version, `{{fee}}` placeholders, clause hashes → "needs review"), email intake to draft a File, our own MCP server.

## Deliberately left out
SMS/WhatsApp, native CRM connectors, Teams/Outlook, Stripe billing, identity verification beyond email link, SSO, autonomous/multi-agent design, n8n/Zapier as core, AI memory of client conversations, AI explaining contract terms to clients, in-app editing of agreement text. Reasons in `DECISIONS.md`. Don't build these.

## Testing scope
- Run tests on desktop Chromium only unless a change is specifically mobile-related. No extra browsers, device emulation or screenshot tests by default.

## Working rules
- Day 1 order: (1) hello-world on Render with Docker + LibreOffice + `/api/health`, (2) Supabase DB + migrations, (3) auth + signup + seed, (4) test-agreement generator. If Day 1 runs long, move team invites and branding to Day 3.
- Seed demo company "Astra AI" with a demo login (credentials in README).
- `scripts/gen-test-agreements` makes varied agreements the detector was NOT designed around (DOCX with tables, PDF with drawn lines, two-column signature blocks, multi-page with initials, scanned/image-only PDF). Automated E2E test (Playwright) covers the full path on desktop + mobile viewport.
- `.env` never committed; keep `.env.example` current.
- The reminder/expiry sweep runs only with `ENABLE_SWEEP=1`, set on Render only; never set it locally or in Docker (they share the production DB).
- E2E (`npm run test:e2e`) runs desktop + phone against localhost/Docker and must stay green. Against the **live** URL, the config runs only `tests/e2e/smoke.spec.ts` (1 worker, desktop) to avoid loading the 0.1-CPU instance; never point the full suite at production. Test accounts use `@signfile-e2e.example` and are purged in global teardown, so never use that domain for anything else. Before pushing a deploy-affecting change, also run the suite against the Docker image (`E2E_BASE_URL=http://localhost:10000`). **Run the Docker image with Gmail disabled** (`-e GMAIL_CLIENT_ID= -e GMAIL_CLIENT_SECRET= -e GMAIL_REFRESH_TOKEN= -e GMAIL_SENDER=`) and with `-e E2E_HOOKS=1` (enables the mocked-time endpoint used by the reminder/expiry tests; never set it on Render) so tests never send real email; test addresses (example.com etc.) are never sent anyway. **Also run it with the model mocked** (`-e LLM_MOCK=1 -e ANTHROPIC_API_KEY=`): only "E2E AI" test companies get the mock, everyone else is rules-only, so tests never call Claude. Never set `LLM_MOCK` on Render. **And point MIND sync at the test mock** (`-e MIND_API_KEY= -e MIND_MCP_URL=http://host.docker.internal:4790/mcp`; the override only works with `E2E_HOOKS=1`), so no test ever writes to a real MIND account.
- Auth: `requireAuth()` / `requireAdmin()` in every page and action behind login. Tenant data access always uses `auth.company.id`, never an id from the request.
- Client IP: only via `getClientIp()` / `requestMeta()` (Cloudflare's `CF-Connecting-IP` on Render). Never read `X-Forwarded-For` directly: its first entry is client-controlled.
- Unit tests: `npm run test:unit` (node:test via tsx).
- Small, frequent commits with clear messages.
- Repo is **private until submission**. The README's "Submission checklist" (make repo public, last commit before the deadline, etc.) must be done on Nov 25. Remind the user.
- README starts with "Test it in 3 minutes" + demo login. Setup steps include setting a monthly spend limit in the Anthropic console.
- When unsure: make a reasonable decision, write it in `DECISIONS.md`, tell the user.
