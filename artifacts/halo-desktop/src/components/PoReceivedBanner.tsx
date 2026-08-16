/**
 * PoReceivedBanner — the flashing purple "PO received by property" banner.
 *
 * Shared across the desktop job board. Shows across a job's whole section when
 * the property has sent over a PO (job.poReceivedAt set) that the office has
 * not yet acknowledged (job.poAcknowledgedAt null). Provides an Acknowledge
 * button that persists server-side and clears the banner everywhere.
 *
 * A one-time chime plays when a NEW unacknowledged PO first appears — see
 * usePoReceivedChime, which tracks already-seen PO job ids in localStorage and
 * falls back silently if audio can't play.
 */

import { useEffect, useRef } from "react";
import { useAcknowledgePoReceived, getListJobBoardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import "./PoReceivedBanner.css";

export const PO_BANNER_TEXT =
  "PO RECEIVED BY PROPERTY! COMPLETE FINAL WALKTHROUGH AND SEND INVOICES ASAP TO PROPERTY!";

/** A job carries an unacknowledged received PO when it has a receipt stamp and no ack stamp. */
export function hasUnacknowledgedPo(job: {
  poReceivedAt?: string | null;
  poAcknowledgedAt?: string | null;
}): boolean {
  return Boolean(job.poReceivedAt) && !job.poAcknowledgedAt;
}

const SEEN_KEY = "halo.poReceived.seen";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore — private mode / quota
  }
}

/** Play a short WebAudio chime. Never throws; resolves whether or not it played. */
function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = [880, 1174.66]; // A5 → D6, a gentle two-note alert
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
    // Close the context shortly after playback to free resources.
    window.setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    // Autoplay blocked or WebAudio unavailable — fall back silently.
  }
}

/**
 * Chime once for any newly-appearing unacknowledged PO. Pass the ids of jobs
 * that currently have an unacknowledged PO. Any id not previously seen triggers
 * a single chime; acknowledged/cleared ids are pruned so a future PO on the
 * same job chimes again.
 */
export function usePoReceivedChime(activePoJobIds: string[]): void {
  // Stable string so the effect only fires when the actual set changes.
  const key = [...activePoJobIds].sort().join(",");
  useEffect(() => {
    const active = new Set(activePoJobIds);
    const seen = readSeen();
    const fresh = [...active].filter((id) => !seen.has(id));
    // Prune ids that are no longer active so re-receipts chime again later.
    const next = new Set([...seen].filter((id) => active.has(id)));
    active.forEach((id) => next.add(id));
    if (fresh.length > 0) playChime();
    writeSeen(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function PoReceivedBanner({
  jobId,
  poReceivedAt,
  poNumber,
}: {
  jobId: string;
  /** The receipt the client is looking at — sent so a stale ack can't dismiss a newer PO. */
  poReceivedAt?: string | null;
  poNumber?: string | null;
}) {
  const qc = useQueryClient();
  const ack = useAcknowledgePoReceived();
  // Prevent the parent click (opening the job) from firing when acknowledging.
  const busy = useRef(false);

  return (
    <div
      className="po-received-banner"
      role="alert"
      data-testid={`po-received-banner-${jobId}`}
    >
      <span className="po-received-banner__text">{PO_BANNER_TEXT}</span>
      <button
        type="button"
        className="po-received-banner__ack"
        disabled={ack.isPending}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (busy.current) return;
          busy.current = true;
          ack.mutate(
            { jobId, data: { poReceivedAt: poReceivedAt ?? null, poNumber: poNumber ?? null } },
            {
              onSettled: () => {
                busy.current = false;
                qc.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
              },
            },
          );
        }}
        data-testid={`po-received-ack-${jobId}`}
      >
        {ack.isPending ? "…" : "Got it"}
      </button>
    </div>
  );
}
