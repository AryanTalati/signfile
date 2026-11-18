# signfile

Automates getting client agreements signed on every File: upload any agreement, auto-detect signature fields, send, sign, and get a sealed PDF with an audit trail.

> "Test it in 3 minutes" steps and the demo login will go here once the signing path is live.

## Development

```bash
cp .env.example .env.local   # fill in Supabase URLs
npm install
npm run dev
npm run gen:agreements       # regenerate test agreements in fixtures/agreements
```

## Submission checklist (Wed Nov 25, 2026, before 12:40 PM MST)

- [ ] Final commit pushed **before 12:40 PM MST** (19:40 UTC). No commits after.
- [ ] **Make the GitHub repo public** (Settings → General → Danger Zone → Change visibility).
- [ ] Live Render URL loads, `/api/health` returns ok, and the uptime pinger is running.
- [ ] Full test path passes on the live URL with a fresh, unseen agreement (desktop + phone).
- [ ] Demo login in this README works on the live URL.
- [ ] Anthropic monthly spend limit set.
- [ ] README "Test it in 3 minutes", DECISIONS.md and the written description are final.
- [ ] No real personal data in the repo or the live database.
