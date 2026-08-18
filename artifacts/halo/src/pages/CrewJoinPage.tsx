import { useLocation } from "wouter";
import { HaloCrewJoinPage } from "@workspace/board-ui";

export default function CrewJoinPage({ token }: { token: string }) {
  const [, navigate] = useLocation();
  return (
    <HaloCrewJoinPage
      token={token}
      onJoined={(paycardToken) => navigate(`/checkin/${paycardToken}`, { replace: true })}
    />
  );
}
