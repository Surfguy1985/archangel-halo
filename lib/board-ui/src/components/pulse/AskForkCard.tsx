import { sparkPoints, type AskFork } from "./askFork";
import type { GuideAction } from "./pulseGuideBrain";

export function AskForkCard(props: {
  fork: AskFork;
  act?: string | null;
  actStatus?: "propose" | "queued" | null;
  onSign?: () => void;
  onOpen?: (action: GuideAction) => void;
  onZoom?: (src: string, title: string) => void;
  onDismiss?: () => void;
}) {
  const { fork } = props;
  const queued = props.actStatus === "queued" || fork.queued;
  const spark = sparkPoints(fork.series);
  const proofSrc = fork.proof?.after || fork.proof?.src || fork.proof?.before;
  return (
    <article className="cb-ask-fork" aria-label={`${fork.site} ${fork.unit} morning fork`}>
      <header className="cb-ask-fork-head">
        <div className="cb-ask-fork-day" aria-label={`Day ${fork.daysNow} vacant`}>
          <strong>{fork.daysNow}</strong>
          <em>day</em>
        </div>
        <div className="cb-ask-fork-who">
          <p>This morning</p>
          <h3>
            {fork.site} · {fork.unit}
          </h3>
          <span>{fork.wait} · vacant clock running</span>
        </div>
        {spark ? (
          <svg className="cb-ask-fork-spark" viewBox="0 0 120 36" aria-hidden="true">
            <polyline points={spark} />
          </svg>
        ) : null}
      </header>
      <div className="cb-ask-fork-paths">
        <div className="cb-ask-fork-path" data-tone="act">
          <em>You sign</em>
          <strong>Day {fork.daysNow}</strong>
          <p>{fork.ifYouAct}</p>
        </div>
        <div className="cb-ask-fork-path" data-tone="wait">
          <em>You wait</em>
          <strong>Day {fork.daysIfWait}</strong>
          <p>{fork.ifYouWait}</p>
        </div>
      </div>
      {fork.proof ? (
        <button
          type="button"
          className="cb-ask-fork-proof"
          onClick={() => {
            if (proofSrc) props.onZoom?.(proofSrc, fork.proof?.title ?? fork.unit);
            props.onOpen?.({ type: "open", panel: "photos" });
          }}
        >
          <span className="cb-ask-pair">
            {fork.proof.before ? <img src={fork.proof.before} alt="" /> : <i>Before</i>}
            {fork.proof.after ? <img src={fork.proof.after} alt="" /> : fork.proof.src ? <img src={fork.proof.src} alt="" /> : <i>After</i>}
          </span>
          <span>
            <strong>{fork.proof.title}</strong>
            <em>Proof already on this board</em>
          </span>
        </button>
      ) : null}
      {props.onSign ? (
        <div className="cb-ask-fork-cta">
          <button type="button" className="cb-ask-fork-go" data-queued={queued ? "true" : "false"} onClick={props.onSign}>
            {queued ? "Still queued — waiting on you" : "Queue the reminder — I’ll wait"}
          </button>
          {queued && props.onDismiss ? (
            <button type="button" className="cb-ask-fork-dismiss" onClick={props.onDismiss}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
