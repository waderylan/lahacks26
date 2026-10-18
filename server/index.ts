import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { actionStore } from './actionStore.ts';
import { createReviewApp } from './app.ts';

const runtime = createReviewApp({ database: actionStore(), timers: { scanMs: 10_000, draftMs: 1000 } });
const server = createServer(runtime.app);
const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
runtime.app.use(vite.middlewares);
const port = Number(process.env.PORT ?? 5173);
server.listen(port, () => console.log(`Transaction Review: http://localhost:${port}`));
