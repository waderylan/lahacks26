import { useEffect, useRef, useState } from 'react';

/**
 * Speech-to-text for the chat, using the browser's built-in recognition (no API key; in Chrome the
 * audio is processed by Google's speech service). Shows words as they are heard and calls onFinal
 * once the speaker pauses. Unsupported browsers get `supported: false` and no mic button.
 */
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const Recognizer = (): (new () => Recognition) | undefined =>
  typeof window === 'undefined' ? undefined : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser’s address bar, then try again.',
  'service-not-allowed': 'Speech input isn’t available in this browser.',
  'no-speech': 'Didn’t hear anything. Click the mic and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech input needs an internet connection.',
};

export function useVoice(onText: (text: string) => void, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onFinal });
  handlers.current = { onText, onFinal };
  const supported = Boolean(Recognizer());

  useEffect(() => () => rec.current?.abort(), []);

  const start = () => {
    const SR = Recognizer();
    if (!SR || listening) return;
    const r = new SR();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false; // stops on its own after a pause
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += piece; else interim += piece;
      }
      handlers.current.onText((finalText + interim).trim());
    };
    r.onerror = e => { if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `Speech input failed (${e.error}).`); };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (finalText.trim()) handlers.current.onFinal(finalText.trim());
    };
    setError('');
    rec.current = r;
    setListening(true);
    try { r.start(); } catch (e) { setListening(false); setError((e as Error).message); }
  };
  const stop = () => rec.current?.stop();
  return { supported, listening, error, start, stop, clearError: () => setError('') };
}
