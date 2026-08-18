import React from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import StartScreen from '@/pages/start';
import CaptureScreen from '@/pages/capture';
import ReviewScreen from '@/pages/review';
import { CheckCircle2 } from 'lucide-react';

const queryClient = new QueryClient({
  queryCache: new QueryCache({}),
  mutationCache: new MutationCache({}),
  defaultOptions: {
    queries: {
      retry: (failureCount) => failureCount < 2,
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
            <div className="h-[100dvh] w-full bg-background flex flex-col font-sans overflow-hidden">
              
              {/* Header - Super clean, floaty */}
              <header className="shrink-0 z-50 w-full bg-background/80 backdrop-blur-xl border-b border-black/[0.03]">
                <div className="flex h-16 items-center justify-center px-4 max-w-md mx-auto w-full relative">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-sm">
                      <CheckCircle2 className="w-5 h-5 text-primary-foreground stroke-[3]" />
                    </div>
                    <div className="font-bold text-xl tracking-tight text-foreground">
                      HALO Walk
                    </div>
                  </div>
                </div>
              </header>
              
              {/* Main content - mobile constrained, no side borders, relying on background color difference if needed */}
              <main className="flex-1 w-full max-w-md mx-auto relative flex flex-col overflow-hidden">
                <Router />
              </main>
            </div>
          </WouterRouter>
          <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
