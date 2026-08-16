import type { AskSheet, AskSheetChip, SheetTone } from "./askSheet";
import type { GuideAction } from "./pulseGuideBrain";

export function AskSheetView(props: {
  sheet: AskSheet;
  onAction: (action: GuideAction) => void;
}) {
  const { sheet } = props;
  return (
    <div className="cb-sheet">
      <p className="cb-sheet-kicker">{sheet.kicker}</p>
      <h2 className="cb-sheet-headline">
        <span>{sheet.headline}</span>
      </h2>
      {sheet.place ? (
        <p className="cb-sheet-place">
          <span data-tone="place">{sheet.place}</span>
        </p>
      ) : null}
      {sheet.lanes.length > 0 ? (
        <div className="cb-sheet-board" aria-label="Mini work board">
          {sheet.lanes.map((lane) => (
            <div key={lane.id} className="cb-sheet-lane" data-tone={lane.tone}>
              <h3>
                <span>{lane.title}</span>
              </h3>
              <ol>
                {lane.chips.map((chip) => (
                  <li key={chip.id}>
                    <SheetChip chip={chip} onAction={props.onAction} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <button type="button" className="cb-sheet-open-board" onClick={() => props.onAction({ type: "kanban" })}>
            Open the big board
          </button>
        </div>
      ) : null}
      {sheet.sections.map((section) => (
        <section key={section.id} className="cb-sheet-sec" data-tone={section.tone}>
          <h3>
            <span>{section.title}</span>
          </h3>
          <ul>
            {section.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SheetChip(props: { chip: AskSheetChip; onAction: (action: GuideAction) => void }) {
  const { chip } = props;
  return (
    <button type="button" className="cb-sheet-chip" data-tone={chip.tone as SheetTone} onClick={() => props.onAction(chip.action)}>
      <strong>{chip.label}</strong>
      <em>{chip.hint}</em>
    </button>
  );
}
