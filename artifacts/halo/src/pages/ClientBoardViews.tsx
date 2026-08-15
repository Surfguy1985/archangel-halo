import { ClientBoardViewPicker, CAF_REGIONAL_TOKEN, CAF_PALOMA_TOKEN } from "@workspace/board-ui";

export default function ClientBoardViewsPage() {
  return (
    <ClientBoardViewPicker
      onRegional={() => {
        window.location.assign(`/board/${CAF_REGIONAL_TOKEN}`);
      }}
      onProperty={() => {
        window.location.assign(`/board/${CAF_PALOMA_TOKEN}`);
      }}
    />
  );
}
