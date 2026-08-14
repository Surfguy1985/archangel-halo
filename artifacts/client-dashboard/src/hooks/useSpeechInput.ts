/**
 * useSpeechInput — Web Speech API hook for Halo One voice input.
 * Uses window.SpeechRecognition / window.webkitSpeechRecognition.
 * Calls onResult with the final transcript; onError with a short message.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Browser Speech Recognition type (not always present in TS lib)
type SR = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((ev: { results: { length: number; [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type UseSpeechInputOptions = {
  onResult: (transcript: string) => void;
  onError?: (msg: string) => void;
};

function getSRConstructor(): (new () => SR) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput({ onResult, onError }: UseSpeechInputOptions) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);
  const supported = !!getSRConstructor();

  const start = useCallback(() => {
    const SRCtor = getSRConstructor();
    if (!SRCtor || listening) return;

    const rec = new SRCtor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;

    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);

    rec.onresult = (ev) => {
      const len = ev.results.length;
      const transcript = ev.results[len - 1]?.[0]?.transcript ?? '';
      if (transcript.trim()) onResult(transcript.trim());
    };

    rec.onerror = (ev) => {
      setListening(false);
      let msg = 'Microphone unavailable';
      if (ev.error === 'not-allowed') msg = 'Microphone access denied';
      else if (ev.error === 'no-speech') msg = 'No speech detected — try again';
      else if (ev.error === 'network') msg = 'Network error with speech recognition';
      onError?.(msg);
    };

    recRef.current = rec;
    rec.start();
  }, [listening, onResult, onError]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => () => { recRef.current?.abort(); }, []);

  return { listening, start, stop, supported };
}
