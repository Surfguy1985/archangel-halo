import { useLocation, useParams } from "wouter";
import { ClientTokenPulse } from "@workspace/board-ui";

export default function ClientPortfolioPulsePage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();

  return (
    <ClientTokenPulse
      token={token || ""}
      onNavigate={(path) => setLocation(path)}
      homeHref={{ label: "Views", onClick: () => setLocation("/") }}
    />
  );
}
