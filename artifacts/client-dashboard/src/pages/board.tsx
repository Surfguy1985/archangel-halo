import { useLocation, useParams } from 'wouter';
import { useGetClientBoard, useMarkClientBoardTourSeen, useDispatchClientBoardAction, useCreateClientBoardCard, useGetClientPmBoard, getGetClientPmBoardQueryKey, useClearClientBoardCard, getGetClientBoardHistoryQueryKey } from '@workspace/api-client-react';
import { HistoryTab } from '@/components/HistoryTab';
import { LoginDialog } from '@/components/LoginDialog';
import { PulseLogin, pulseErrorBody, pulseErrorStatus } from '@/components/PulseLogin';
import { useSessionExchange } from '@/hooks/useSessionExchange';
import { useToast } from '@/hooks/use-toast';
import { CommandPalette } from '@/components/kanban/CommandPalette';
import { MapPin, User, Loader2, LayoutGrid, BookOpen, Headphones, Search, LogOut, MonitorDown, Users, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardTour } from '@/components/DashboardTour';
import { PresentationMode } from '@/components/PresentationMode';
import { motion } from 'framer-motion';
import React, { useEffect, useRef, useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { CardDetailDialog } from '@/components/kanban/CardDetailDialog';
import { NewCardSpotlight } from '@/components/NewCardSpotlight';
import { RequestWorkDialog, type ChangeOrderTarget } from '@/components/RequestWorkDialog';
import { BirdseyeMapDialog } from '@/components/BirdseyeMapDialog';
import { ConciergeChat } from '@/components/ConciergeChat';
import { AppleBoard, RailsBoard, useBoardEvents } from '@workspace/board-ui';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';

function Board() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { theme, cycle: cycleTheme } = useTheme();

  // Tab state: vendors or pm, persisted in URL
  const [searchParams, setSearchParams] = useState(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  });
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam === 'pm' ? 'pm' : tabParam === 'history' ? 'history' : 'vendors';

  const setActiveTab = (tab: 'vendors' | 'pm' | 'history') => {
    const newParams = new URLSearchParams(window.location.search);
    if (tab === 'pm' || tab === 'history') {
      newParams.set('tab', tab);
    } else {
      newParams.delete('tab');
    }
    const newSearch = newParams.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
    setSearchParams(newParams);
  };

  const [loginOpen, setLoginOpen] = useState(false);
  // Presentation Mode: ?present=1 launches the narrated investor walkthrough.
  const [presentationOpen, setPresentationOpen] = useState(
    () => searchParams.get('present') === '1',
  );
  // ?map=1 deep link — a shared live-map URL opens the board straight to the map.
  const [birdseyeOpen, setBirdseyeOpen] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('map') === '1',
  );
  const [tourOpen, setTourOpen] = useState(false);
  const pwaInstall = usePwaInstall();

  const handleInstallClick = async () => {
    const outcome = await pwaInstall.promptInstall();
    if (outcome === 'unavailable') {
      toast({
        title: 'Add this board as an app',
        description:
          'On iPhone/iPad: tap the Share button, then "Add to Home Screen". On Mac Safari: File → Add to Dock. On Chrome or Edge, use the install icon in the address bar.',
      });
    }
  };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<any | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [changeOrder, setChangeOrder] = useState<ChangeOrderTarget | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const propertyId = searchParams.get('property');
  const boardQs = propertyId ? `?property=${encodeURIComponent(propertyId)}` : '';

  const { data: board, isLoading, error } = useGetClientBoard(token, {
    query: {
      queryKey: [...getGetClientBoardQueryKey(token), propertyId ?? ''],
      queryFn: async ({ signal }) => {
        const res = await fetch(`/api/client/${token}/board${boardQs}`, {
          signal,
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('Invalid or expired link');
        return res.json();
      },
      // Live updates arrive over SSE (EventSource effect below); this slow
      // poll is only a fallback if the stream drops. During Presentation Mode
      // we poll fast (2s) so the board visibly reacts to each scripted server
      // step even if SSE lags.
      refetchInterval: presentationOpen ? 2000 : 30000,
    }
  });

  // Live push: the API pings this stream whenever anything on this board
  // changes (office pushes a card, an invoice is sent, another tab moves a
  // card, ...) so the board updates within ~1s without a manual refresh.
  // Live push with reconnect/backoff/catch-up; 30s poll remains the fallback.
  // Manual /api URLs must be absolute — never BASE_URL-prefixed.
  useBoardEvents(token ? `/api/client/${token}/board/events` : null, () => {
    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
    queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
  });

  // One-time token→cookie session exchange (strict mode: mutations require
  // the cookie; harmless no-op if the session already exists).
  useSessionExchange(token);

  const dispatchAction = useDispatchClientBoardAction();
  const createCard = useCreateClientBoardCard();
  const pmBoardQuery = useGetClientPmBoard(token, {
    query: {
      queryKey: [...getGetClientPmBoardQueryKey(token), propertyId ?? ''],
      enabled: activeTab === 'pm',
      queryFn: async ({ signal }) => {
        const res = await fetch(`/api/client/${token}/board/pm${boardQs}`, {
          signal,
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('Invalid or expired link');
        return res.json();
      },
    },
  });

  const markTourSeen = useMarkClientBoardTourSeen();
  const clearCard = useClearClientBoardCard();

  const handleCardClear = (card: any) => {
    if (!viewerAuthenticated) {
      setLoginOpen(true);
      return;
    }
    clearCard.mutate(
      { token, cardKey: card.cardKey, data: { title: card.title ?? null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardHistoryQueryKey(token) });
          toast({ title: 'Card cleared', description: 'Saved to your History tab.' });
        },
        onError: (err: any) => {
          toast({
            title: 'Could not clear card',
            description: err?.data?.error ?? 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const boardLoaded = !isLoading && !error && !!board;
  const viewerAuthenticated = board?.viewer?.authenticated ?? false;
  const viewerTourSeen = board?.viewer?.tourSeen ?? false;
  
  // One-shot guard: this effect's deps include the markTourSeen mutation
  // object, which react-query recreates on every render — firing the mutation
  // re-renders the page, which re-ran the effect, which fired again, spamming
  // POST /tour-seen in a loop until React hit "maximum update depth" and the
  // board crashed mid-walkthrough. The ref makes the decision exactly once
  // per board load, no matter how many times the effect re-runs.
  const tourDecidedRef = useRef(false);
  useEffect(() => {
    if (!boardLoaded) return;
    if (presentationOpen) {
      // The presentation REPLACES the intro tour — decide once and mark it
      // seen so the tour never auto-launches the moment the presentation
      // closes (two overlapping tutorials).
      if (!tourDecidedRef.current) {
        tourDecidedRef.current = true;
        const tourSeenKey = `halo_dashboard_tour_seen_${token}`;
        try { localStorage.setItem(tourSeenKey, '1'); } catch { /* ignore */ }
        if (viewerAuthenticated && !viewerTourSeen) markTourSeen.mutate({ token });
      }
      return;
    }
    // Deep links (?map=1) open the map dialog on top of the board — defer the
    // tour until the map closes so it isn't shown (and marked seen) underneath.
    if (birdseyeOpen) return;
    if (tourDecidedRef.current) return;
    tourDecidedRef.current = true;
    const tourSeenKey = `halo_dashboard_tour_seen_${token}`;
    if (viewerAuthenticated) {
      if (!viewerTourSeen) {
        markTourSeen.mutate({ token });
        try { localStorage.setItem(tourSeenKey, '1'); } catch { /* ignore */ }
        setTourOpen(true);
      }
      return;
    }
    let seen = true;
    try {
      seen = localStorage.getItem(tourSeenKey) === '1';
    } catch {}
    if (!seen) {
      try { localStorage.setItem(tourSeenKey, '1'); } catch {}
      setTourOpen(true);
    }
  }, [boardLoaded, viewerAuthenticated, viewerTourSeen, token, markTourSeen, presentationOpen, birdseyeOpen]);

  // Presentation Mode: the narrated interactive simulcast. Server steps are
  // fired inside PresentationMode against POST /api/presentation/demo/step
  // (token-matched). We fire "reset" whenever the presentation closes — early
  // or at the end — so the demo is always re-runnable. Guarded so it only
  // fires when the demo dashboardToken matches this board. /api URLs absolute.
  const closePresentation = async () => {
    setPresentationOpen(false);
    setDetailCard(null);
    try {
      const state = await fetch(
        `/api/presentation/demo?token=${encodeURIComponent(token)}`,
      ).then((r) => r.json());
      if (!state?.active || !state?.matches) return;
      await fetch('/api/presentation/demo/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, step: 'reset' }),
      });
    } catch {
      // Reset is best-effort — never block closing the presentation.
    }
  };

  // Force the vendors (rails) tab whenever the presentation is running — the
  // whole story is choreographed against the rails board testids.
  useEffect(() => {
    if (presentationOpen && activeTab !== 'vendors') setActiveTab('vendors');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationOpen]);

  const handleLogout = () => {
    localStorage.removeItem(`halo_client_session_${token}`);
    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
    toast({ title: "Signed out", description: "You are now viewing as a guest." });
  };

  if (isLoading) {
    return (
      <div className="cb-ios-app flex h-screen items-center justify-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} 
          animate={{ opacity: 1, scale: 1 }} 
          className="flex flex-col items-center gap-4 text-white/45"
        >
          <Loader2 className="h-8 w-8 animate-spin text-[#B4FF44]" />
          <p className="text-[13px] font-semibold tracking-wide uppercase">Loading board</p>
        </motion.div>
      </div>
    );
  }

  const pulseStatus = pulseErrorStatus(error);
  if (pulseStatus === 401 || pulseErrorBody(error).needsLogin) {
    return (
      <PulseLogin
        token={token}
        propertyName={pulseErrorBody(error).propertyName}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) })}
      />
    );
  }

  if (error || !board) {
    return (
      <div className="cb-ios-app flex h-screen items-center justify-center px-6">
        <div className="cb-cmd-card max-w-md text-center p-8">
          <h1 className="text-[22px] font-semibold tracking-tight">Link needs a refresh</h1>
          <p className="mt-2 text-[15px] text-white/55">We couldn’t open this board. Check the link or ask your property manager for a new one.</p>
        </div>
      </div>
    );
  }

  const { viewer, propertyName, logoUrl } = board;

  const activeBoardData = activeTab === 'pm' ? pmBoardQuery.data : board;
  const isLoadingActive = activeTab === 'pm' ? pmBoardQuery.isLoading : isLoading;

  const handleCardClick = (card: any) => {
    setDetailCard(card);
  };

  const handleCardMove = (cardKey: string, laneKey: string, dropIndex?: number) => {
    const cards = activeBoardData?.cards || [];
    const card = cards.find((c: any) => c.cardKey === cardKey);
    if (!card) return;

    const targetLaneKeys = cards
      .filter((c: any) => c.lane === laneKey && c.cardKey !== cardKey)
      .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
      .map((c: any) => c.cardKey);
    const insertAt = Math.max(0, Math.min(dropIndex ?? 0, targetLaneKeys.length));

    if (card.lane === laneKey) {
      const currentOrder = cards
        .filter((c: any) => c.lane === laneKey)
        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
        .map((c: any) => c.cardKey);
      if (currentOrder.indexOf(cardKey) === insertAt) return;
    }

    const orderedCardKeys = [...targetLaneKeys];
    orderedCardKeys.splice(insertAt, 0, cardKey);

    const qKey = activeTab === 'pm' ? getGetClientPmBoardQueryKey(token) : getGetClientBoardQueryKey(token);
    const previousCards = cards.map((c: any) => ({ ...c }));
    queryClient.setQueryData(qKey, (old: any) => {
      if (!old) return old;
      return {
        ...old,
        cards: old.cards.map((c: any) => {
          const idx = orderedCardKeys.indexOf(c.cardKey);
          if (c.cardKey === cardKey) return { ...c, lane: laneKey, position: insertAt };
          if (idx >= 0) return { ...c, position: idx };
          return c;
        })
      };
    });

    dispatchAction.mutate({
      token,
      data: {
        action: "card.moved",
        cardKey,
        payload: { lane: laneKey, position: insertAt, orderedCardKeys }
      }
    }, {
      onSuccess: (outcome) => {
        if (!outcome.ok) {
          queryClient.setQueryData(qKey, (old: any) => old ? { ...old, cards: previousCards } : old);
          toast({ title: "Move blocked", description: outcome.reason || outcome.message || "Cannot move card", variant: "destructive" });
        } else {
          queryClient.invalidateQueries({ queryKey: qKey });
        }
      },
      onError: (err) => {
        queryClient.setQueryData(qKey, (old: any) => old ? { ...old, cards: previousCards } : old);
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleCreateCard = async (data: any) => {
    await createCard.mutateAsync({ token, data });
    toast({ title: "Card created" });
    queryClient.invalidateQueries({ queryKey: activeTab === 'pm' ? getGetClientPmBoardQueryKey(token) : getGetClientBoardQueryKey(token) });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="cb-ios-app flex h-screen flex-col relative overflow-hidden"
    >
      {/* App Chrome - Header */}
      <header className="flex h-[64px] shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#07101E]/92 px-3 sm:px-5 z-50 sticky top-0 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 sm:gap-4 max-sm:min-w-0">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-7 object-contain drop-shadow-sm shrink-0" />
          ) : (
            <div className="cb-ios-mark" aria-hidden />
          )}
          <div className="h-6 w-px bg-white/[0.08] hidden sm:block" />
          <div className="flex flex-col justify-center max-sm:min-w-0">
            <div className="flex items-center gap-1.5 max-sm:min-w-0">
              <h1 className="text-[14px] font-semibold text-white/90 leading-tight max-sm:truncate">{propertyName}</h1>
              {(board.unreadMessages ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 rounded-full bg-[#FF3B30] px-1.5 py-0.5 text-[10px] font-bold text-white leading-none shrink-0"
                  title="Unread messages from the office"
                  data-testid="badge-board-unread"
                >
                  {board.unreadMessages}
                </span>
              )}
            </div>
            {board.propertyAddress && (
              <p className="text-[11px] font-medium text-white/40 leading-tight hidden sm:block">{board.propertyAddress}</p>
            )}
          </div>
          <button
            type="button"
            className="cb-ios-chip hidden sm:inline-flex items-center"
            onClick={() => setLocation(`/${token}`)}
          >
            Pulse
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <NotificationBell 
            token={token} 
            onCardClick={() => {}}
          />

          <button
            data-testid="button-search"
            onClick={() => setPaletteOpen(true)}
            className="cb-ios-chip flex items-center gap-2 text-white/45"
            title="Search the board (⌘K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="text-[12px] font-medium hidden sm:inline">Search…</span>
            <kbd className="hidden md:inline rounded-[5px] bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold font-mono text-white/50">⌘K</kbd>
          </button>

          {viewer.permissions?.includes('unit_map') && (
            <>
              <button
                data-testid="button-map-view"
                className="cb-ios-chip flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/map`)}
              >
                <MapPin className="h-3.5 w-3.5 text-[#B4FF44]" /> <span className="hidden sm:inline">Map</span>
              </button>
              <button
                data-testid="button-site-map"
                className="cb-ios-chip flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/units`)}
              >
                <LayoutGrid className="h-3.5 w-3.5 text-[#B4FF44]" /> <span className="hidden sm:inline">Units</span>
              </button>
            </>
          )}

          {viewer.permissions?.includes('team_admin') && (
            <button
              data-testid="button-team"
              className="cb-ios-chip flex items-center gap-1.5"
              onClick={() => setLocation(`/${token}/team`)}
            >
              <Users className="h-3.5 w-3.5 text-[#B4FF44]" /> <span className="hidden sm:inline">Team</span>
            </button>
          )}

          {viewer.permissions?.includes('hub') && (
            <button
              className="cb-ios-chip flex items-center gap-1.5"
              onClick={() => setLocation(`/${token}/hub`)}
            >
              <BookOpen className="h-3.5 w-3.5 text-[#B4FF44]" /> <span className="hidden sm:inline">Hub</span>
            </button>
          )}

          {!pwaInstall.installed && (
            <button
              data-testid="button-install-app"
              onClick={handleInstallClick}
              className="cb-ios-chip flex items-center gap-1.5"
              title="Install this board as an app"
            >
              <MonitorDown className="h-3.5 w-3.5 text-[#B4FF44]" />
              <span className="hidden sm:inline">Install</span>
            </button>
          )}

          <button
            data-testid="button-board-tour"
            onClick={() => setTourOpen(true)}
            className="cb-ios-orb flex items-center justify-center"
            title="Take the guided tour"
          >
            <Headphones className="h-4 w-4" />
          </button>

          {/* Theme toggle: cycles system → light → dark */}
          <button
            data-testid="button-theme-toggle"
            onClick={cycleTheme}
            className="cb-ios-orb flex items-center justify-center"
            title={theme === 'system' ? 'Theme: system (click for light)' : theme === 'light' ? 'Theme: light (click for dark)' : 'Theme: dark (click for system)'}
          >
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : theme === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
          </button>

          <div className="h-6 w-px bg-black/[0.06] dark:bg-white/[0.06] hidden sm:block" />

          {viewerAuthenticated ? (
            <button onClick={handleLogout} className="cb-ios-orb flex items-center justify-center" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={() => setLoginOpen(true)} className="cb-ios-orb flex items-center justify-center" title="Sign in">
              <User className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Tab Switcher */}
      <div className="flex h-[56px] shrink-0 items-center px-3 sm:px-5">
        <div className="cb-ios-seg max-w-[520px]">
          <button
            onClick={() => setActiveTab('vendors')}
            data-on={activeTab === 'vendors' ? 'true' : 'false'}
            className="cb-ios-seg-item"
          >
            Work
          </button>
          <button
            onClick={() => setActiveTab('pm')}
            data-on={activeTab === 'pm' ? 'true' : 'false'}
            className="cb-ios-seg-item"
          >
            Yours
          </button>
          <button
            data-testid="tab-history"
            onClick={() => setActiveTab('history')}
            data-on={activeTab === 'history' ? 'true' : 'false'}
            className="cb-ios-seg-item"
          >
            History
          </button>
        </div>
      </div>

      {activeTab === 'history' ? (
        <HistoryTab token={token} canRestore={viewerAuthenticated && !viewer.readOnly} />
      ) : activeTab === 'vendors' ? (
        /* Rails redesign: five fixed rails, Needs you first. Cards move
           themselves — no client drag; all actions live on the detail sheet. */
        <RailsBoard
          cards={board?.cards}
          isLoading={isLoading}
          onOpenCard={handleCardClick}
          onClearCard={viewerAuthenticated && !viewer.readOnly ? handleCardClear : undefined}
          onRequestWork={() => {
            if (!viewerAuthenticated) { setLoginOpen(true); return; }
            setRequestOpen(true);
          }}
          onOpenMap={() => setBirdseyeOpen(true)}
        />
      ) : (
      <AppleBoard
        board={activeBoardData}
        token={token}
        isLoading={isLoadingActive}
        viewer={viewer as any}
        boardKey="pm"
        onLoginRequired={() => setLoginOpen(true)}
        onCardClick={handleCardClick}
        onCardMove={handleCardMove}
        onCreateCard={handleCreateCard}
        showToast={toast}
        onCardClear={handleCardClear}
      />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        cards={board.cards || []}
        lanes={board.lanes || []}
        onSelectCard={() => {}}
      />

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} token={token} />

      <RequestWorkDialog
        token={token}
        open={requestOpen}
        onOpenChange={(open) => {
          setRequestOpen(open);
          if (!open) setChangeOrder(null);
        }}
        changeOrder={changeOrder}
        elevated={presentationOpen}
      />

      <BirdseyeMapDialog
        token={token}
        open={birdseyeOpen}
        onOpenChange={setBirdseyeOpen}
      />

      {tourOpen && !presentationOpen && <DashboardTour onClose={() => setTourOpen(false)} />}

      {presentationOpen && (
        <PresentationMode
          token={token}
          onClose={() => void closePresentation()}
          getCards={() => board?.cards || []}
          onOpenCard={(cardKey) => {
            const card = (board?.cards || []).find((c: any) => c.cardKey === cardKey);
            if (card) setDetailCard(card);
          }}
          onCloseCard={() => setDetailCard(null)}
          onServerStep={() => {
            queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          }}
          onOpenRequest={() => setRequestOpen(true)}
          onCloseRequest={() => setRequestOpen(false)}
        />
      )}

      {/* Front-and-center popups for cards the viewer hasn't seen yet. Held
          back while the tour runs so the two never fight for the screen. */}
      {boardLoaded && !tourOpen && !presentationOpen && (
        <NewCardSpotlight
          token={token}
          cards={board?.cards || []}
          readOnly={viewer.readOnly}
          onOpenDetails={(card) => setDetailCard(card)}
          onReadOnlyClick={() => {
            if (!viewerAuthenticated) setLoginOpen(true);
            else toast({ title: 'Read-only access', description: 'Ask your property manager for edit access.' });
          }}
        />
      )}

      {boardLoaded && !tourOpen && !presentationOpen && (
        <ConciergeChat
          token={token}
          authenticated={viewerAuthenticated}
          onOpenCard={(cardKey) => {
            const card = (activeBoardData?.cards || []).find((c: any) => c.cardKey === cardKey);
            if (card) setDetailCard(card);
            else toast({ title: 'That card is no longer on the board' });
          }}
        />
      )}

      <CardDetailDialog
        token={token}
        elevated={presentationOpen}
        card={detailCard ? ((activeBoardData?.cards || []).find((c: any) => c.cardKey === detailCard.cardKey) ?? detailCard) : null}
        onClose={() => setDetailCard(null)}
        readOnly={viewer.readOnly}
        onRequestChange={(card) => {
          if (!viewerAuthenticated) { setLoginOpen(true); return; }
          setDetailCard(null);
          setChangeOrder({ jobId: card.cardKey.slice('job:'.length), title: card.title });
          setRequestOpen(true);
        }}
        onReadOnlyClick={() => {
          if (!viewerAuthenticated) {
            setDetailCard(null);
            setLoginOpen(true);
          } else {
            toast({ title: 'Read-only access', description: 'Ask your property manager for edit access.' });
          }
        }}
      />
    </motion.div>
  );
}

export default Board;
