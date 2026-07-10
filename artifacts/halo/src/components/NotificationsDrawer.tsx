import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useListNotifications, useReadNotification } from "@workspace/api-client-react";

export function NotificationsDrawer({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { data: notifications, isLoading } = useListNotifications();
  const readMutation = useReadNotification();

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
              <div 
                key={n.id} 
                className={`flex gap-[10px] bg-card rounded-[14px] shadow-[var(--shadow)] p-[12px_13px] mb-[9px] cursor-pointer ${n.readAt ? 'opacity-55' : ''}`}
                onClick={() => !n.readAt && readMutation.mutate({ id: n.id })}
              >
                <div className="flex-1">
                  <div className="font-semibold text-[14px]">{n.title}</div>
                  {n.body && <div className="text-[12.5px] text-muted-foreground mt-[1px]">{n.body}</div>}
                </div>
                {n.sentAt && (
                  <div className="text-[11px] text-faint shrink-0 whitespace-nowrap">
                    {new Date(n.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </div>
                )}
              </div>
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
