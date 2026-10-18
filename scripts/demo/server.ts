// Demo-only server: the app's normal entry point, but Vite neither watches files nor hot-reloads,
// so edits elsewhere in the repo cannot reload the page in the middle of a recording.
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { actionStore } from '../../server/actionStore.ts';
import { createReviewApp } from '../../server/app.ts';

const runtime = createReviewApp({ database: actionStore(), timers: { scanMs: 10_000, draftMs: 1000 } });
const server = createServer(runtime.app);
const vite = await createVite({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'spa' });
runtime.app.use(vite.middlewares);
const port = Number(process.env.PORT ?? 5180);
server.listen(port, () => console.log(`Transaction Review demo: http://localhost:${port}`));
