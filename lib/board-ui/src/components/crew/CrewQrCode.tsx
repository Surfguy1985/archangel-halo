/**
 * Scannable QR for any crew link (portal, paycard check-in, foreman join).
 *
 * Rendered as SVG so it stays crisp when a paycard is printed, and drawn on a
 * white plate with a quiet margin — a QR printed edge-to-edge on a dark card
 * will not scan.
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export type CrewQrCodeProps = {
  /** Absolute URL to encode — build it with the crew link helpers. */
  url: string;
  /** Rendered edge length in px (default 168). */
  size?: number;
  /** Foreground module color (default HALO navy). */
  dark?: string;
  className?: string;
  /** Screen-reader label; the QR itself is decorative. */
  label?: string;
};

export function CrewQrCode({
  url,
  size = 168,
  dark = "#0F1B2D",
  className,
  label,
}: CrewQrCodeProps) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (!url) {
      setSvg("");
      return;
    }
    QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: size,
      // Medium recovery keeps a printed card scannable through smudges and
      // creases without bloating the module count.
      errorCorrectionLevel: "M",
      color: { dark, light: "#ffffff" },
    })
      .then((out) => {
        if (alive) setSvg(out);
      })
      .catch(() => {
        if (alive) {
          setSvg("");
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [url, size, dark]);

  if (failed) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          display: "grid",
          placeItems: "center",
          borderRadius: 12,
          background: "#fff",
          color: "#0F1B2D",
          fontSize: 11,
          textAlign: "center",
          padding: 8,
        }}
      >
        Couldn't draw the QR — use the link instead.
      </div>
    );
  }

  return (
    <div
      className={className}
      role="img"
      aria-label={label ?? "QR code"}
      style={{
        width: size,
        height: size,
        background: "#fff",
        borderRadius: 12,
        padding: 8,
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
      }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
