import { useLocation, useParams } from "wouter";
import {
  useGetClientBidComparison,
  awardClientBidRequest,
  inviteClientBidVendors,
  submitClientVendorBid,
  getGetClientBidComparisonQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BidBoard, idempotencyHeaders } from "@workspace/board-ui";
import { useSessionExchange } from "@/hooks/useSessionExchange";

export default function ClientBidBoardPage() {
  const { token, id } = useParams<{ token: string; id: string }>();
  const [, setLocation] = useLocation();
  useSessionExchange(token);
  const queryClient = useQueryClient();
  const doc = useGetClientBidComparison(token || "pending", id || "pending", {
    query: {
      enabled: Boolean(token && id),
      queryKey: getGetClientBidComparisonQueryKey(token || "pending", id || "pending"),
    },
  });

  const refetch = () => {
    if (!token || !id) return;
    void queryClient.invalidateQueries({ queryKey: getGetClientBidComparisonQueryKey(token, id) });
  };

  return (
    <BidBoard
      doc={doc.data}
      loading={doc.isLoading}
      errorMessage={(doc.error as { error?: string } | undefined)?.error}
      onAward={async (vendorOrgId) => {
        if (!token || !id) return;
        await awardClientBidRequest(token, id, { vendorOrgId }, { headers: idempotencyHeaders() });
        refetch();
      }}
      onInvite={async (vendorOrgIds) => {
        if (!token || !id) return;
        await inviteClientBidVendors(token, id, { vendorOrgIds }, { headers: idempotencyHeaders() });
        refetch();
      }}
      onSubmitBid={async (input) => {
        if (!token || !id) return;
        await submitClientVendorBid(
          token,
          id,
          {
            vendorOrgId: input.vendorOrgId,
            earliestStartAt: input.earliestStartAt,
            promisedDays: input.promisedDays,
            lines: input.lines,
          },
          { headers: idempotencyHeaders() },
        );
        refetch();
      }}
      homeHref={{
        label: "Turn board",
        onClick: () =>
          setLocation(doc.data?.propertyId ? `/${token}/property/${doc.data.propertyId}` : `/${token}`),
      }}
    />
  );
}
