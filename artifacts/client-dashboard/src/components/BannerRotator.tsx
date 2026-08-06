import { useEffect, useRef, useState } from "react";
import { FeaturedWalkCard } from "./FeaturedWalkCard";
import { FeaturedPlatformCard } from "./FeaturedPlatformCard";

/**
 * Rotates between the HALO Walk banner and the Platform training banner.
 *
 * Auto-advances every INTERVAL_MS; user can also jump with the dot indicators.
 * Animation is a smooth cross-fade so the layout never jumps (both banners
 * share the same height via absolute positioning and opacity).
 */

const INTERVAL_MS = 8_000;

interface BannerRotatorProps {
  onStartTraining: () => void;
}

export function BannerRotator({ onStartTraining }: BannerRotatorProps) {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(true); // fade gate
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const banners = [
    { key: "walk", label: "HALO Walk" },
    { key: "platform", label: "Platform training" },
  ];

  const goTo = (idx: number) => {
    if (idx === active) return;
    // Fade out → swap → fade in
    setVisible(false);
    setTimeout(() => {
      setActive(idx);
      setVisible(true);
    }, 280);
  };

  const advance = () => {
    setVisible(false);
    setTimeout(() => {
      setActive((prev) => (prev + 1) % banners.length);
      setVisible(true);
    }, 280);
  };

  // Auto-rotate
  useEffect(() => {
    timerRef.current = setInterval(advance, INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset timer on manual navigation
  const handleDot = (idx: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    goTo(idx);
    timerRef.current = setInterval(advance, INTERVAL_MS);
  };

  return (
    <div className="relative">
      {/* Banner — fades between cards */}
      <div
        className="transition-opacity duration-[280ms]"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {active === 0 ? (
          <FeaturedWalkCard />
        ) : (
          <FeaturedPlatformCard onStartTraining={onStartTraining} />
        )}
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center items-center gap-2 pt-2 pb-1">
        {banners.map((b, i) => (
          <button
            key={b.key}
            aria-label={`Show ${b.label} banner`}
            onClick={() => handleDot(i)}
            className="transition-all duration-200 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4FF44]"
            style={{
              width: i === active ? 20 : 6,
              height: 6,
              background: i === active ? "#101C33" : "#D1D1D6",
            }}
          />
        ))}
      </div>
    </div>
  );
}
