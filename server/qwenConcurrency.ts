// Shared across all Qwen searches and rule evaluations in this server process.
const MAX_ACTIVE = 3;
let active = 0;
const waiting: (() => void)[] = [];

export async function withQwenSlot<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (active >= MAX_ACTIVE) {
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => {
        const index = waiting.indexOf(ready);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal!.reason);
      };
      waiting.push(ready);
      signal?.addEventListener('abort', abort, { once: true });
    });
  } else active++;
  try {
    signal?.throwIfAborted();
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
