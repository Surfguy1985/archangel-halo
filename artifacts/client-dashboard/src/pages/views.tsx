import { useLocation } from "wouter";
import { ClientBoardViewPicker, CAF_REGIONAL_TOKEN, CAF_PALOMA_TOKEN } from "@workspace/board-ui";

export default function ClientBoardViewsPage() {
  const [, setLocation] = useLocation();
  return (
    <ClientBoardViewPicker
      onRegional={() => setLocation(`/${CAF_REGIONAL_TOKEN}`)}
      onProperty={() => setLocation(`/${CAF_PALOMA_TOKEN}`)}
    />
  );
}
