import crypto from 'node:crypto';

/**
 * Hosted demo only: a teammate commits config/gemini-key.enc (encrypted to config/gemini-key.pub.pem with
 * scripts/encrypt_gemini_key.mjs). The API reads it from main and decrypts it with GEMINI_KEY_PRIVATE, a Vercel
 * env var, so the plaintext key is never in git or the Pages build. Checked at most once a minute until found.
 */
const URL = process.env.GEMINI_KEY_URL || 'https://raw.githubusercontent.com/waderylan/lahacks26/main/config/gemini-key.enc';
let checkedAt = 0;

export async function loadSharedGeminiKey() {
  const privateKey = process.env.GEMINI_KEY_PRIVATE;
  if (process.env.GEMINI_API_KEY || !privateKey || Date.now() - checkedAt < 60_000) return;
  checkedAt = Date.now();
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!response.ok) return;
    const key = crypto.privateDecrypt({ key: Buffer.from(privateKey, 'base64').toString('utf8'), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from((await response.text()).trim(), 'base64')).toString('utf8').trim();
    if (key) process.env.GEMINI_API_KEY = key;
  } catch (error) { console.error('Shared Gemini key:', (error as Error).message); }
}
