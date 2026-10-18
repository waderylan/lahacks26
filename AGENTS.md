# AGENTS.md

Dataset setup plus a local Transaction Review demo (React + Vite + Express, one process). Jev runs server-side via Vercel AI Gateway (`typesafe-ai/jev`, `experimental_evaluate` from `ai`); never expose `.env`. Gemini (`@ai-sdk/google`, `GEMINI_API_KEY`) writes draft internal messages server-side in `server/messages.ts`; Jev picks the recipient. Employees in `src/employees.ts` are fictional, not dataset records.

## Commands

- `uv sync` installs dependencies.
- `uv run scripts/download_dataset.py` downloads and extracts to `data/raw/` (idempotent; `--force` redoes it).
- `uv run scripts/inspect_dataset.py` prints the dataset summary.
- `npm run dev` serves the app at http://localhost:5173 (needs `AI_GATEWAY_API_KEY` in `.env`; `GEMINI_API_KEY` for message drafts).

## Rules

- SQLite (`workspace/actions.sqlite`, configurable with `WORKSPACE_DB`) is the source of truth for all durable application state. Keep rule actions, dashboard metadata, messages/decisions, notifications, replay state, settings, and background jobs server-side; browser storage is only read by the legacy importer.
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
