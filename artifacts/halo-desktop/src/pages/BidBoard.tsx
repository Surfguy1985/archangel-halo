import { useLocation, useParams } from "wouter";
import {
  useGetBidComparison,
  awardBidRequest,
  inviteBidVendors,
  submitVendorBid,
  getGetBidComparisonQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BidBoard, idempotencyHeaders } from "@workspace/board-ui";

export default function BidBoardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const doc = useGetBidComparison(id || "pending", {
    query: { enabled: Boolean(id), queryKey: getGetBidComparisonQueryKey(id || "pending") },
  });

  const refetch = () => {
    if (!id) return;
    void queryClient.invalidateQueries({ queryKey: getGetBidComparisonQueryKey(id) });
  };

  return (
    <BidBoard
      doc={doc.data}
      loading={doc.isLoading}
      errorMessage={(doc.error as { error?: string } | undefined)?.error}
      onAward={async (vendorOrgId) => {
        await awardBidRequest(id, { vendorOrgId }, { headers: idempotencyHeaders() });
        refetch();
      }}
      onInvite={async (vendorOrgIds) => {
        await inviteBidVendors(id, { vendorOrgIds }, { headers: idempotencyHeaders() });
        refetch();
      }}
      onSubmitBid={async (input) => {
        await submitVendorBid(
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
        onClick: () => navigate(doc.data?.propertyId ? `/properties/${doc.data.propertyId}/turns` : "/portfolio"),
      }}
    />
  );
}
