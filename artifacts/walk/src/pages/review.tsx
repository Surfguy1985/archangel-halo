import React from 'react';
import { useRoute, useLocation } from 'wouter';
import { useGetWalk, useCompleteWalk, useApproveWalk, useGetProperty, WalkCapture, getGetWalkQueryKey, getGetPropertyQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, CheckCircle2, Building2, MapPin, Receipt, Check, Send } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

export default function ReviewScreen() {
  const [, params] = useRoute('/walk/:id/review');
  const [, setLocation] = useLocation();
  const walkId = params?.id || '';
  const { toast } = useToast();

  const { data, isLoading } = useGetWalk(walkId, {
    request: { credentials: 'include' },
    query: { enabled: !!walkId, queryKey: getGetWalkQueryKey(walkId) }
  });

  const completeWalk = useCompleteWalk({
    request: { credentials: 'include' }
  });
  const approveWalk = useApproveWalk({
    request: { credentials: 'include' }
  });

  // Price book — mirrors the server's pricing rule: the book rate wins,
  // the captured unitPrice only covers custom ("Other") services.
  const propertyId = data?.walk?.propertyId;
  const { data: property } = useGetProperty(propertyId || '', {
    request: { credentials: 'include' },
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId || '') }
  });
  const bookRate = new Map<string, number>();
  for (const p of property?.priceItems || []) {
    const key = p.service.trim().toLowerCase();
    if (!bookRate.has(key) && p.rate != null) bookRate.set(key, p.rate);
  }

  const isCompleted = data?.walk?.status === 'completed';

  const handleComplete = () => {
    completeWalk.mutate(
      { id: walkId },
      {
        onSuccess: () => {
          toast({ 
            title: (
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-3 h-3 text-primary-foreground stroke-[3]" />
                </div>
                <span>Walk submitted</span>
              </div>
            ) as any
          });
        },
        onError: (err: any) => {
          toast({
            title: 'Failed to complete',
            description: err?.data?.error || err?.message || 'Please try again.',
            variant: 'destructive',
          });
        }
      }
    );
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-background"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;
  }

  if (!data?.walk) {
    return <div className="p-8 text-center text-muted-foreground font-bold">Walk not found</div>;
  }

  const { walk, captures = [], createdJobs = [] } = data;

  // Group captures by unit for review summary
  const summaryByUnit = captures.reduce((acc: Record<string, { count: number, total: number }>, cap) => {
    const u = cap.unitNo || 'Unassigned';
    if (!acc[u]) acc[u] = { count: 0, total: 0 };
    acc[u].count += 1;
    const rate = bookRate.get((cap.service || '').trim().toLowerCase()) ?? cap.unitPrice ?? 0;
    acc[u].total += rate * (cap.qty || 1);
    return acc;
  }, {});

  const totalPhotos = captures.length;
  const totalValue = Object.values(summaryByUnit).reduce((sum, u) => sum + u.total, 0);

  // If already completed or just completed via mutation, show the success state
  if (isCompleted || completeWalk.isSuccess) {
    const jobsToShow: any[] = completeWalk.data?.jobs || createdJobs || [];
    
    return (
      <div className="flex flex-col h-full bg-primary/5 p-5 animate-in fade-in zoom-in-95 duration-500 overflow-hidden relative">
        {/* Background deco */}
        <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background -z-10" />
        
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 pt-6 overflow-hidden">
          <div className="w-24 h-24 bg-primary rounded-full flex items-center justify-center text-primary-foreground shadow-[0_0_60px_-10px_hsl(var(--primary))] animate-in zoom-in duration-700 delay-200 shrink-0">
            <CheckCircle2 className="w-12 h-12 stroke-[2.5]" />
          </div>
          
          <div className="space-y-1.5 shrink-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">All Done!</h1>
            <p className="text-muted-foreground text-base font-medium">
              Created {jobsToShow.length} jobs for {walk.propertyName}.
            </p>
          </div>

          <div className="w-full max-w-sm flex-1 flex flex-col overflow-hidden mt-6 text-left">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-2 mb-3 shrink-0">Jobs Generated</h3>
            <div className="space-y-2.5 overflow-y-auto pb-4 pr-1">
              {jobsToShow.map((job: any, i) => (
                <div 
                  key={job.id} 
                  className="flex justify-between items-center p-4 bg-card rounded-2xl shadow-subtle border border-black/[0.03] animate-in slide-in-from-bottom-4 fade-in fill-mode-both"
                  style={{ animationDelay: `${300 + (i * 100)}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Receipt className="w-5 h-5 text-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-foreground text-base truncate">{job.unitNo || 'Property'}</div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase mt-0.5">Job #{job.jobNo}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0 ml-2">
                    {job.photoCount !== undefined && <span className="text-[10px] font-bold bg-muted px-2.5 py-1 rounded-full">{job.photoCount} photos</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 pt-4 pb-2 w-full max-w-sm mx-auto space-y-2.5">
          {/* Approve → the photos + job cards land on the client board. */}
          <Button
            className="w-full h-14 text-lg font-extrabold rounded-full shadow-float active:scale-95 transition-all"
            variant={approveWalk.isSuccess ? 'secondary' : 'default'}
            disabled={approveWalk.isPending || approveWalk.isSuccess}
            onClick={() =>
              approveWalk.mutate(
                { id: walkId },
                {
                  onSuccess: (r: any) => {
                    toast({
                      title: 'Sent to client board',
                      description: `${r?.cards ?? 0} card${(r?.cards ?? 0) === 1 ? '' : 's'} shared with the client.`,
                    });
                  },
                  onError: (err: any) => {
                    toast({
                      title: 'Could not send',
                      description: err?.data?.error || err?.message || 'Please try again.',
                      variant: 'destructive',
                    });
                  },
                },
              )
            }
            data-testid="button-approve-walk"
          >
            {approveWalk.isPending ? (
              <div className="flex items-center justify-center w-full">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                SENDING
              </div>
            ) : approveWalk.isSuccess ? (
              <div className="flex items-center justify-center w-full">
                <Check className="w-5 h-5 mr-2 stroke-[3]" />
                ON CLIENT BOARD
              </div>
            ) : (
              <div className="flex items-center justify-center w-full">
                <Send className="w-5 h-5 mr-2" />
                APPROVE — SEND TO CLIENT BOARD
              </div>
            )}
          </Button>
          <Button
            variant="outline"
            className="w-full h-12 text-base font-extrabold rounded-full active:scale-95 transition-all"
            onClick={() => setLocation('/')}
            data-testid="button-finish-walk"
          >
            FINISH
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      <div className="bg-background pt-4 pb-3 px-4 flex items-center gap-3 shrink-0 z-10 sticky top-0 border-b border-black/[0.03]">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/walk/${walkId}`)} className="rounded-full w-10 h-10 bg-muted hover:bg-muted/80">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 pr-4">
          <h2 className="font-extrabold text-xl tracking-tight leading-tight truncate">Review Walk</h2>
          <p className="text-[11px] font-bold text-muted-foreground truncate">{walk.propertyName}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        
        {/* Topline Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card p-4 rounded-2xl border border-black/[0.03] shadow-sm flex flex-col items-center justify-center text-center">
            <span className="text-3xl font-black text-foreground">{totalPhotos}</span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Items</span>
          </div>
          <div className="bg-card p-4 rounded-2xl border border-black/[0.03] shadow-sm flex flex-col items-center justify-center text-center bg-gradient-to-br from-primary/10 to-card">
            <span className="text-3xl font-black text-foreground">${totalValue.toFixed(0)}</span>
            <span className="text-[10px] font-bold text-primary-foreground/60 uppercase tracking-widest mt-1">Est. Value</span>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Summary by Location</h3>
          
          <div className="space-y-2.5">
            {Object.entries(summaryByUnit).map(([unit, stats]) => (
              <div key={unit} className="flex justify-between items-center bg-card p-4 rounded-2xl shadow-sm border border-black/[0.03]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-foreground/70" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-extrabold text-lg text-foreground truncate">{unit}</div>
                    <div className="font-bold text-xs text-muted-foreground">{stats.count} items</div>
                  </div>
                </div>
                <div className="text-right bg-muted px-3 py-1.5 rounded-xl shrink-0 ml-2">
                  <div className="font-bold text-base text-foreground">${stats.total.toFixed(2)}</div>
                </div>
              </div>
            ))}
            {Object.keys(summaryByUnit).length === 0 && (
              <div className="p-8 text-center bg-muted/30 rounded-2xl border border-dashed border-black/10">
                <p className="font-bold text-muted-foreground text-sm">No captures yet</p>
                <p className="text-[11px] text-muted-foreground mt-1">Go back and add some items.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 p-4 pb-6 bg-background/90 backdrop-blur-md border-t border-black/[0.03] flex justify-center z-20">
        <Button 
          className="w-full max-w-sm h-14 text-lg font-extrabold rounded-full shadow-float pointer-events-auto active:scale-[0.98] transition-all"
          size="lg"
          onClick={handleComplete}
          disabled={completeWalk.isPending || captures.length === 0}
          data-testid="button-create-jobs"
        >
          {completeWalk.isPending ? (
            <div className="flex items-center justify-center w-full">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              PROCESSING
            </div>
          ) : (
            'CREATE JOBS'
          )}
        </Button>
      </div>
    </div>
  );
}
