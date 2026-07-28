import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPayHubOverview,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCcw,
  XCircle,
  Landmark,
} from "lucide-react";
import { InboundTab } from "./Payments/InboundTab";
import { OutboundTab } from "./Payments/OutboundTab";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function StatsRow() {
  const { data: stats, isLoading } = useGetPayHubOverview();
  
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-white rounded-2xl border-none shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <RefreshCcw className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-semibold uppercase tracking-wider">Outstanding</span>
          </div>
          <div className="text-2xl font-display font-bold text-[var(--ink)]">
            {money(stats?.outstandingTotal ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {stats?.outstandingCount} request{stats?.outstandingCount !== 1 ? "s" : ""} pending
          </div>
        </CardContent>
      </Card>
      
      <Card className="bg-white rounded-2xl border-none shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-semibold uppercase tracking-wider">Received MTD</span>
          </div>
          <div className="text-2xl font-display font-bold text-[var(--ink)]">
            {money(stats?.receivedMtd ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white rounded-2xl border-none shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ArrowUpRight className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-semibold uppercase tracking-wider">Paid Out MTD</span>
          </div>
          <div className="text-2xl font-display font-bold text-[var(--ink)]">
            {money(stats?.payoutsMtd ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[var(--gold-dark)] text-white rounded-2xl border-none shadow-sm overflow-hidden">
        <CardContent className="p-5 flex flex-col justify-center h-full">
          <div className="flex items-center gap-2 mb-1 opacity-80">
            <Landmark className="w-4 h-4 text-[var(--gold-light)]" />
            <span className="text-xs font-semibold uppercase tracking-wider">Verified Crew Banks</span>
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
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Payments Hub</h1>
          <p className="text-muted-foreground">Request, receive, and route money instantly.</p>
        </div>
      </header>

      <StatsRow />

      <Tabs defaultValue="inbound" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-sm rounded-xl p-1 bg-white border shadow-sm">
          <TabsTrigger value="inbound" className="rounded-lg text-sm">Requests & Receiving</TabsTrigger>
          <TabsTrigger value="outbound" className="rounded-lg text-sm">Crew Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="inbound" className="mt-6 space-y-4">
          <InboundTab />
        </TabsContent>
        <TabsContent value="outbound" className="mt-6 space-y-4">
          <OutboundTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
