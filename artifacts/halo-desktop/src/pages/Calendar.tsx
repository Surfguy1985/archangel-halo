import { useGetCalendar } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { startOfMonth, endOfMonth, format } from "date-fns";

export default function Calendar() {
  const start = startOfMonth(new Date());
  const end = endOfMonth(new Date());
  
  const { data, isLoading } = useGetCalendar({
    from: format(start, "yyyy-MM-dd"),
    to: format(end, "yyyy-MM-dd")
  });

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500 flex flex-col h-screen">
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Calendar</h1>
          <p className="text-muted-foreground">Unified schedule & jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 border border-border rounded-md bg-card hover:bg-black/5 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-medium px-4">{format(start, "MMMM yyyy")}</span>
          <button className="p-2 border border-border rounded-md bg-card hover:bg-black/5 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </header>

      {isLoading ? (
        <Skeleton className="flex-1 w-full rounded-xl" />
      ) : (
        <div className="flex-1 bg-card rounded-xl border border-border shadow-sm flex items-center justify-center text-muted-foreground flex-col gap-4">
          <CalendarIcon className="w-12 h-12 opacity-20" />
          <p>Calendar grid view coming soon...</p>
          <p className="text-xs">{data?.events.length || 0} events this month</p>
        </div>
      )}
    </div>
  );
}
