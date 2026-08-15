import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PortfolioUnitPhoto, PortfolioUnitPhotoPair } from "@workspace/api-client-react";

export function UnitPhotoPairs(props: {
  units: PortfolioUnitPhotoPair[];
  selectedPropertyId: string | null;
  selectedPropertyName?: string | null;
  propertyOnly?: boolean;
}) {
  const siteUnits = props.selectedPropertyId
    ? props.units.filter((u) => u.propertyId === props.selectedPropertyId)
    : props.units;
  const [showAll, setShowAll] = useState(false);
  const visible = !props.propertyOnly && showAll ? props.units : siteUnits;
  const [open, setOpen] = useState<{ photo: PortfolioUnitPhoto; tag: string } | null>(null);

  useEffect(() => {
    setShowAll(false);
  }, [props.selectedPropertyId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (props.units.length === 0) {
    return (
      <p className="cb-empty">
        No Work App before/after photos for this portfolio yet. They land after Base44 sync.
      </p>
    );
  }

  if (visible.length === 0) {
    return (
      <div>
        <p className="cb-empty">
          No Work App photos for {props.selectedPropertyName ?? "this community"} yet.
        </p>
        {props.units.length > 0 && !props.propertyOnly ? (
          <button type="button" className="cb-overlay-cta" onClick={() => setShowAll(true)}>
            View all communities
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {!props.propertyOnly && siteUnits.length > 0 && showAll ? (
        <button type="button" className="cb-chip on" style={{ marginBottom: 10 }} onClick={() => setShowAll(false)}>
          This community
        </button>
      ) : null}
      <div className="cb-photo-list">
        {visible.map((unit) => (
          <article key={`${unit.propertyId ?? unit.propertyName}:${unit.unitNumber}`} className="cb-photo-unit">
            <header>
              <strong>
                {showAll || !props.selectedPropertyId ? `${unit.propertyName} · ` : ""}
                Unit {unit.unitNumber}
              </strong>
              <span>
                {unit.before.length} before · {unit.after.length} after
              </span>
            </header>
            <div className="cb-photo-pair">
              <PhotoStill
                tag="Before"
                photos={unit.before}
                empty="Waiting on before"
                onOpen={(photo) => setOpen({ photo, tag: "Before" })}
              />
              <PhotoStill
                tag="After"
                photos={unit.after}
                empty="Waiting on after"
                onOpen={(photo) => setOpen({ photo, tag: "After" })}
              />
            </div>
          </article>
        ))}
      </div>
      {open
        ? createPortal(
            <div className="cb-photo-lightbox" role="dialog" aria-modal="true" aria-label={`${open.tag} photo`}>
              <button type="button" className="cb-photo-lightbox-scrim" aria-label="Close" onClick={() => setOpen(null)} />
              <figure>
                <img src={open.photo.url} alt={open.photo.title ?? `${open.tag} photo`} />
                <figcaption>
                  <em>{open.tag}</em>
                  <span>{open.photo.title ?? stamp(open.photo.occurredAt)}</span>
                  <button type="button" onClick={() => setOpen(null)}>
                    Close
                  </button>
                </figcaption>
              </figure>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function PhotoStill(props: {
  tag: string;
  photos: PortfolioUnitPhoto[];
  empty: string;
  onOpen: (photo: PortfolioUnitPhoto) => void;
}) {
  const hero = props.photos[0];
  if (!hero) {
    return (
      <div className="cb-photo-still empty">
        <em>{props.tag}</em>
        <span>{props.empty}</span>
      </div>
    );
  }
  return (
    <button type="button" className="cb-photo-still" onClick={() => props.onOpen(hero)}>
      <img src={hero.url} alt={`${props.tag}${hero.title ? ` · ${hero.title}` : ""}`} />
      <em>{props.tag}</em>
      <span>{hero.title ?? stamp(hero.occurredAt)}</span>
      {props.photos.length > 1 ? <b>+{props.photos.length - 1}</b> : null}
    </button>
  );
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return "Work App";
  return iso.slice(0, 10);
}
