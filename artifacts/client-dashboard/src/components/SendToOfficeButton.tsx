import { useState } from 'react';
import { Send, Check, X, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useSendClientCardToOffice,
  getGetClientBoardQueryKey,
  getGetClientPmBoardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { ClientBoardCardView } from '@workspace/api-client-react';

interface SendToOfficeButtonProps {
  card: ClientBoardCardView;
  token: string;
}

export function SendToOfficeButton({ card, token }: SendToOfficeButtonProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);

  const sendToOffice = useSendClientCardToOffice();

  const isCustomCard = card.cardKey.startsWith('custom:');
  const sentToOffice = card.sentToOffice;

  if (!isCustomCard) {
    return null;
  }

  const handleSend = () => {
    sendToOffice.mutate(
      { token, cardKey: card.cardKey },
      {
        onSuccess: () => {
          setShowDialog(false);
          toast({
            title: 'Sent to office',
            description: 'Your card has been submitted to the office for review.',
          });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        },
        onError: (error: { status?: number; message?: string }) => {
          setShowDialog(false);
          if (error.status === 409) {
            toast({
              title: 'Already sent',
              description: 'This card has already been sent to the office.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Failed to send',
              description: error.message || 'Could not send the card. Please try again.',
              variant: 'destructive',
            });
          }
        },
      }
    );
  };

  if (sentToOffice && sentToOffice.status !== 'declined') {
    const statusIcon = {
      pending: <Clock className="w-4 h-4 text-muted-foreground" />,
      accepted: <Check className="w-4 h-4 text-primary" />,
      declined: <X className="w-4 h-4 text-destructive" />,
    }[sentToOffice.status];

    const statusLabel = {
      pending: 'Pending review',
      accepted: 'Accepted',
      declined: 'Declined',
    }[sentToOffice.status];

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted text-sm">
        {statusIcon}
        <span className="font-medium">{statusLabel}</span>
        {sentToOffice.note && (
          <span className="text-muted-foreground">— {sentToOffice.note}</span>
        )}
      </div>
    );
  }

  const wasDeclined = sentToOffice?.status === 'declined';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {wasDeclined && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted text-sm"
            data-testid="status-declined"
          >
            <X className="w-4 h-4 text-destructive" />
            <span className="font-medium">Declined</span>
            {sentToOffice?.note && (
              <span className="text-muted-foreground">— {sentToOffice.note}</span>
            )}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDialog(true)}
          className="gap-2"
          data-testid="button-send-to-office"
        >
          <Send className="w-4 h-4" />
          {wasDeclined ? 'Send again' : 'Send to office'}
        </Button>
      </div>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{wasDeclined ? 'Send card again?' : 'Send card to office?'}</AlertDialogTitle>
            <AlertDialogDescription>
              This will submit your custom card to the office for review. They'll be notified
              and can accept or decline your request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-send">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSend}
              disabled={sendToOffice.isPending}
              data-testid="button-confirm-send"
            >
              {sendToOffice.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
