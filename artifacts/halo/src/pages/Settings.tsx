import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useResetAllData,
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, GraduationCap, Play, MapPin, Radar, Loader2, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TrainingCenter } from "@/components/TrainingCenter";
import { onsiteStorage, ArrivalSheet } from "@/components/ArrivalSheet";
import {
  useCheckArrival,
  type ArrivalCheckResult,
} from "@workspace/api-client-react";

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reset = useResetAllData();
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [onsiteEnabled, setOnsiteEnabled] = useState(onsiteStorage.isEnabled());
  const [ownerName, setOwnerName] = useState(onsiteStorage.getOwner());
  const [testResult, setTestResult] = useState<ArrivalCheckResult | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const checkArrival = useCheckArrival();
  const { data: bizSettings } = useGetBusinessSettings();
  const updateSettings = useUpdateBusinessSettings();

  const setAutoApprove = (on: boolean) => {
    updateSettings.mutate(
      { data: { autopilotAutoApprove: on } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
          toast({
            title: on ? "Auto-approve on" : "Auto-approve off",
            description: on
              ? "Autopilot will now act on its own — reminders and rebroadcasts go out immediately."
              : "Autopilot will wait for your approval on the Today page.",
          });
        },
        onError: (e) =>
          toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
      },
    );
  };

  const testDetection = () => {
    if (!("geolocation" in navigator)) {
      toast({ title: "Location not supported", description: "This browser can't share location.", variant: "destructive" });
      return;
    }
    setTesting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        checkArrival.mutate(
          {
            data: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              owner: ownerName.trim() || undefined,
            },
          },
          {
            onSuccess: (r) => {
              setTesting(false);
              if (r.match) {
                setTestResult(r);
                setTestOpen(true);
                if ("vibrate" in navigator) navigator.vibrate?.(200);
              } else {
                toast({
                  title: "No property found here",
                  description:
                    "You're not within 250m of any property. Add a property and pin it to your current location, then test again.",
                });
              }
            },
            onError: () => {
              setTesting(false);
              toast({ title: "Test failed", description: "Couldn't reach the server. Try again.", variant: "destructive" });
            },
          },
        );
      },
      () => {
        setTesting(false);
        toast({
          title: "Location permission needed",
          description: "Allow location access for HALO, then try again.",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  };

  const toggleOnsite = () => {
    if (onsiteEnabled) {
      onsiteStorage.setEnabled(false);
      setOnsiteEnabled(false);
      toast({ title: "On-site detection off", description: "This phone will no longer watch for arrivals." });
      return;
    }
    if (!ownerName.trim()) {
      toast({ title: "Add your name first", description: "So HALO knows which owner arrived.", variant: "destructive" });
      return;
    }
    if (!("geolocation" in navigator)) {
      toast({ title: "Location not supported", description: "This browser can't share location.", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        onsiteStorage.setOwner(ownerName.trim());
        onsiteStorage.setEnabled(true);
        setOnsiteEnabled(true);
        toast({
          title: "On-site detection on",
          description: "When this phone arrives at one of your properties, HALO will prompt you.",
        });
      },
      () => {
        toast({
          title: "Location permission needed",
          description: "Allow location access for HALO in your browser settings, then try again.",
          variant: "destructive",
        });
      },
      { timeout: 15_000 },
    );
  };

  const wipeData = () => {
    reset.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast({
          title: "Fresh start ready",
          description: "All sample data was cleared. Your company info stays.",
        });
      },
      onError: (e) =>
        toast({ title: "Couldn't clear data", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="pt-[8px]">
      <h1 className="font-display font-bold text-[24px] mb-[4px]">Settings</h1>
      <p className="text-[13px] text-muted-foreground mb-[20px]">
        Manage your workspace.
      </p>

      <div className="rounded-[16px] border border-border bg-card p-[16px] mb-[16px] shadow-[var(--shadow)]">
        <div className="flex items-center gap-[10px]">
          <div className="w-[36px] h-[36px] rounded-full grid place-items-center bg-[var(--ink)] shrink-0">
            <GraduationCap className="w-[19px] h-[19px] text-[var(--gold-light)]" strokeWidth={2} />
          </div>
          <div className="font-display font-bold text-[15px]">Guided training</div>
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-[10px] leading-[1.5]">
          Take a voice-guided tour of every feature in HALO — from the Today feed and voice
          commands to invoices, crews, and installing the app. Perfect for getting started or
          training your team.
        </p>
        <button
          onClick={() => setTrainingOpen(true)}
          className="mt-[14px] w-full flex items-center justify-center gap-[8px] rounded-[12px] bg-[var(--ink)] text-white font-display font-bold text-[14px] py-[12px] transition-transform active:scale-[0.98]"
        >
          <Play className="w-[16px] h-[16px]" strokeWidth={0} fill="currentColor" />
          Start guided training
        </button>
      </div>

      <div className="rounded-[16px] border border-border bg-card p-[16px] mb-[16px] shadow-[var(--shadow)]">
        <div className="flex items-center gap-[10px]">
          <div className="w-[36px] h-[36px] rounded-full grid place-items-center bg-[var(--ink)] shrink-0">
            <MapPin className="w-[19px] h-[19px] text-[var(--gold-light)]" strokeWidth={2} />
          </div>
          <div className="font-display font-bold text-[15px]">On-site detection</div>
          {onsiteEnabled && (
            <span className="ml-auto text-[11px] font-display font-bold tracking-[0.1em] uppercase text-[var(--gold-dark)]">
              Active
            </span>
          )}
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-[10px] leading-[1.5]">
          When your phone arrives at one of your apartment communities, HALO recognizes the
          property and prompts you with open work and smart job suggestions — so you can start
          a job on the spot. Each owner turns this on from their own phone. HALO only checks
          location while the app is open.
        </p>
        <input
          className="w-full mt-[12px] bg-[var(--paper)] border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
          placeholder="Your name (e.g. Mike)"
          value={ownerName}
          onChange={(e) => {
            setOwnerName(e.target.value);
            onsiteStorage.setOwner(e.target.value.trim());
          }}
        />
        <button
          onClick={toggleOnsite}
          className={`mt-[12px] w-full flex items-center justify-center gap-[8px] rounded-[12px] font-display font-bold text-[14px] py-[12px] transition-transform active:scale-[0.98] ${
            onsiteEnabled
              ? "bg-card border border-border text-muted-foreground shadow-[var(--shadow)]"
              : "text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)]"
          }`}
        >
          <MapPin className="w-[16px] h-[16px]" strokeWidth={2} />
          {onsiteEnabled ? "Turn off on this phone" : "Turn on for this phone"}
        </button>
        <button
          onClick={testDetection}
          disabled={testing || checkArrival.isPending}
          className="mt-[10px] w-full flex items-center justify-center gap-[8px] rounded-[12px] bg-[var(--ink)] text-white font-display font-bold text-[14px] py-[12px] transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {testing || checkArrival.isPending ? (
            <Loader2 className="w-[16px] h-[16px] animate-spin" />
          ) : (
            <Radar className="w-[16px] h-[16px]" strokeWidth={2} />
          )}
          {testing || checkArrival.isPending ? "Checking your location…" : "Test it now"}
        </button>
        <p className="text-[11.5px] text-muted-foreground mt-[8px] text-center">
          Checks where you are right now and pops the arrival prompt if a property matches.
        </p>
      </div>

      <div className="rounded-[16px] border border-border bg-card p-[16px] mb-[16px] shadow-[var(--shadow)]">
        <div className="flex items-center gap-[10px]">
          <div className="w-[36px] h-[36px] rounded-full grid place-items-center bg-[var(--ink)] shrink-0">
            <Sparkles className="w-[19px] h-[19px] text-[var(--gold-light)]" strokeWidth={2} />
          </div>
          <div className="font-display font-bold text-[15px]">Autopilot auto-approve</div>
          <div className="ml-auto">
            <Switch
              checked={bizSettings?.autopilotAutoApprove ?? false}
              onCheckedChange={setAutoApprove}
              disabled={updateSettings.isPending}
              data-testid="switch-autopilot-auto-approve"
            />
          </div>
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-[10px] leading-[1.5]">
          Autopilot spots overdue invoices and ghosted job offers, then proposes a fix —
          like emailing a payment reminder or re-sending the job to your crews. Leave this
          off to approve each move from the Today page, or turn it on to let HALO act
          immediately on its own.
        </p>
      </div>

      <ArrivalSheet open={testOpen} onOpenChange={setTestOpen} result={testResult} />

      <div className="rounded-[16px] border border-destructive/30 bg-[rgba(220,38,38,0.05)] p-[16px]">
        <div className="font-display font-bold text-[15px] text-destructive">Start fresh</div>
        <p className="text-[12.5px] text-muted-foreground mt-[6px] leading-[1.5]">
          Wipes all sample/demo data — properties, jobs, invoices, expenses, crews,
          leads and more — so you can begin with a clean slate. Your company info and
          bank connection are kept. This can't be undone.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="mt-[14px] w-full flex items-center justify-center gap-[8px] rounded-[12px] border border-destructive/40 text-destructive font-display font-bold text-[14px] py-[12px] transition-transform active:scale-[0.98]">
              <Trash2 className="w-[17px] h-[17px]" strokeWidth={2} />
              Wipe all data & start clean
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Wipe all data?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every property, job, invoice, expense, crew,
                lead, and message. Your company info and bank connection stay. This
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={wipeData}
                disabled={reset.isPending}
                className="bg-destructive hover:bg-destructive/90 text-white"
              >
                {reset.isPending ? "Clearing…" : "Yes, wipe everything"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <TrainingCenter open={trainingOpen} onOpenChange={setTrainingOpen} />
    </div>
  );
}
