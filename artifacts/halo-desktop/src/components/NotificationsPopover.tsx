import { useQueryClient } from "@tanstack/react-query";
import { Trash2, BellOff, CheckCheck } from "lucide-react";
import {
  useListNotifications,
  useReadNotification,
  useDeleteNotification,
  getListNotificationsQueryKey,
  getGetTodayQueryKey,
  type Notification,
} from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function timeLabel(s?: string | null) {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NotificationRow({
  n,
  onRead,
  onDelete,
  deleting,
}: {
  n: Notification;
  onRead: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const when = timeLabel(n.sentAt);
  return (
    <div
      className={`group flex items-start gap-3 px-4 py-3 hover:bg-black/[0.03] transition-colors cursor-pointer ${
        n.readAt ? "opacity-60" : ""
      }`}
      onClick={() => {
        if (!n.readAt) onRead();
      }}
    >
      <span
        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
          n.readAt ? "bg-transparent" : "bg-[var(--gold)]"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-[var(--ink)] leading-snug">
          {n.title}
        </div>
        {n.body && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
            {n.body}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {when && (
          <span className="text-[11px] text-muted-foreground whitespace-nowrap group-hover:hidden">
            {when}
          </span>
        )}
        <button
          className="hidden group-hover:flex w-7 h-7 rounded-md items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
          title="Delete notification"
          aria-label="Delete notification"
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function NotificationsPopover({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: notifications, isLoading } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), refetchInterval: 30_000 },
  });
  const readMutation = useReadNotification();
  const deleteMutation = useDeleteNotification();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
  };

  const unread = (notifications ?? []).filter((n) => !n.readAt);

  const markAllRead = () => {
    Promise.allSettled(
      unread.map(
        (n) =>
          new Promise((resolve, reject) =>
            readMutation.mutate(
              { id: n.id },
              { onSuccess: resolve, onError: reject },
            ),
          ),
      ),
    ).then((results) => {
      invalidate();
      if (results.some((r) => r.status === "rejected")) {
        toast({
          title: "Some notifications couldn't be marked read",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[380px] p-0 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="font-display font-bold text-[var(--ink)] flex-1">
            Notifications
          </span>
          <span className="text-[11px] font-semibold text-[var(--gold-dark)] bg-[var(--gold-tint)] rounded-full px-2.5 py-0.5">
            AI-triaged
          </span>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={markAllRead}
              disabled={readMutation.isPending}
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1" /> Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto divide-y divide-border/60">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <BellOff className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <div className="text-sm">You're all caught up</div>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                deleting={deleteMutation.isPending}
                onRead={() =>
                  readMutation.mutate({ id: n.id }, { onSuccess: invalidate })
                }
                onDelete={() =>
                  deleteMutation.mutate(
                    { id: n.id },
                    {
                      onSuccess: invalidate,
                      onError: () =>
                        toast({
                          title: "Couldn't delete",
                          description:
                            "That notification couldn't be removed. Try again.",
                          variant: "destructive",
                        }),
                    },
                  )
                }
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
