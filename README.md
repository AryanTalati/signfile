# signfile

Automates getting client agreements signed on every File: upload any agreement, auto-detect signature fields, send, sign, and get a sealed PDF with an audit trail.

## Test it in 3 minutes

**Live:** https://signfile.onrender.com
**Demo login:** `demo@astra-ai.example` / `astra-demo-2026` (or click **Log in to the demo** on the login page). The demo company is Astra AI. Test data only.

1. Log in to the demo.
2. *(Coming next: upload any PDF or Word agreement, review the detected fields, create a File, sign as the client, countersign, download the sealed PDF.)*

Or create your own company at `/signup`.

## Development

```bash
cp .env.example .env.local   # fill in Supabase URLs
npm install
npm run dev
npm run db:setup             # run migrations + create the private storage bucket (shared DB: this migrates production)
npm run db:verify            # check RLS, grants, insert-only audit log, purge functions
npm run seed                 # (re)create the Astra AI demo company + demo login
npm run gen:agreements       # regenerate test agreements in fixtures/agreements
npm run test:e2e             # Playwright, desktop + phone; E2E_BASE_URL=https://... to test a deployed URL
```

**Setup note:** set a monthly spend limit in the Anthropic console before adding an API key. If the limit is hit, every AI feature falls back to its non-AI path.

## Submission checklist (Wed Nov 25, 2026, before 12:40 PM MST)

- [ ] Final commit pushed **before 12:40 PM MST** (19:40 UTC). No commits after.
- [ ] **Make the GitHub repo public** (Settings → General → Danger Zone → Change visibility).
- [ ] Live Render URL loads, `/api/health` returns ok, and the uptime pinger is running.
- [ ] Full test path passes on the live URL with a fresh, unseen agreement (desktop + phone).
- [ ] Demo login in this README works on the live URL.
- [ ] Anthropic monthly spend limit set.
- [ ] README "Test it in 3 minutes", DECISIONS.md and the written description are final.
- [ ] No real personal data in the repo or the live database.
