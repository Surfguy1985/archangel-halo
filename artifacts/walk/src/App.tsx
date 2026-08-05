import React from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import StartScreen from '@/pages/start';
import CaptureScreen from '@/pages/capture';
import ReviewScreen from '@/pages/review';
import WalkGate from '@/components/WalkGate';

const is401 = (error: any) =>
  error?.status === 401 || error?.response?.status === 401 || error?.message?.includes('401');

// Walk app has its own passcode (separate from the office one) — WalkGate
// below blocks the UI until /walk-auth login succeeds. The server still
// scopes every walk route to the single Thornbury target property.
const queryClient = new QueryClient({
  queryCache: new QueryCache({}),
  mutationCache: new MutationCache({}),
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (is401(error)) return false;
        return failureCount < 2;
      },
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={StartScreen} />
      <Route path="/walk/:id" component={CaptureScreen} />
      <Route path="/walk/:id/review" component={ReviewScreen} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <div className="min-h-[100dvh] w-full bg-background flex flex-col">
              {/* Header */}
              <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex h-14 items-center px-4 max-w-md mx-auto w-full">
                  <div className="font-bold text-xl tracking-tight text-foreground">
                    HALO Walk
                  </div>
                </div>
              </header>
              
              {/* Main content - mobile constrained */}
              <main className="flex-1 w-full max-w-md mx-auto bg-card shadow-sm border-x border-border/20 relative flex flex-col">
                <WalkGate>
                  <Router />
                </WalkGate>
              </main>
            </div>
          </WouterRouter>
          <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
