# Hosting retired

The hackathon project is complete. Public hosting was retired on 2026-10-19. The repository remains a local archive; do not recreate hosting or enable automatic deployments unless explicitly requested.

## Vercel cleanup

Authenticated checks covered team `rylanwwade-5123` (`team_gSwBQOYZjxKPQZT3HNilvbbT`). The former project was `lahacks26-api` (`prj_wAdFpz6P3SAEx1ckX4AqLYc6GZbl`).

- The project was already deleted: its project lookup returned `404 Project not found`.
- Six leftover deployments were still listed as `READY`. Each was deleted through the Vercel API and returned `200` with state `DELETED`.
- A fresh team audit returned zero projects, deployments, storage stores, integration configurations, aliases and domains. Paginated resource lists had no further results.
- The former production URL, `https://lahacks26-api.vercel.app`, returns 404. A former deployment URL also returns 404.
- The owner reported revoking the Vercel key before cleanup. Credentials are not recorded here.

Vercel documents [project deletion](https://vercel.com/docs/projects/managing-projects) as removing project deployments, domains, environment variables and settings. This cleanup also checked the separate deployment list and removed the six records it still exposed using the documented [deployment deletion API](https://vercel.com/docs/deployments/managing-deployments).

## GitHub cleanup

- Unpublished GitHub Pages for `waderylan/lahacks26`; `https://waderylan.github.io/lahacks26/app/` now returns 404.
- Disabled the `Deploy GitHub Pages` workflow remotely and removed its publishing configuration from the working tree.
- Deleted the `API_BASE` repository variable, the `github-pages` environment and the Pages build cache.
- Repository and Pages environment secret lists were empty. The repository webhook and Actions artifact lists were also empty.

## Repository cleanup

- Removed `vercel.json`, `.vercelignore` and `scripts/build_vercel.mjs`.
- Removed `.github/workflows/pages.yml` so future pushes using this tree do not publish the project.
- Removed the ignored local `.vercel/project.json` link and `.env.local` OIDC token file.
- Replaced public slide links with links to local source and updated the README, demo guide and shared agent instructions.
- Kept the application, SQLite workspace, datasets, slides and historical hosting implementation. Local model calls require valid provider credentials; no provider keys are bundled with the archive.

## Local use and validation

See [DEMO.md](DEMO.md) for `npm install` and `npm run dev`. Open `docs/slideshow/index.html` or `docs/presentation/index.html` locally to view the slides.

`npm run typecheck` and `npm run build` passed after removing the publishing configuration.
