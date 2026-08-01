import { useState, useRef, useEffect } from 'react';
import { X, Tag, Calendar, Flag, CheckSquare, MessageSquare, Send, Loader2, ImagePlus, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SendToOfficeButton } from './SendToOfficeButton';
import { CardModuleDetail } from './CardModuleDetail';
import {
  useUpdateClientBoardCard,
  useListClientCardComments,
  useAddClientCardComment,
  useMarkClientCardCommentsSeen,
  getListClientCardCommentsQueryKey,
  getGetClientBoardQueryKey,
  getGetClientPmBoardQueryKey
} from '@workspace/api-client-react';
import { uploadFile } from '@/lib/upload';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import type { ClientBoardCardView } from '@workspace/api-client-react';

interface CardDetailPanelProps {
  card: ClientBoardCardView;
  token: string;
  readOnly: boolean;
  onClose: () => void;
}

export function CardDetailPanel({ card, token, readOnly, onClose }: CardDetailPanelProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [labels, setLabels] = useState<string[]>(card.labels || []);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [checklist, setChecklist] = useState(card.checklist || []);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [notes, setNotes] = useState(card.notes || '');
  const [commentBody, setCommentBody] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateCard = useUpdateClientBoardCard();
  const { data: commentsData, isLoading: commentsLoading } = useListClientCardComments(
    token,
    card.cardKey,
    { query: { queryKey: getListClientCardCommentsQueryKey(token, card.cardKey), refetchInterval: 4000 } }
  );
  const addComment = useAddClientCardComment();
  const markSeen = useMarkClientCardCommentsSeen();

  const comments = commentsData?.comments || [];

  // Opening the thread marks office messages read — clears the client's
  // card badge and the board-level unread count.
  const unreadFromOffice = comments.filter((c) => c.authorType === 'office' && !c.read).length;
  useEffect(() => {
    // Guests can read the thread but must not clear unread state (the server
    // rejects them too) — badges and digest eligibility ride on readAt.
    if (readOnly || unreadFromOffice === 0) return;
    markSeen.mutate(
      { token, cardKey: card.cardKey },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientCardCommentsQueryKey(token, card.cardKey) });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadFromOffice, card.cardKey]);

  const handlePickFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    const result = await uploadFile(file);
    setUploading(false);
    if (result) setAttachment({ name: file.name || 'Photo', path: result.objectPath });
  };

  // Auto-scroll comments to bottom when new ones arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handleAddLabel = () => {
    if (!newLabelInput.trim() || readOnly) return;
    const newLabels = [...labels, newLabelInput.trim()];
    setLabels(newLabels);
    setNewLabelInput('');
    updateCard.mutate(
      { token, cardKey: card.cardKey, data: { labels: newLabels } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        }
      }
    );
  };

  const handleRemoveLabel = (idx: number) => {
    if (readOnly) return;
    const newLabels = labels.filter((_, i) => i !== idx);
    setLabels(newLabels);
    updateCard.mutate(
      { token, cardKey: card.cardKey, data: { labels: newLabels } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        }
      }
    );
  };

  const handleAddCheckItem = () => {
    if (!newCheckItem.trim() || readOnly) return;
    const newChecklist = [
      ...checklist,
      { id: Date.now().toString(), text: newCheckItem.trim(), done: false }
    ];
    setChecklist(newChecklist);
    setNewCheckItem('');
    updateCard.mutate(
      { token, cardKey: card.cardKey, data: { checklist: newChecklist } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        }
      }
    );
  };

  const handleToggleCheckItem = (id: string) => {
    if (readOnly) return;
    const newChecklist = checklist.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    );
    setChecklist(newChecklist);
    updateCard.mutate(
      { token, cardKey: card.cardKey, data: { checklist: newChecklist } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        }
      }
    );
  };

  const handleRemoveCheckItem = (id: string) => {
    if (readOnly) return;
    const newChecklist = checklist.filter(item => item.id !== id);
    setChecklist(newChecklist);
    updateCard.mutate(
      { token, cardKey: card.cardKey, data: { checklist: newChecklist } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        }
      }
    );
  };

  const handleNotesBlur = () => {
    if (readOnly || notes === card.notes) return;
    updateCard.mutate(
      { token, cardKey: card.cardKey, data: { notes } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        }
      }
    );
  };

  const handleSendComment = () => {
    if (!commentBody.trim() && !attachment) return;
    addComment.mutate(
      {
        token,
        cardKey: card.cardKey,
        data: {
          body: commentBody.trim(),
          attachmentName: attachment?.name ?? null,
          attachmentPath: attachment?.path ?? null,
        },
      },
      {
        onSuccess: () => {
          setCommentBody('');
          setAttachment(null);
          queryClient.invalidateQueries({ queryKey: getListClientCardCommentsQueryKey(token, card.cardKey) });
          queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          queryClient.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        }
      }
    );
  };

  const checklistProgress = checklist.length > 0 
    ? Math.round((checklist.filter(c => c.done).length / checklist.length) * 100)
    : 0;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-background border-l border-border shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Card Details</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-testid="button-close-panel"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-6 py-4">
        <div className="space-y-6">
          {/* Title */}
          <div>
            <h3 className="text-xl font-bold text-foreground mb-1">{card.title}</h3>
            {card.subtitle && (
              <p className="text-sm text-muted-foreground">{card.subtitle}</p>
            )}
            {card.description && (
              <p className="text-sm text-muted-foreground mt-1">{card.description}</p>
            )}
          </div>

          {/* Meta info */}
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {card.dueOn && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                <span>Due {card.dueOn}</span>
              </div>
            )}
            {card.priority && (
              <div className="flex items-center gap-1.5">
                <Flag className="w-4 h-4" />
                <span className="capitalize">{card.priority}</span>
              </div>
            )}
          </div>

          {card.module && (
            <>
              <Separator className="my-6" />
              <CardModuleDetail module={card.module} token={token} />
            </>
          )}

          <Separator className="my-6" />

          {/* Send to Office (custom cards only) */}
          {card.cardKey.startsWith('custom:') && !readOnly && (
            <>
              <div>
                <SendToOfficeButton card={card} token={token} />
              </div>
              <Separator />
            </>
          )}

          {/* Labels */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-semibold">Labels</Label>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {labels.map((label, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="gap-1.5 pr-1"
                  data-testid={`label-${idx}`}
                >
                  {label}
                  {!readOnly && (
                    <button
                      onClick={() => handleRemoveLabel(idx)}
                      className="ml-1 hover:text-destructive"
                      data-testid={`button-remove-label-${idx}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <Input
                  placeholder="Add label..."
                  value={newLabelInput}
                  onChange={(e) => setNewLabelInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddLabel()}
                  className="text-sm"
                  data-testid="input-new-label"
                />
                <Button
                  size="sm"
                  onClick={handleAddLabel}
                  disabled={!newLabelInput.trim()}
                  data-testid="button-add-label"
                >
                  Add
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-semibold">Checklist</Label>
              </div>
              {checklist.length > 0 && (
                <span className="text-xs text-muted-foreground font-mono">
                  {checklistProgress}%
                </span>
              )}
            </div>
            {checklist.length > 0 && (
              <div className="mb-3 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${checklistProgress}%` }}
                />
              </div>
            )}
            <div className="space-y-2 mb-3">
              {checklist.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 group"
                  data-testid={`checklist-item-${item.id}`}
                >
                  <Checkbox
                    checked={item.done}
                    onCheckedChange={() => handleToggleCheckItem(item.id)}
                    disabled={readOnly}
                    className="mt-0.5"
                    data-testid={`checkbox-${item.id}`}
                  />
                  <span
                    className={`flex-1 text-sm ${
                      item.done ? 'line-through text-muted-foreground' : 'text-foreground'
                    }`}
                  >
                    {item.text}
                  </span>
                  {!readOnly && (
                    <button
                      onClick={() => handleRemoveCheckItem(item.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      data-testid={`button-remove-check-${item.id}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <Input
                  placeholder="Add item..."
                  value={newCheckItem}
                  onChange={(e) => setNewCheckItem(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCheckItem()}
                  className="text-sm"
                  data-testid="input-new-check-item"
                />
                <Button
                  size="sm"
                  onClick={handleAddCheckItem}
                  disabled={!newCheckItem.trim()}
                  data-testid="button-add-check-item"
                >
                  Add
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* Notes */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Notes</Label>
            <Textarea
              placeholder="Add notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              rows={4}
              disabled={readOnly}
              className="resize-none text-sm"
              data-testid="textarea-notes"
            />
          </div>

          <Separator />

          {/* Messages — Slack-style thread with the office */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-semibold">Messages</Label>
              {comments.length > 0 && (
                <span className="text-xs text-muted-foreground">({comments.length})</span>
              )}
            </div>

            <div className="space-y-3 mb-4 max-h-[300px] overflow-y-auto" ref={scrollRef}>
              {commentsLoading && (
                <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading messages...
                </div>
              )}
              {!commentsLoading && comments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No messages yet — ask the office anything about this card
                </p>
              )}
              {comments.map((comment) => {
                const isOffice = comment.authorType === 'office';
                const url = comment.attachmentUrl ?? null;
                const isImg = !!url && /\.(png|jpe?g|webp|gif|heic)$/i.test(comment.attachmentName ?? url);
                return (
                  <div
                    key={comment.id}
                    className={`flex flex-col max-w-[85%] ${isOffice ? 'mr-auto items-start' : 'ml-auto items-end'}`}
                    data-testid={`comment-${comment.id}`}
                  >
                    <div className="text-[10px] font-semibold text-muted-foreground mb-1 px-1">
                      {comment.authorName} · {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    </div>
                    <div
                      className={`px-3 py-2 rounded-2xl text-sm border ${
                        isOffice
                          ? 'bg-accent/50 border-accent-border rounded-tl-sm'
                          : 'bg-primary text-primary-foreground border-transparent rounded-tr-sm'
                      }`}
                    >
                      {url && (
                        isImg ? (
                          <a href={url} target="_blank" rel="noreferrer" className="block mb-1">
                            <img
                              src={url}
                              alt={comment.attachmentName ?? 'Attachment'}
                              className="rounded-lg max-h-48 max-w-full object-cover"
                            />
                          </a>
                        ) : (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 underline mb-1 text-sm"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                            {comment.attachmentName ?? 'Attachment'}
                          </a>
                        )
                      )}
                      {comment.body && <p className="whitespace-pre-wrap">{comment.body}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {!readOnly && (
            <div className="space-y-2">
              {attachment && (
                <div className="flex items-center gap-2 text-xs bg-muted rounded-lg px-3 py-2">
                  <Paperclip className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate flex-1">{attachment.name}</span>
                  <button onClick={() => setAttachment(null)} data-testid="button-remove-attachment">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    handlePickFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                  data-testid="input-attachment"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-attach-photo"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                </Button>
                <Textarea
                  placeholder="Message the office..."
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendComment();
                    }
                  }}
                  rows={2}
                  className="resize-none text-sm"
                  data-testid="textarea-comment"
                />
                <Button
                  size="sm"
                  onClick={handleSendComment}
                  disabled={(!commentBody.trim() && !attachment) || addComment.isPending || uploading}
                  className="shrink-0"
                  data-testid="button-send-comment"
                >
                  {addComment.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
