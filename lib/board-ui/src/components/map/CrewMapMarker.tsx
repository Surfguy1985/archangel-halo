/**
 * The crew marker every HALO map uses.
 *
 * Callers pass a normalized `CrewPin` (see crewPin.ts) plus whatever extra
 * popup content that surface needs — a live-tracker link on the client map, a
 * "text a check-in link" action in the office. The pin itself always says the
 * same four things, so a crew looks the same to the office and to the client.
 */

import type { ReactNode } from "react";
import { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import {
  crewPinIcon,
  crewPinPlaceLine,
  crewPinStatusLine,
  type CrewPin,
} from "./crewPin";

export function CrewPinPopupBody({
  pin,
  children,
}: {
  pin: CrewPin;
  children?: ReactNode;
}) {
  return (
    <div className={`halo-crewpin-pop${pin.status === "site" ? " is-site" : ""}`}>
      <span className="halo-crewpin-pop-name">{pin.name}</span>
      {pin.contractor ? <span className="halo-crewpin-badge">{pin.contractor}</span> : null}
      <span className="halo-crewpin-service">{pin.service || "No service listed"}</span>
      <span className="halo-crewpin-place">{crewPinPlaceLine(pin)}</span>
      <span className="halo-crewpin-status">{crewPinStatusLine(pin)}</span>
      {children ? <div className="halo-crewpin-extra">{children}</div> : null}
    </div>
  );
}

export type CrewMapMarkerProps = {
  pin: CrewPin;
  selected?: boolean;
  onSelect?: (pin: CrewPin) => void;
  /** Off for surfaces that open their own detail sheet on click. */
  popup?: boolean;
  /** Extra popup content for this surface. */
  children?: ReactNode;
};

export function CrewMapMarker({
  pin,
  selected,
  onSelect,
  popup = true,
  children,
}: CrewMapMarkerProps) {
  const icon = useMemo(
    () => crewPinIcon(pin, { selected }),
    // The icon is an HTML string, so it only has to be rebuilt when something
    // it renders changes — not on every parent render.
    [
      pin.name,
      pin.unitNo,
      pin.status,
      pin.selfieUrl,
      pin.mock,
      selected,
    ],
  );
  return (
    <Marker
      position={[pin.lat, pin.lng]}
      icon={icon}
      eventHandlers={onSelect ? { click: () => onSelect(pin) } : undefined}
    >
      {popup ? (
        <Popup>
          <CrewPinPopupBody pin={pin}>{children}</CrewPinPopupBody>
        </Popup>
      ) : null}
    </Marker>
  );
}
