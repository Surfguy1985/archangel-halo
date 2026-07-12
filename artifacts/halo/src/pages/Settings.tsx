import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useResetAllData } from "@workspace/api-client-react";
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
import { Trash2, GraduationCap, Play } from "lucide-react";
import { TrainingCenter } from "@/components/TrainingCenter";

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reset = useResetAllData();
  const [trainingOpen, setTrainingOpen] = useState(false);

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
