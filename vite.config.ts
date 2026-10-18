import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE is set for the GitHub Pages build, which serves the app under /lahacks26/app/.
export default defineConfig({ base: process.env.VITE_BASE ?? '/', plugins: [react()] });
