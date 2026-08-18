import { HALO_STORY, HALO_STORY_ORDER, type HaloStoryLevel } from "./haloLevels";
import corporatePortrait from "../../assets/desk-corporate.png";
import managerPortrait from "../../assets/desk-manager.png";
import vendorPortrait from "../../assets/desk-vendor.png";
import "./haloLevels.css";

const PORTRAIT: Record<HaloStoryLevel, string> = {
  portfolio: corporatePortrait,
  pulse: managerPortrait,
  punchlist: vendorPortrait,
};

export function HaloLevelBar(props: {
  active: HaloStoryLevel;
  hrefs?: Partial<Record<HaloStoryLevel, string>>;
  locked?: boolean;
  onGo: (href: string, level: HaloStoryLevel) => void;
}) {
  return (
    <div className="halo-levels" role="tablist" aria-label="HALO desks">
      {HALO_STORY_ORDER.map((id) => {
        const desk = HALO_STORY[id];
        const href = props.hrefs?.[id] ?? (id === "portfolio" ? "/" : id === "punchlist" ? "/punchlist" : "/pulse");
        const on = props.active === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            data-on={on ? "true" : "false"}
            className="halo-level"
            disabled={props.locked}
            onClick={() => {
              if (props.locked) return;
              props.onGo(href, id);
            }}
          >
            <span className="halo-level-thumb" data-tone={desk.tone} aria-hidden>
              <img src={PORTRAIT[id]} alt="" />
            </span>
            <span className="halo-level-copy">
              <p>{desk.kicker}</p>
              <strong>{desk.person}</strong>
              <em>
                {desk.title} · {desk.line}
              </em>
            </span>
          </button>
        );
      })}
    </div>
  );
}
