import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  useListNotifications,
  useReadNotification,
  useDeleteNotification,
  getListNotificationsQueryKey,
  getGetTodayQueryKey,
  type Notification,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const DELETE_THRESHOLD = 88;

function NotificationRow({
  n,
  onRead,
  onDelete,
}: {
  n: Notification;
  onRead: () => void;
  onDelete: (onError: () => void) => void;
}) {
  const [dx, setDx] = useState(0);
  const [removing, setRemoving] = useState(false);
  const startX = useRef<number | null>(null);
  const curDx = useRef(0);
  const dragged = useRef(false);

  const setOffset = (v: number) => {
    curDx.current = v;
    setDx(v);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    dragged.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current === null) return;
    const delta = e.clientX - startX.current;
    if (delta < 0) {
      if (Math.abs(delta) > 4) dragged.current = true;
      setOffset(Math.max(delta, -120));
    } else if (curDx.current !== 0) {
      setOffset(0);
    }
  };
  const finish = () => {
    if (startX.current === null) return;
    startX.current = null;
    if (Math.abs(curDx.current) >= DELETE_THRESHOLD) {
      setRemoving(true);
      setOffset(-400);
      window.setTimeout(() => onDelete(restore), 180);
    } else {
      setOffset(0);
    }
  };
  const restore = () => {
    setRemoving(false);
    setOffset(0);
  };

  return (
    <div
      className="relative mb-[9px] overflow-hidden rounded-[14px]"
      style={{
        transition: removing ? "height 0.18s ease, margin 0.18s ease" : undefined,
      }}
    >
      <div className="absolute inset-0 flex items-center justify-end bg-destructive rounded-[14px] pr-[18px]">
        <Trash2 className="w-[19px] h-[19px] text-destructive-foreground" />
      </div>
      <div
        className={`relative flex gap-[10px] bg-card shadow-[var(--shadow)] p-[12px_13px] rounded-[14px] cursor-pointer touch-pan-y ${n.readAt ? "opacity-55" : ""}`}
        style={{
          transform: `translateX(${dx}px)`,
          transition: startX.current === null ? "transform 0.18s ease" : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onClick={() => {
          if (dragged.current) return;
          if (!n.readAt) onRead();
        }}
      >
        <div className="flex-1">
          <div className="font-semibold text-[14px]">{n.title}</div>
          {n.body && (
            <div className="text-[12.5px] text-muted-foreground mt-[1px]">{n.body}</div>
          )}
        </div>
        {n.sentAt && (
          <div className="text-[11px] text-faint shrink-0 whitespace-nowrap">
            {new Date(n.sentAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function NotificationsDrawer({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { data: notifications, isLoading } = useListNotifications();
  const readMutation = useReadNotification();
  const deleteMutation = useDeleteNotification();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md bg-[var(--paper)] p-0 border-none">
        <SheetHeader className="flex flex-row items-center gap-[8px] p-[18px_18px_10px] text-left">
          <SheetTitle className="font-display text-[20px] font-bold flex-1 m-0">Notifications</SheetTitle>
          <span className="text-[11px] font-semibold text-[var(--gold-dark)] bg-[var(--gold-tint)] rounded-[20px] px-[9px] py-[3px]">AI-triaged</span>
          <button className="btn-ghost rounded-[11px] px-[13px] py-[6px] text-[13.5px] font-semibold ml-[8px]" onClick={() => onOpenChange(false)}>Done</button>
        </SheetHeader>

        <div className="overflow-y-auto p-[4px_18px_30px]">
          {isLoading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-card rounded-[14px]"></div>)}
            </div>
          ) : (
            notifications?.map(n => (
              <NotificationRow
                key={n.id}
                n={n}
                onRead={() =>
                  readMutation.mutate({ id: n.id }, { onSuccess: invalidate })
                }
                onDelete={(onError) =>
                  deleteMutation.mutate(
                    { id: n.id },
                    {
                      onSuccess: invalidate,
                      onError: () => {
                        onError();
                        toast({
                          title: "Couldn't delete",
                          description: "That notification couldn't be removed. Try again.",
                          variant: "destructive",
                        });
                      },
                    },
                  )
                }
              />
            ))
          )}
          {notifications?.length === 0 && (
            <div className="text-[13px] text-muted-foreground py-4 text-center">You're all caught up</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
