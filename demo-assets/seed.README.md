# Demo database snapshot

`seed.sqlite` is a consistent backup of the main checkout's
`workspace/actions.sqlite`, captured on 2026-10-18 at 01:11 UTC.

- Contains 762 synthetic transaction rows: 416 for company-018 and 346 for company-101.
- Contains one dataset-version document; no saved rules, messages, or tasks were present.
- Captured with the SQLite online backup API, including committed WAL changes.
- Snapshot journal mode is DELETE so it can travel as one file. Application startup enables WAL again.
- Original dataset files and the live database were not changed.
- This is a static snapshot. Local changes do not sync through GitHub.

## Use in a fresh checkout

Stop the application first. Run these PowerShell commands from the repository root:

```powershell
if (Test-Path -LiteralPath 'workspace/actions.sqlite') { throw 'A local database already exists; back it up before replacing it.' }
if ((Test-Path -LiteralPath 'workspace/actions.sqlite-wal') -or (Test-Path -LiteralPath 'workspace/actions.sqlite-shm')) { throw 'Existing SQLite sidecar files require recovery before restoring a snapshot.' }
New-Item -ItemType Directory -Force -Path 'workspace' | Out-Null
Copy-Item -LiteralPath 'demo-assets/seed.sqlite' -Destination 'workspace/actions.sqlite'
```

Use the default `WORKSPACE_DB` setting. Install dependencies, configure `.env`, and
set up the source dataset as described in the main README before starting the app.
