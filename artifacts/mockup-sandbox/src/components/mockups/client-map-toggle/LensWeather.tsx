/** Can my outdoor crews work today — weather overlay + schedule moves. */
import { MapLenses } from "./MapLenses";

export function LensWeather() {
  return <MapLenses initial="weather" />;
}
