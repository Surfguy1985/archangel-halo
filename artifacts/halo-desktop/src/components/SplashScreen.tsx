import { useEffect, useRef, useState} from "react";

const SPLASH_URL =`${import.meta.env.BASE_URL}splash.mp4`;

export function SplashScreen() {
  const [phase, setPhase] = useState<"playing" | "fading" | "done">("playing");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const safety = setTimeout(() => setPhase((p) => (p === "playing" ? "fading" : p)), 9000);
    return () => clearTimeout(safety);
 }, []);

  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("done"), 500);
    return () => clearTimeout(t);
 }, [phase]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => setPhase("fading"));
 }, []);

  if (phase === "done") return null;

  return (
    <div
      onClick={() => setPhase("fading")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: phase === "fading" ? 0 : 1,
        transition: "opacity 0.5s ease",
        pointerEvents: phase === "fading" ? "none" : "auto",
        cursor: "pointer",
     }}
    >
      <video
        ref={videoRef}
        src={SPLASH_URL}
        muted
        playsInline
        autoPlay
        preload="auto"
        onEnded={() => setPhase("fading")}
        onError={() => setPhase("fading")}
        style={{ width: "100%", height: "100%", objectFit: "contain"}}
      />
    </div>
  );
}
