import { Link, useLocation } from "wouter";
import { Mic, Bell, LayoutGrid, CalendarDays, Sparkles } from "lucide-react";
import haloLogo from "../assets/halo-logo.png";
import { useGetToday, getGetTodayQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { VoiceCaptureSheet } from "./VoiceCaptureSheet";
import { NotificationsDrawer } from "./NotificationsDrawer";
import { MoreMenuSheet } from "./MoreMenuSheet";
import { ArrivalDetection } from "./ArrivalSheet";
import { FalkonBadge } from "./FalkonBadge";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: today } = useGetToday({
    query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000 },
  });
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cmdText, setCmdText] = useState("");
  const [cmdInitial, setCmdInitial] = useState<string | undefined>(undefined);

  const submitCommand = () => {
    const text = cmdText.trim();
    if (!text) return;
    setCmdInitial(text);
    setCmdText("");
    setVoiceOpen(true);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center py-0 sm:py-7">
      <div className="hidden sm:block text-[12px] font-display font-semibold tracking-[0.22em] text-muted-foreground uppercase mb-[14px]">
        ARCHANGEL · <b className="text-[var(--gold)]">HALO</b> · OPERATIONS LAYER
      </div>

      <div className="w-full sm:w-[430px] h-[100dvh] sm:h-[850px] bg-background sm:rounded-[32px] sm:shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.5)] overflow-hidden relative flex flex-col">
        {/* App Bar */}
        <header className="flex items-center gap-[10px] px-[18px] pt-[16px] pb-[12px] shrink-0 border-b border-[var(--hairline)]">
          <img src={haloLogo} alt="HALO — Archangel Operations" className="h-[30px] w-auto shrink-0" style={{ filter: 'brightness(0)' }} />
          <Link href="/calendar">
            <button
              className={`ml-auto w-[40px] h-[40px] rounded-full grid place-items-center bg-card border border-[var(--hairline)] ${location.startsWith("/calendar") ? "text-[var(--gold)]" : ""}`}
              aria-label="Calendar"
            >
              <CalendarDays className="w-[19px] h-[19px]" strokeWidth={1.9} />
            </button>
          </Link>
          <button
            className="w-[40px] h-[40px] rounded-full grid place-items-center bg-card border border-[var(--hairline)] hover:bg-[var(--hairline)] transition-colors"
            onClick={() => setMoreOpen(true)}
            aria-label="More"
          >
            <LayoutGrid className="w-[19px] h-[19px]" strokeWidth={1.9} />
          </button>
          <button 
            className="relative w-[40px] h-[40px] rounded-full grid place-items-center bg-card border border-[var(--hairline)] hover:bg-[var(--hairline)] transition-colors"
            onClick={() => setNotificationsOpen(true)}
          >
            <Bell className="w-[19px] h-[19px]" strokeWidth={1.9} />
            {today?.unreadNotifications ? (
              <span className="absolute -top-[2px] -right-[2px] min-w-[18px] h-[18px] px-[5px] rounded-[9px] bg-[var(--gold-light)] text-black text-[11px] font-bold grid place-items-center font-display shadow-[0_0_10px_rgba(180,255,68,0.5)]">
                {today.unreadNotifications}
              </span>
            ) : null}
          </button>
        </header>

        {/* JARVIS command bar */}
        <div className="px-[18px] pt-[14px] pb-[10px] shrink-0">
          <div className="relative">
            <Sparkles className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-[var(--gold)]" />
            <input
              value={cmdText}
              onChange={(e) => setCmdText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCommand();
              }}
              placeholder="Tell HALO what to do…"
              className="w-full h-[46px] rounded-full bg-card border border-[var(--hairline)] shadow-inner pl-[40px] pr-[84px] text-[14px] focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold)] placeholder:text-muted-foreground/50 transition-all text-foreground"
              data-testid="input-command-bar"
            />
            {cmdText.trim() && (
              <button
                type="button"
                onClick={submitCommand}
                className="absolute right-[6px] top-1/2 -translate-y-1/2 h-[34px] px-[16px] rounded-full bg-[var(--gold-light)] text-black text-[12px] font-bold shadow-[0_0_15px_rgba(180,255,68,0.3)] hover:scale-105 transition-transform"
                data-testid="button-command-go"
              >
                EXECUTE
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-[18px] pb-[118px] scroll-smooth">
          {children}
          <FalkonBadge className="mt-8" />
        </main>

        {/* Tab Bar */}
        <nav className="absolute left-0 right-0 bottom-0 h-[86px] bg-[rgba(9,9,11,0.85)] backdrop-blur-[20px] border-t border-[var(--hairline)] flex items-start justify-around px-[6px] pt-[10px] pb-[calc(12px+env(safe-area-inset-bottom))]">
          <Link href="/">
            <button className={`flex flex-col items-center gap-[4px] w-[64px] text-[10px] font-bold tracking-[0.05em] pt-[5px] uppercase ${location === "/" ? "text-[var(--gold)]" : "text-muted-foreground hover:text-[var(--faint)]"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-[20px] h-[20px]">
                <circle cx="12" cy="12" r="9"/>
                {location === "/" && <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>}
              </svg>
              Today
            </button>
          </Link>
          <Link href="/properties">
            <button className={`flex flex-col items-center gap-[4px] w-[64px] text-[10px] font-bold tracking-[0.05em] pt-[5px] uppercase ${location.startsWith("/properties") ? "text-[var(--gold)]" : "text-muted-foreground hover:text-[var(--faint)]"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[20px] h-[20px]">
                <path d="M4 21V6l6-3v18M10 21h10V10l-6-2.5"/><path d="M6.5 9h1M6.5 12.5h1M6.5 16h1M14 13h1M14 16.5h1"/>
              </svg>
              Props
            </button>
          </Link>
          <div className="w-[74px] relative -top-[26px]">
            <button 
              className="w-[66px] h-[66px] rounded-full relative grid place-items-center shadow-[0_0_30px_rgba(180,255,68,0.3)] mx-auto bg-[var(--gold-light)] text-black hover:scale-105 active:scale-95 transition-transform"
              onClick={() => setVoiceOpen(true)}
            >
              <Mic className="relative z-10 w-[26px] h-[26px]" strokeWidth={2.5} />
            </button>
            <span className="block text-center text-[10px] font-bold tracking-[0.2em] text-[var(--gold)] mt-[8px]">VOICE</span>
          </div>
          <Link href="/money">
            <button className={`flex flex-col items-center gap-[4px] w-[64px] text-[10px] font-bold tracking-[0.05em] pt-[5px] uppercase ${location.startsWith("/money") ? "text-[var(--gold)]" : "text-muted-foreground hover:text-[var(--faint)]"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-[20px] h-[20px]">
                <circle cx="12" cy="12" r="9"/><path d="M12 7v10M14.8 9.2c-.6-1-1.6-1.4-2.8-1.4-1.7 0-2.8.9-2.8 2.2 0 2.9 5.6 1.5 5.6 4.3 0 1.3-1.2 2.2-2.8 2.2-1.3 0-2.4-.5-3-1.5"/>
              </svg>
              Money
            </button>
          </Link>
          <Link href="/crews">
            <button className={`flex flex-col items-center gap-[4px] w-[64px] text-[10px] font-bold tracking-[0.05em] pt-[5px] uppercase ${location.startsWith("/crews") ? "text-[var(--gold)]" : "text-muted-foreground hover:text-[var(--faint)]"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[20px] h-[20px]">
                <circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.5 14.7c2.6.2 4.4 1.9 5 4.8"/>
              </svg>
              Crews
            </button>
          </Link>
        </nav>

        <VoiceCaptureSheet
          open={voiceOpen}
          onOpenChange={(o) => {
            setVoiceOpen(o);
            if (!o) setCmdInitial(undefined);
          }}
          initialText={cmdInitial}
        />
        <NotificationsDrawer open={notificationsOpen} onOpenChange={setNotificationsOpen} />
        <MoreMenuSheet open={moreOpen} onOpenChange={setMoreOpen} />
        <ArrivalDetection />
      </div>
    </div>
  );
}
