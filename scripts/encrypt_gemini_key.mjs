// Encrypts GEMINI_API_KEY to config/gemini-key.pub.pem and writes config/gemini-key.enc (safe to commit).
// Usage: node --env-file=.env scripts/encrypt_gemini_key.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';

const key = (process.env.GEMINI_API_KEY ?? '').trim();
if (!key) { console.error('Set GEMINI_API_KEY (e.g. in .env) first.'); process.exit(1); }
const encrypted = crypto.publicEncrypt({ key: fs.readFileSync('config/gemini-key.pub.pem', 'utf8'), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(key));
fs.writeFileSync('config/gemini-key.enc', encrypted.toString('base64') + '\n');
console.log('Wrote config/gemini-key.enc');
