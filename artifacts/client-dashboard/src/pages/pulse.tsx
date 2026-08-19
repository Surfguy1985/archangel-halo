import { useLocation, useParams } from "wouter";
import { ClientTokenPulse } from "@workspace/board-ui";
import { PulseLogin, pulseErrorBody, pulseErrorStatus } from "@/components/PulseLogin";
import { useGetClientPortfolioPulse, getGetClientPortfolioPulseQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function ClientPortfolioPulsePage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const pulse = useGetClientPortfolioPulse(token || "pending", undefined, {
    query: {
      enabled: Boolean(token),
      queryKey: getGetClientPortfolioPulseQueryKey(token || "pending"),
    },
  });

  if (pulse.isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafafa] text-[#6e6e73]">
        <p className="text-[13px] font-semibold uppercase tracking-wide">Loading Pulse</p>
      </div>
    );
  }

  if (pulseErrorStatus(pulse.error) === 401 || pulseErrorBody(pulse.error).needsLogin) {
    return (
      <PulseLogin
        token={token || ""}
        propertyName={pulseErrorBody(pulse.error).propertyName}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getGetClientPortfolioPulseQueryKey(token || "pending") });
        }}
      />
    );
  }

  return (
    <ClientTokenPulse
      token={token || ""}
      onNavigate={(path) => setLocation(path)}
      homeHref={{ label: "Views", onClick: () => setLocation("/") }}
    />
  );
}
