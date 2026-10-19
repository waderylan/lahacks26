import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Optional base path for local builds; public hosting is retired.
export default defineConfig({ base: process.env.VITE_BASE ?? '/', plugins: [react()] });
