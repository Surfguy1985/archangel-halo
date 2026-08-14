import { useState, useRef} from "react";
import { useLocation} from "wouter";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetPayHubOverview,
} from "@workspace/api-client-react";
import { Card, CardContent} from "@/components/ui/card";
import { Skeleton} from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCcw,
  XCircle,
  Landmark,
} from "lucide-react";
import { InboundTab} from "./Payments/InboundTab";
import { OutboundTab} from "./Payments/OutboundTab";
import { CrewAPTab } from "./Payments/CrewAPTab";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2});

function StatsRow() {
  const { data: stats, isLoading} = useGetPayHubOverview();
  
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4}).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-none bg-muted" />
        ))}
      </div>
    );
 }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-white rounded-none border border-border shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <RefreshCcw className="w-4 h-4 text-[var(--secondary)]" />
            <span className="text-xs font-semibold text-[var(--secondary)]">Outstanding</span>
          </div>
          <div className="text-2xl font-display font-bold text-[var(--secondary)]">
            {money(stats?.outstandingTotal ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {stats?.outstandingCount} request{stats?.outstandingCount !== 1 ? "s" : ""} pending
          </div>
        </CardContent>
      </Card>
      
      <Card className="bg-white rounded-none border border-border shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-semibold text-[var(--secondary)]">Received MTD</span>
          </div>
          <div className="text-2xl font-display font-bold text-[var(--secondary)]">
            {money(stats?.receivedMtd ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white rounded-none border border-border shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ArrowUpRight className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-semibold text-[var(--secondary)]">Paid Out MTD</span>
          </div>
          <div className="text-2xl font-display font-bold text-[var(--secondary)]">
            {money(stats?.payoutsMtd ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[var(--secondary)] text-white rounded-none border-none shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 mb-1 opacity-80">
            <Landmark className="w-4 h-4 text-[var(--primary)]" />
            <span className="text-xs font-semibold text-[var(--primary)]">Verified Crew Banks</span>
          </div>
          <div className="text-2xl font-display font-bold">
            {stats?.verifiedCrewCount ?? 0}
          </div>
          {!!stats?.returnedCount && stats.returnedCount > 0 && (
            <div className="text-xs text-red-400 mt-1 flex items-center gap-1 font-medium">
              <XCircle className="w-3 h-3" /> {stats.returnedCount} returned payment{stats.returnedCount !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Payments() {
  const [, setLocation] = useLocation();

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 min-h-[100dvh] bg-[var(--background)]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--secondary)]">Payments Hub</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">Request, receive, and route money instantly.</p>
          <p className="text-[11px] text-muted-foreground mt-2 max-w-xl">
            Card and ACH charges post to the HALO ledger today. Bank instant-verify and Cybrid ACH rails are not live yet — recorded payouts still settle the books.
          </p>
        </div>
      </header>

      <StatsRow />

      <Tabs defaultValue="inbound" className="w-full">
        <TabsList className="flex gap-2 p-1 bg-white border border-border shadow-sm rounded-none max-w-fit">
          <TabsTrigger value="inbound" className="rounded-none font-bold text-xs px-6 py-2 data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white">Requests & Receiving</TabsTrigger>
          <TabsTrigger value="outbound" className="rounded-none font-bold text-xs px-6 py-2 data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white">Crew Payouts</TabsTrigger>
          <TabsTrigger value="crew-ap" className="rounded-none font-bold text-xs px-6 py-2 data-[state=active]:bg-[var(--secondary)] data-[state=active]:text-white" data-testid="tab-crew-ap">Crew A/P</TabsTrigger>
        </TabsList>
        <TabsContent value="inbound" className="mt-6 space-y-4">
          <InboundTab />
        </TabsContent>
        <TabsContent value="outbound" className="mt-6 space-y-4">
          <OutboundTab />
        </TabsContent>
        <TabsContent value="crew-ap" className="mt-6 space-y-4">
          <CrewAPTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
