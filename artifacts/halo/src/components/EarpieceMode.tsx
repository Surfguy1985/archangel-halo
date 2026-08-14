/**
 * Earpiece Mode — live field loop.
 * Apple: getUserMedia + Web Audio session + speechSynthesis + Screen Wake Lock.
 * STT: Whisper via /api/field/transcribe (same model as Walk). Not an in-browser HF dump.
 * Honest limit: iOS kills the mic when the phone locks. Keep HALO on screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, X } from "lucide-react";

type IntentKind = "wake" | "next" | "go" | "skip" | "fix" | "tell" | "stop" | "command" | "noise";

type Presence = {
  match: boolean;
  spoken: string;
  prompt: string | null;
  nextLine: string | null;
  propertyName?: string | null;
};

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function pickMime(): string {
  const ios = isIOS();
  const types = ios
    ? ["audio/mp4", "audio/aac", "audio/webm"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return ios ? "audio/mp4" : "audio/webm";
}

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.04;
    u.pitch = 0.96;
    const voices = window.speechSynthesis.getVoices();
    const apple =
      voices.find((v) => /samantha|karen|moira|daniel|alex/i.test(v.name) && /en/i.test(v.lang)) ??
      voices.find((v) => /en[-_]US/i.test(v.lang)) ??
      voices[0];
    if (apple) u.voice = apple;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function EarpieceMode({
  open,
  onClose,
  onCommand,
}: {
  open: boolean;
  onClose: () => void;
  onCommand: (text: string) => void;
}) {
  const [phase, setPhase] = useState<"boot" | "listen" | "think" | "speak">("boot");
  const [line, setLine] = useState("Keep HALO on screen. AirPods stay live until you lock the phone.");
  const [heard, setHeard] = useState("");
  const running = useRef(false);
  const presence = useRef<Presence | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const loopGen = useRef(0);

  const shutdown = useCallback(() => {
    running.current = false;
    loopGen.current += 1;
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    void wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  }, []);

  const listenOnce = useCallback(async (stream: MediaStream): Promise<Blob | null> => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const rms = () => {
      analyser.getByteTimeDomainData(data);
      let s = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        s += x * x;
      }
      return Math.sqrt(s / data.length);
    };

    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const started = Date.now();
    let speaking = false;
    let lastVoice = Date.now();
    rec.start(isIOS() ? undefined : 120);

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (!running.current) { resolve(); return; }
        const level = rms();
        if (level > 0.045) {
          speaking = true;
          lastVoice = Date.now();
        }
        const elapsed = Date.now() - started;
        if (speaking && Date.now() - lastVoice > 900) { resolve(); return; }
        if (elapsed > 8000) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    try { source.disconnect(); } catch { /* */ }
    if (rec.state !== "inactive") rec.stop();
    await new Promise((r) => { rec.onstop = () => r(null); setTimeout(r, 400); });
    if (!speaking) return null;
    return new Blob(chunks, { type: mime });
  }, []);

  useEffect(() => {
    if (!open) {
      shutdown();
      return;
    }
    running.current = true;
    const gen = ++loopGen.current;
    let cancelled = false;

    const run = async () => {
      setPhase("boot");
      setLine("Warming the mic for AirPods…");
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wakeRef.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch { /* optional */ }

      try {
        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "HALO Earpiece",
            artist: "Archangel Operations",
          });
          navigator.mediaSession.playbackState = "playing";
        }
      } catch { /* */ }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (cancelled || gen !== loopGen.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.00008;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      let spokenOpen = "Earpiece on. Keep the screen awake.";
      try {
        const pos = await new Promise<GeolocationPosition | null>((resolve) => {
          if (!("geolocation" in navigator)) { resolve(null); return; }
          navigator.geolocation.getCurrentPosition((p) => resolve(p), () => resolve(null), { enableHighAccuracy: true, timeout: 6000 });
        });
        const q = pos ? `lat=${pos.coords.latitude}&lng=${pos.coords.longitude}` : "";
        const r = await fetch(`/api/field/presence${q ? `?${q}` : ""}`, { credentials: "include" });
        if (r.ok) {
          const p = (await r.json()) as Presence;
          presence.current = p;
          if (p.spoken) spokenOpen = p.spoken;
        }
      } catch { /* GPS optional */ }

      try {
        const hour = new Date().getHours();
        if (hour >= 5 && hour <= 11 && !sessionStorage.getItem("halo_watch_ear")) {
          const wr = await fetch("/api/field/watch", { credentials: "include" });
          if (wr.ok) {
            const w = (await wr.json()) as { spoken?: string | null; prompt?: string | null };
            if (w.spoken) {
              sessionStorage.setItem("halo_watch_ear", "1");
              spokenOpen = `${w.spoken} ${spokenOpen}`;
              if (w.prompt && !presence.current?.prompt) {
                presence.current = { match: true, spoken: w.spoken, prompt: w.prompt, nextLine: null };
              }
            }
          }
        }
      } catch { /* */ }

      if (!running.current || gen !== loopGen.current) return;
      setPhase("speak");
      setLine(spokenOpen);
      await speak(spokenOpen);

      while (running.current && gen === loopGen.current) {
        setPhase("listen");
        setLine("Listening… say go, next, skip, or just talk.");
        const clip = await listenOnce(stream);
        if (!running.current || gen !== loopGen.current) break;
        if (!clip || clip.size < 1200) continue;
        setPhase("think");
        setLine("Got it.");
        try {
          const audioBase64 = await blobToBase64(clip);
          const tr = await fetch("/api/field/transcribe", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64, mimeType: clip.type || pickMime() }),
          });
          if (!tr.ok) {
            setPhase("speak");
            await speak("Say again.");
            continue;
          }
          const j = (await tr.json()) as {
            transcript: string;
            intent: { kind: IntentKind; command: string | null };
            ack: string | null;
          };
          setHeard(j.transcript || "");
          const kind = j.intent?.kind ?? "noise";
          if (kind === "noise") continue;
          if (kind === "stop") {
            setPhase("speak");
            await speak(j.ack || "Earpiece off.");
            onClose();
            return;
          }
          if (kind === "skip" || kind === "wake") {
            setPhase("speak");
            setLine(j.ack || "Standing by.");
            await speak(j.ack || "Standing by.");
            continue;
          }
          const payload =
            kind === "go"
              ? (presence.current?.prompt || j.intent.command || j.transcript)
              : kind === "next"
                ? (presence.current?.nextLine ? `Next move: ${presence.current.nextLine}. ${presence.current.prompt ?? ""}` : (j.intent.command || "What's the next move on this site?"))
                : (j.intent.command || j.transcript);
          if (j.ack) {
            setPhase("speak");
            setLine(j.ack);
            await speak(j.ack);
          }
          if (payload) onCommand(payload);
        } catch {
          setPhase("speak");
          await speak("Say again.");
        }
      }
    };

    void run().catch(() => {
      setLine("Mic blocked. Allow microphone, keep HALO on screen, then retry.");
    });

    const onHide = () => {
      if (document.hidden) {
        shutdown();
        onClose();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHide);
      shutdown();
    };
  }, [open, listenOnce, onClose, onCommand, shutdown]);

  if (!open) return null;

  return (
    <div className="earpiece-hud" role="dialog" aria-label="HALO Earpiece">
      <button type="button" className="earpiece-end" aria-label="End earpiece" onClick={() => { shutdown(); onClose(); }}>
        <X size={18} />
      </button>
      <div className={`earpiece-orb ${phase}`} aria-hidden>
        <Headphones size={28} />
      </div>
      <p className="earpiece-kicker">{phase === "listen" ? "LIVE" : phase === "think" ? "HEARING" : "EARPIECE"}</p>
      <p className="earpiece-line">{line}</p>
      {heard && <p className="earpiece-heard">“{heard}”</p>}
      <p className="earpiece-hint">Go · Next · Skip · Fix this · Tell them · Stop</p>
    </div>
  );
}
