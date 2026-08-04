import React from 'react';
import { useRoute, useLocation } from 'wouter';
import { useGetWalk, useCompleteWalk, useGetProperty, WalkCapture, getGetWalkQueryKey, getGetPropertyQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, CheckCircle2, Building2 } from 'lucide-react';
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
          toast({ title: 'Walk completed', description: 'Jobs have been created.' });
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
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!data?.walk) {
    return <div className="p-8 text-center text-muted-foreground">Walk not found</div>;
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
      <div className="flex flex-col min-h-screen bg-card p-6 animate-in fade-in zoom-in-95 duration-500">
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
          <div className="w-24 h-24 bg-primary/20 rounded-full flex items-center justify-center text-primary mb-4">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          
          <h1 className="text-3xl font-bold tracking-tight">Walk Complete</h1>
          <p className="text-muted-foreground text-lg">
            Successfully generated {jobsToShow.length} jobs for {walk.propertyName}.
          </p>

          <div className="w-full max-w-sm space-y-3 mt-8">
            {jobsToShow.map((job: any) => (
              <div key={job.id} className="flex justify-between items-center p-4 bg-muted rounded-xl border border-border">
                <div className="font-bold flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                  {job.unitNo || 'Property'}
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">Job #{job.jobNo}</span>
                  {job.photoCount !== undefined && <span className="text-sm font-medium">{job.photoCount} photos</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button 
          className="w-full h-16 text-xl font-bold mt-8" 
          onClick={() => setLocation('/')}
        >
          DONE
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-muted/20">
      <div className="bg-card p-4 border-b border-border flex items-center gap-4 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/walk/${walkId}`)}>
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <div>
          <h2 className="font-bold text-lg leading-tight">Review Walk</h2>
          <p className="text-sm text-muted-foreground">{walk.propertyName}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        
        {/* Topline Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col items-center justify-center text-center">
            <span className="text-3xl font-black text-foreground">{totalPhotos}</span>
            <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider mt-1">Photos</span>
          </div>
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col items-center justify-center text-center">
            <span className="text-3xl font-black text-foreground">${totalValue.toFixed(0)}</span>
            <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider mt-1">Est. Value</span>
          </div>
        </div>

        <h3 className="font-bold text-lg text-muted-foreground uppercase tracking-wider pt-4">Summary by Unit</h3>
        
        <div className="space-y-3">
          {Object.entries(summaryByUnit).map(([unit, stats]) => (
            <div key={unit} className="flex justify-between items-center bg-card p-4 rounded-xl border border-border shadow-sm">
              <div className="font-bold text-lg">{unit}</div>
              <div className="text-right">
                <div className="font-bold">{stats.count} items</div>
                <div className="text-sm text-muted-foreground">${stats.total.toFixed(2)}</div>
              </div>
            </div>
          ))}
          {Object.keys(summaryByUnit).length === 0 && (
            <div className="p-8 text-center text-muted-foreground bg-card border border-border rounded-xl border-dashed">
              No captures yet.
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-card border-t border-border shrink-0">
        <Button 
          className="w-full h-20 text-xl font-bold rounded-2xl shadow-xl"
          size="lg"
          onClick={handleComplete}
          disabled={completeWalk.isPending || captures.length === 0}
          data-testid="button-create-jobs"
        >
          {completeWalk.isPending ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : (
            'CREATE JOBS'
          )}
        </Button>
      </div>
    </div>
  );
}
