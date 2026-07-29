import { useLocation, useParams } from 'wouter';
import { useGetClientBoard, useMarkClientBoardTourSeen } from '@workspace/api-client-react';
import { LoginDialog } from '@/components/LoginDialog';
import { useToast } from '@/hooks/use-toast';
import { CommandPalette } from '@/components/kanban/CommandPalette';
import { MapPin, User, Loader2, LayoutGrid, BookOpen, Headphones, Search, LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { DashboardTour } from '@/components/DashboardTour';
import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { BirdseyeMapDialog } from '@/components/BirdseyeMapDialog';
import { AppleBoard } from '@/components/apple-board/AppleBoard';

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
      refetchInterval: 4000,
    }
  });

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

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex h-screen flex-col bg-[#fafafa] font-sans relative overflow-hidden"
    >
      {/* App Chrome - Header */}
      <header className="flex h-[64px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-white px-5 z-50 sticky top-0">
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-7 object-contain drop-shadow-sm" />
          ) : (
            <div className="text-[20px] font-bold text-[#1d1d1f] tracking-tight">HALO</div>
          )}
          <div className="h-6 w-px bg-black/[0.06]" />
          <div className="flex flex-col justify-center">
            <h1 className="text-[14px] font-semibold text-[#1d1d1f] leading-tight">{propertyName}</h1>
            {board.propertyAddress && (
              <p className="text-[11px] font-medium text-[#6e6e73] leading-tight">{board.propertyAddress}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <NotificationBell 
            token={token} 
            onCardClick={() => {}}
          />

          <button
            data-testid="button-search"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center h-8 gap-2 rounded-[8px] bg-[#f5f5f7] px-3 text-[#6e6e73] hover:bg-[#e8e8ed] hover:text-[#1d1d1f] transition-colors"
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
                className="h-8 px-3 rounded-[8px] bg-[#f5f5f7] text-[#1d1d1f] text-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/map`)}
              >
                <MapPin className="h-3.5 w-3.5 text-[#007AFF]" /> Map
              </button>
              <button
                data-testid="button-site-map"
                className="h-8 px-3 rounded-[8px] bg-[#f5f5f7] text-[#1d1d1f] text-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors flex items-center gap-1.5"
                onClick={() => setLocation(`/${token}/units`)}
              >
                <LayoutGrid className="h-3.5 w-3.5 text-[#5856D6]" /> Units
              </button>
            </>
          )}

          {viewer.permissions?.includes('hub') && (
            <button
              className="h-8 px-3 rounded-[8px] bg-[#f5f5f7] text-[#1d1d1f] text-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors flex items-center gap-1.5"
              onClick={() => setLocation(`/${token}/hub`)}
            >
              <BookOpen className="h-3.5 w-3.5 text-[#FF9500]" /> Hub
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

          <div className="h-6 w-px bg-black/[0.06]" />

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
      <div className="flex h-[52px] shrink-0 items-center px-5 bg-white border-b border-black/[0.06]">
        <div className="flex p-0.5 bg-[#f5f5f7] rounded-[10px]">
          <button
            onClick={() => setActiveTab('vendors')}
            className={`px-4 py-1.5 text-[13px] font-semibold rounded-[8px] transition-all ${
              activeTab === 'vendors'
                ? 'bg-white text-[#1d1d1f] shadow-sm'
                : 'text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            Archangel Vendors
          </button>
          <button
            onClick={() => setActiveTab('pm')}
            className={`px-4 py-1.5 text-[13px] font-semibold rounded-[8px] transition-all ${
              activeTab === 'pm'
                ? 'bg-white text-[#1d1d1f] shadow-sm'
                : 'text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            Property Management
          </button>
        </div>
      </div>

      <AppleBoard
        token={token}
        viewer={viewer as any}
        boardKey={activeTab === 'pm' ? 'pm' : undefined}
        onLoginRequired={() => setLoginOpen(true)}
        onOpenBirdseye={activeTab === 'vendors' ? () => setBirdseyeOpen(true) : undefined}
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
    </motion.div>
  );
}

export default Board;
