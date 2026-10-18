# AGENTS.md

Dataset setup plus a local Transaction Review demo (React + Vite + Express, one process). Jev runs server-side via Vercel AI Gateway (`typesafe-ai/jev`, `experimental_evaluate` from `ai`); never expose `.env`. Gemini (`@ai-sdk/google`, `GEMINI_API_KEY`) writes draft internal messages server-side in `server/messages.ts`; Jev picks the recipient. Employees in `src/employees.ts` are fictional, not dataset records.

The demo runtime exposes only synthetic companies 101–104 from `synthetic/extension-v1/`. Original dataset tools remain offline. `server/app.ts` assembles production routes; browser fixtures inject data, model responses, sampling, and timers into that assembly. Automated messages require sender approval; manual Compose/reply is explicit human mail.

Keep the floating **Ask your books** assistant (`src/AskPanel.tsx`). It supports questions, voice, explicit transaction-action previews, and chart handoff to Dashboard. Conversation history lives in SQLite through `server/chat.ts`. Dashboard reads/writes must continue through the revision-checked `server/dashboard.ts` routes; do not restore the older duplicate chat dashboard routes.

## Commands

- `uv sync` installs dependencies.
- `uv run scripts/download_dataset.py` downloads and extracts to `data/raw/` (idempotent; `--force` redoes it).
- `uv run scripts/inspect_dataset.py` prints the dataset summary.
- `npm run dev` serves the app at http://localhost:5173 (needs `AI_GATEWAY_API_KEY` in `.env`; `GEMINI_API_KEY` for message drafts).
- `npm test` discovers source/server unit and API tests. `npm run typecheck` checks server, client, fixtures, and TypeScript scripts. `npm run test:browser` uses isolated fixtures by default.

## Hosted demo

- Frontend: https://waderylan.github.io/lahacks26/app/ (built by `.github/workflows/pages.yml` on push to `main`; slideshow stays under `docs/`).
- API: https://lahacks26-api.vercel.app (Vercel Hobby project `lahacks26-api`, built by `scripts/build_vercel.mjs`, starts from `server/seed/actions.sqlite`). `AI_GATEWAY_API_KEY`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS`, and `GEMINI_KEY_PRIVATE` live only in Vercel env; env changes need `npx vercel deploy --prod`.
- Gemini key fallback for teammates without Vercel access (unused while `GEMINI_API_KEY` is set): never commit it in plaintext. Run `node --env-file=.env scripts/encrypt_gemini_key.mjs`, commit only `config/gemini-key.enc`, push to `main`; the API picks it up within a minute without a redeploy.

## Rules

- SQLite (`workspace/actions.sqlite`, configurable with `WORKSPACE_DB`) is the source of truth for all durable application state. Keep rule actions, dashboard metadata, messages/decisions, notifications, replay state, settings, and background jobs server-side; browser storage is not used for application state.
- Company restore uses `{ type: 'reset', full: true }`. Restore and dataset replacement atomically clear company review state, retain disabled rules and saved views, and preserve semantic caches. Use scratch databases in tests; never reset the live workspace for verification.
- Use `uv` for everything Python; do not use pip or system Python.
- Never modify files under `data/raw/`. Any data change must be written elsewhere and disclosed (what changed and why).
- Money is a decimal string. Use `Decimal` (`qbdata.money`, `qbdata.sum_money`); never `float`.
- IDs are company-scoped. Always carry `company_id` when combining records (`load_all` does this).
- Empty entity files load as `[]`.
- Do not read `hidden/` (simulation ground truth) in normal loading.
- Ignore macOS metadata (`__MACOSX`, `._*`, `.DS_Store`).
- Keep `CLAUDE.md` as a one-line `@AGENTS.md` import.

## Layout

- `qbdata/loader.py`: loader API (`list_companies`, `world_dir`, `load_entity`, `load_all`, `load_report`).
- `scripts/`: download and inspect scripts.
- `data/`: git-ignored archive and extracted dataset.
- `synthetic/`: generated synthetic extension companies (101-104). `extension-v1/` is app-facing; `eval/` is evaluation-only and must never be read by the app or sent to Jev. Regenerate with `uv run scripts/generate_synthetic.py`, check with `uv run scripts/validate_synthetic.py`.
