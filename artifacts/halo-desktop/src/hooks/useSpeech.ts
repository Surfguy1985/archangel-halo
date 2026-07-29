import { useCallback, useEffect, useRef, useState} from "react";

const PREFERRED_VOICES = [
  "Samantha",
  "Ava",
  "Allison",
  "Google US English",
  "Microsoft Aria",
  "Microsoft Jenny",
  "Microsoft Michelle",
  "Karen",
  "Serena",
  "Moira",
];

const isSupported =
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  typeof window.SpeechSynthesisUtterance !== "undefined";

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  // Increments on every speak/cancel so stale utterance callbacks (fired after an
  // interruption, pause, or close) are ignored instead of advancing the tour.
  const genRef = useRef(0);

  useEffect(() => {
    if (!isSupported) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length) voicesRef.current = v;
   };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
   };
 }, []);

  const pickVoice = useCallback((): SpeechSynthesisVoice | undefined => {
    const voices = voicesRef.current;
    if (!voices.length) return undefined;
    const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
    const pool = english.length ? english : voices;
    for (const name of PREFERRED_VOICES) {
      const match = pool.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));
      if (match) return match;
   }
    return pool.find((v) => v.lang.toLowerCase() === "en-us") || pool[0];
 }, []);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    // Invalidate any in-flight utterance so its onend/onerror can't fire callbacks.
    genRef.current += 1;
    try {
      window.speechSynthesis.cancel();
   } catch {
      /* no-op */
   }
    setSpeaking(false);
 }, []);

  // Unlock speech within a user gesture (required on some browsers).
  const prime = useCallback(() => {
    if (!isSupported) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.cancel();
   } catch {
      /* no-op */
   }
 }, []);

  const speak = useCallback(
    (text: string, opts?: { onEnd?: () => void; onError?: () => void}) => {
      if (!isSupported) {
        opts?.onEnd?.();
        return;
     }
      const synth = window.speechSynthesis;
      genRef.current += 1;
      const myGen = genRef.current;
      try {
        synth.cancel();
     } catch {
        /* no-op */
     }
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
     }
      utter.rate = 0.98;
      utter.pitch = 1;
      utter.volume = 1;
      utter.onstart = () => {
        if (myGen !== genRef.current) return;
        setSpeaking(true);
     };
      utter.onend = () => {
        if (myGen !== genRef.current) return;
        setSpeaking(false);
        opts?.onEnd?.();
     };
      utter.onerror = () => {
        if (myGen !== genRef.current) return;
        setSpeaking(false);
        opts?.onError?.();
     };
      try {
        synth.resume();
     } catch {
        /* no-op */
     }
      try {
        synth.speak(utter);
     } catch {
        if (myGen === genRef.current) {
          setSpeaking(false);
          opts?.onError?.();
       }
     }
   },
    [pickVoice],
  );

  return { supported: isSupported, speaking, speak, cancel, prime};
}
