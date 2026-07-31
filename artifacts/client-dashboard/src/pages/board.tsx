import { useLocation, useParams } from 'wouter';
import { useGetClientBoard, useMarkClientBoardTourSeen, useDispatchClientBoardAction, useCreateClientBoardCard, useCreateClientBoardAiCard, useGetClientPmBoard, getGetClientPmBoardQueryKey } from '@workspace/api-client-react';
import { LoginDialog } from '@/components/LoginDialog';
import { useSessionExchange } from '@/hooks/useSessionExchange';
import { useToast } from '@/hooks/use-toast';
import { CommandPalette } from '@/components/kanban/CommandPalette';
import { MapPin, User, Loader2, LayoutGrid, BookOpen, Headphones, Search, LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardTour } from '@/components/DashboardTour';
import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { CardDetailDialog } from '@/components/kanban/CardDetailDialog';
import { NewCardSpotlight } from '@/components/NewCardSpotlight';
import { BirdseyeMapDialog } from '@/components/BirdseyeMapDialog';
import { AppleBoard, useBoardEvents } from '@workspace/board-ui';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';

function Board() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Tab state: vendors or pm, persisted in URL
  const [searchParams, setSearchParams] = useState(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  });
  const activeTab = searchParams.get('tab') === 'pm' ? 'pm' : 'vendors';

  const setActiveTab = (tab: 'vendors' | 'pm') => {
    const newParams = new URLSearchParams(window.location.search);
    if (tab === 'pm') {
      newParams.set('tab', 'pm');
    } else {
      newParams.delete('tab');
    }
    const newSearch = newParams.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
    setSearchParams(newParams);
  };

  const [loginOpen, setLoginOpen] = useState(false);
  const [birdseyeOpen, setBirdseyeOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<any | null>(null);

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

  const { data: board, isLoading, error } = useGetClientBoard(token, {
    query: {
      queryKey: getGetClientBoardQueryKey(token),
      // Live updates arrive over SSE (EventSource effect below); this slow
      // poll is only a fallback if the stream drops.
      refetchInterval: 30000,
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
  const createAiCard = useCreateClientBoardAiCard();
  const createCard = useCreateClientBoardCard();
  const pmBoardQuery = useGetClientPmBoard(token, { query: { queryKey: getGetClientPmBoardQueryKey(token), enabled: activeTab === 'pm' }});

  const markTourSeen = useMarkClientBoardTourSeen();

  const boardLoaded = !isLoading && !error && !!board;
  const viewerAuthenticated = board?.viewer?.authenticated ?? false;
  const viewerTourSeen = board?.viewer?.tourSeen ?? false;
  
  useEffect(() => {
    if (!boardLoaded) return;
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
  }, [boardLoaded, viewerAuthenticated, viewerTourSeen, token, markTourSeen]);

  const handleLogout = () => {
    localStorage.removeItem(`halo_client_session_${token}`);
    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
    toast({ title: "Signed out", description: "You are now viewing as a guest." });
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafafa]">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} 
          animate={{ opacity: 1, scale: 1 }} 
          className="flex flex-col items-center gap-4 text-[#6e6e73]"
        >
          <Loader2 className="h-8 w-8 animate-spin text-[#007AFF]" />
          <p className="text-[13px] font-medium tracking-wide uppercase">Loading workspace...</p>
        </motion.div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafafa]">
        <div className="max-w-md text-center p-8 bg-white rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-black/[0.06]">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight">Invalid or Expired Link</h1>
          <p className="mt-2 text-[15px] text-[#6e6e73]">We couldn't load the operations board. Please check your link or contact your property manager.</p>
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

  const handleCreateAiCard = async (prompt: string) => {
    await createAiCard.mutateAsync({ token, data: { prompt }});
    toast({ title: "Card created" });
    queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
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
      className="flex h-screen flex-col bg-[#fafafa] font-sans relative overflow-hidden"
    >
      {/* App Chrome - Header */}
      <header className="flex h-[64px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-white px-3 sm:px-5 z-50 sticky top-0">
        <div className="flex items-center gap-2.5 sm:gap-4 max-sm:min-w-0">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-7 object-contain drop-shadow-sm shrink-0" />
          ) : (
            <div className="text-[20px] font-bold text-[#1d1d1f] tracking-tight">HALO</div>
          )}
          <div className="h-6 w-px bg-black/[0.06] hidden sm:block" />
          <div className="flex flex-col justify-center max-sm:min-w-0">
            <h1 className="text-[14px] font-semibold text-[#1d1d1f] leading-tight max-sm:truncate">{propertyName}</h1>
            {board.propertyAddress && (
              <p className="text-[11px] font-medium text-[#6e6e73] leading-tight hidden sm:block">{board.propertyAddress}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <NotificationBell 
            token={token} 
            onCardClick={() => {}}
          />

          <button
            data-testid="button-search"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center h-8 gap-2 rounded-[8px] bg-[#f5f5f7] px-2.5 sm:px-3 text-[#6e6e73] hover:bg-[#e8e8ed] hover:text-[#1d1d1f] transition-colors"
            title="Search the board (⌘K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="text-[12px] font-medium hidden sm:inline">Search…</span>
            <kbd className="hidden md:inline rounded-[5px] bg-white px-1.5 py-0.5 text-[9px] font-bold font-mono shadow-sm">⌘K</kbd>
          </button>

          {viewer.permissions?.includes('unit_map') && (
            <>
              <button
                data-testid="button-map-view"
                className="h-8 px-2.5 sm:px-3 rounded-[8px] bg-[#f5f5f7] text-[#1d1d1f] text-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/map`)}
              >
                <MapPin className="h-3.5 w-3.5 text-[#007AFF]" /> <span className="hidden sm:inline">Map</span>
              </button>
              <button
                data-testid="button-site-map"
                className="h-8 px-2.5 sm:px-3 rounded-[8px] bg-[#f5f5f7] text-[#1d1d1f] text-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/units`)}
              >
                <LayoutGrid className="h-3.5 w-3.5 text-[#5856D6]" /> <span className="hidden sm:inline">Units</span>
              </button>
            </>
          )}

          {viewer.permissions?.includes('hub') && (
            <button
              className="h-8 px-2.5 sm:px-3 rounded-[8px] bg-[#f5f5f7] text-[#1d1d1f] text-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors flex items-center gap-1.5"
              onClick={() => setLocation(`/${token}/hub`)}
            >
              <BookOpen className="h-3.5 w-3.5 text-[#FF9500]" /> <span className="hidden sm:inline">Hub</span>
            </button>
          )}

          <button
            data-testid="button-board-tour"
            onClick={() => setTourOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed] hover:text-[#1d1d1f] transition-colors"
            title="Take the guided tour"
          >
            <Headphones className="h-4 w-4" />
          </button>

          <div className="h-6 w-px bg-black/[0.06] hidden sm:block" />

          {viewerAuthenticated ? (
            <button onClick={handleLogout} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed] transition-colors" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={() => setLoginOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed] transition-colors" title="Sign in">
              <User className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Tab Switcher */}
      <div className="flex h-[52px] shrink-0 items-center px-3 sm:px-5 bg-white border-b border-black/[0.06]">
        <div className="flex p-0.5 bg-[#f5f5f7] rounded-[10px] w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('vendors')}
            className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 text-[13px] font-semibold rounded-[8px] transition-all whitespace-nowrap ${
              activeTab === 'vendors'
                ? 'bg-white text-[#1d1d1f] shadow-sm'
                : 'text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            <span className="sm:hidden">Vendors</span>
            <span className="hidden sm:inline">Archangel Vendors</span>
          </button>
          <button
            onClick={() => setActiveTab('pm')}
            className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 text-[13px] font-semibold rounded-[8px] transition-all whitespace-nowrap ${
              activeTab === 'pm'
                ? 'bg-white text-[#1d1d1f] shadow-sm'
                : 'text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            <span className="sm:hidden">Management</span>
            <span className="hidden sm:inline">Property Management</span>
          </button>
        </div>
      </div>

      <AppleBoard
        board={activeBoardData}
        token={token}
        isLoading={isLoadingActive}
        viewer={viewer as any}
        boardKey={activeTab === 'pm' ? 'pm' : undefined}
        onLoginRequired={() => setLoginOpen(true)}
        onOpenBirdseye={activeTab === 'vendors' ? () => setBirdseyeOpen(true) : undefined}
        onCardClick={handleCardClick}
        onCardMove={handleCardMove}
        onCreateAiCard={activeTab === 'vendors' ? handleCreateAiCard : undefined}
        onCreateCard={handleCreateCard}
        showToast={toast}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        cards={board.cards || []}
        lanes={board.lanes || []}
        onSelectCard={() => {}}
      />

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} token={token} />

      <BirdseyeMapDialog
        token={token}
        open={birdseyeOpen}
        onOpenChange={setBirdseyeOpen}
      />

      {tourOpen && <DashboardTour onClose={() => setTourOpen(false)} />}

      {/* Front-and-center popups for cards the viewer hasn't seen yet. Held
          back while the tour runs so the two never fight for the screen. */}
      {boardLoaded && !tourOpen && (
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

      <CardDetailDialog
        token={token}
        card={detailCard ? ((activeBoardData?.cards || []).find((c: any) => c.cardKey === detailCard.cardKey) ?? detailCard) : null}
        onClose={() => setDetailCard(null)}
        readOnly={viewer.readOnly}
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
