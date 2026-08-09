/**
 * WorkEmbed — embeds the connected Base44 work-management app in a full-height
 * iframe so it lives natively inside the Work hub without a separate browser tab.
 */
export default function WorkEmbed() {
  return (
    <div className="h-full w-full" style={{ height: "calc(100vh - 132px)" }}>
      <iframe
        src="https://wakeful-ready-track-flow.base44.app"
        title="Work — connected app"
        className="w-full h-full border-0"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
