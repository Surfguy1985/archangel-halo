import React, { useState, useRef, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { 
  useGetWalk, 
  useGetProperty,
  useAddWalkCapture,
  useDeleteWalkCapture,
  useDeleteWalk,
  useParseWalkVoice,
  WalkCapture,
  WalkVoiceResultItemsItem,
  getGetWalkQueryKey,
  getGetPropertyQueryKey
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Camera, 
  Check, 
  ChevronRight, 
  Image as ImageIcon, 
  Loader2, 
  Trash2, 
  X,
  MapPin,
  Tag,
  CheckCircle2,
  MoreVertical,
  Plus,
  Mic
} from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerDescription } from '@/components/ui/drawer';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function CaptureScreen() {
  const [, params] = useRoute('/walk/:id');
  const [, setLocation] = useLocation();
  const walkId = params?.id || '';
  const { toast } = useToast();
  
  // Geolocation
  const [location, setLocationData] = useState<{lat: number, lng: number} | null>(null);
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocationData({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}, // ignore errors, non-blocking
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  }, []);

  // Data fetching
  const { data: walk, isLoading: isLoadingWalk, refetch: refetchWalk } = useGetWalk(walkId, {
    request: { credentials: 'include' },
    query: { enabled: !!walkId, queryKey: getGetWalkQueryKey(walkId) }
  });

  const propertyId = walk?.walk?.propertyId;
  const { data: property, isLoading: isLoadingProperty } = useGetProperty(propertyId || '', {
    request: { credentials: 'include' },
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId || '') }
  });

  // Upload & Tag State
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Tagging Drawer State
  const [isTagging, setIsTagging] = useState(false);
  const [currentPhotoPath, setCurrentPhotoPath] = useState<string>('');
  
  // Tag Form State
  const [lastUnit, setLastUnit] = useState<string>('');
  const [formUnit, setFormUnit] = useState<string>('');
  const [formService, setFormService] = useState<string>('');
  const [formUnitPrice, setFormUnitPrice] = useState<number | undefined>(undefined);
  const [formQty, setFormQty] = useState<number>(1);
  const [formNote, setFormNote] = useState<string>('');

  // Delete Action Sheet State
  const [deleteDrawerOpen, setDeleteDrawerOpen] = useState(false);
  const [captureToDelete, setCaptureToDelete] = useState<string | null>(null);

  // Hold-to-talk state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [voiceQueue, setVoiceQueue] = useState<WalkVoiceResultItemsItem[]>([]);
  const [voiceIndex, setVoiceIndex] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdActiveRef = useRef(false);
  const parseVoice = useParseWalkVoice({ request: { credentials: 'include' } });

  // Mutations
  const addCapture = useAddWalkCapture({ request: { credentials: 'include' } });
  const deleteCapture = useDeleteWalkCapture({ request: { credentials: 'include' } });
  const deleteWalk = useDeleteWalk({ request: { credentials: 'include' } });

  const handleDiscardWalk = () => {
    if (!confirm('Discard this walk and all its photos? This cannot be undone.')) return;
    deleteWalk.mutate(
      { id: walkId },
      {
        onSuccess: () => {
          toast({ title: 'Walk discarded' });
          setLocation('/');
        },
        onError: (err: any) => {
          toast({
            title: 'Could not discard walk',
            description: err?.data?.error || err?.message || 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  // ----- Hold-to-talk -----
  const openVoiceDraft = (items: WalkVoiceResultItemsItem[], index: number) => {
    const item = items[index];
    if (!item) return;
    const svc = item.service ?? '';
    const bookMatch = property?.priceItems?.find(
      p => p.service.trim().toLowerCase() === svc.trim().toLowerCase()
    );
    setCurrentPhotoPath('');
    setFormUnit(item.unitNo ?? lastUnit);
    setFormService(bookMatch ? bookMatch.service : svc);
    setFormUnitPrice(bookMatch?.rate || undefined);
    setFormQty(item.qty && item.qty > 0 ? item.qty : 1);
    setFormNote(item.note ?? '');
    setIsTagging(true);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    if (isRecording || parseVoice.isPending) return;
    holdActiveRef.current = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast({ title: 'Voice not supported', description: 'This browser cannot record audio.', variant: 'destructive' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // If the finger lifted while the permission prompt was up, bail out.
      if (!holdActiveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        cleanupStream();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 2000) return; // accidental tap — ignore quietly
        void submitVoiceClip(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setIsRecording(true);
      setRecordSecs(0);
      timerRef.current = setInterval(() => {
        setRecordSecs(s => {
          if (s + 1 >= 60) stopRecording(); // hard cap
          return s + 1;
        });
      }, 1000);
    } catch {
      toast({
        title: 'Microphone blocked',
        description: 'Allow microphone access to talk your items in.',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    holdActiveRef.current = false;
    stopTimer();
    setIsRecording(false);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    else cleanupStream();
  };

  useEffect(() => () => { stopTimer(); cleanupStream(); }, []);

  const submitVoiceClip = async (blob: Blob) => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('Could not read recording'));
      reader.readAsDataURL(blob);
    });
    parseVoice.mutate(
      { id: walkId, data: { audioBase64: base64, mimeType: blob.type || 'audio/webm' } },
      {
        onSuccess: (result) => {
          if (!result.items.length) {
            toast({
              title: 'No items caught',
              description: `Heard: "${result.transcript}" — try naming the unit and the work.`,
              variant: 'destructive',
            });
            return;
          }
          setVoiceQueue(result.items);
          setVoiceIndex(0);
          openVoiceDraft(result.items, 0);
        },
        onError: (err: any) => {
          toast({
            title: 'Try that again',
            description: err?.data?.error || err?.message || 'Could not process the recording.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const advanceVoiceQueue = () => {
    if (voiceQueue.length === 0) return;
    const next = voiceIndex + 1;
    if (next < voiceQueue.length) {
      setVoiceIndex(next);
      openVoiceDraft(voiceQueue, next);
    } else {
      setVoiceQueue([]);
      setVoiceIndex(0);
    }
  };

  // Handle Photo Capture
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // 1. Request URL
      const reqRes = await fetch('/api/storage/uploads/request-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!reqRes.ok) throw new Error('Failed to request upload URL');
      const { uploadURL, objectPath } = await reqRes.json();

      // 2. Upload file
      const uploadRes = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Failed to upload photo');

      // 3. Open tag drawer
      setCurrentPhotoPath(objectPath);
      setFormUnit(lastUnit);
      setFormService('');
      setFormUnitPrice(undefined);
      setFormQty(1);
      setFormNote('');
      setIsTagging(true);
      
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = ''; // reset input
    }
  };

  // Handle Tag Submit
  const handleSaveCapture = () => {
    if (!formService) {
      toast({ title: 'Missing scope', description: 'Please select a service or enter Other', variant: 'destructive' });
      return;
    }

    addCapture.mutate(
      { 
        id: walkId,
        data: {
          unitNo: formUnit || 'Common Area',
          storagePath: currentPhotoPath || undefined,
          service: formService,
          qty: formQty,
          unitPrice: formUnitPrice,
          note: formNote,
          lat: location?.lat,
          lng: location?.lng
        }
      },
      {
        onSuccess: () => {
          setLastUnit(formUnit); // Remember for next time
          setIsTagging(false);
          advanceVoiceQueue(); // next prefilled voice draft, if any
          refetchWalk(); // refresh list
          toast({ 
            title: (
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-3 h-3 text-primary-foreground stroke-[3]" />
                </div>
                <span>Item captured</span>
              </div>
            ) as any
          });
        },
        onError: (err: any) => {
          toast({ title: 'Failed to save', description: err?.data?.error || err?.message, variant: 'destructive' });
        }
      }
    );
  };

  const openDeleteOptions = (id: string) => {
    setCaptureToDelete(id);
    setDeleteDrawerOpen(true);
  };

  const confirmDelete = () => {
    if (!captureToDelete) return;
    deleteCapture.mutate(
      { id: captureToDelete },
      {
        onSuccess: () => {
          refetchWalk();
          setDeleteDrawerOpen(false);
          setCaptureToDelete(null);
        }
      }
    );
  };

  if (isLoadingWalk || isLoadingProperty) {
    return <div className="flex h-screen items-center justify-center bg-background"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;
  }

  if (!walk?.walk) {
    return <div className="p-8 text-center text-muted-foreground">Walk not found</div>;
  }

  // Group captures by unit
  const capturesByUnit = (walk.captures || []).reduce((acc: Record<string, WalkCapture[]>, cap) => {
    const u = cap.unitNo || 'Unassigned';
    if (!acc[u]) acc[u] = [];
    acc[u].push(cap);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {/* Header Area */}
      <div className="bg-background pt-4 pb-3 px-5 shrink-0 flex items-center justify-between z-10 border-b border-black/[0.03]">
        <div className="min-w-0 pr-4">
          <h2 className="font-extrabold text-xl tracking-tight text-foreground truncate">{walk.walk.propertyName}</h2>
          <p className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-widest mt-0.5">{walk.walk.kind} Walk</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDiscardWalk}
            disabled={deleteWalk.isPending}
            data-testid="button-discard-walk"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full w-10 h-10"
            aria-label="Discard walk"
          >
            {deleteWalk.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setLocation(`/walk/${walkId}/review`)}
            data-testid="button-finish-walk"
            className="font-extrabold rounded-full px-4 h-10 border-2 hover:bg-foreground hover:text-background transition-colors text-sm"
          >
            Review
          </Button>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6 space-y-6 relative z-0 scroll-smooth">
        {Object.keys(capturesByUnit).length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-700 delay-100 pb-12">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-2 shadow-inner">
              <Camera className="w-8 h-8 text-muted-foreground opacity-50" />
            </div>
            <div>
              <p className="font-extrabold text-xl text-foreground">No items yet</p>
              <p className="font-medium text-sm text-muted-foreground mt-1.5 max-w-[200px] mx-auto">Tap the green button below to start walking.</p>
            </div>
          </div>
        ) : (
          Object.entries(capturesByUnit).map(([unit, caps]) => (
            <div key={unit} className="space-y-3 animate-in slide-in-from-bottom-4 fade-in duration-300">
              <div className="flex items-center gap-3 sticky top-[-12px] bg-background/95 backdrop-blur-md py-3 z-10">
                <div className="px-3.5 py-1 bg-foreground text-background font-black rounded-full text-xs shadow-sm tracking-wide">
                  {unit}
                </div>
                <div className="h-px bg-black/[0.05] flex-1" />
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                {caps.map((cap, index) => (
                  <div 
                    key={cap.id} 
                    className="bg-card rounded-2xl p-2.5 border border-black/[0.04] shadow-sm flex items-center gap-3 animate-in slide-in-from-bottom-2 fade-in fill-mode-both"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="w-16 h-16 shrink-0 bg-muted rounded-xl overflow-hidden relative shadow-inner">
                      {cap.storagePath ? (
                        <img 
                          src={`/api/storage/objects${cap.storagePath}`} 
                          alt="capture" 
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <Mic className="w-6 h-6" />
                        </div>
                      )}
                      <div className="absolute inset-0 ring-1 ring-inset ring-black/10 rounded-xl" />
                    </div>
                    <div className="flex-1 min-w-0 py-1">
                      <div className="font-bold text-foreground truncate text-base flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary fill-primary text-primary-foreground shrink-0" />
                        <span className="truncate">{cap.service}</span>
                      </div>
                      <div className="text-xs font-bold text-muted-foreground mt-1 flex gap-2">
                        <span className="bg-muted px-1.5 py-0.5 rounded text-foreground/70">Qty {cap.qty}</span>
                        {cap.unitPrice ? <span className="text-foreground/70 font-mono">${cap.unitPrice}</span> : null}
                      </div>
                      {cap.note && <div className="text-[11px] text-muted-foreground mt-1 truncate">"{cap.note}"</div>}
                    </div>
                    <button 
                      onClick={() => openDeleteOptions(cap.id)}
                      className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="shrink-0 bg-background/90 backdrop-blur-md border-t border-black/[0.03] p-4 pb-6 flex justify-center gap-3 z-20">
        <input 
          type="file" 
          accept="image/*" 
          capture="environment" 
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button 
          className="flex-1 max-w-sm h-14 rounded-full shadow-float text-lg font-extrabold active:scale-[0.98] transition-all"
          size="lg"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          data-testid="button-capture-photo"
        >
          {isUploading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <>
              <Plus className="w-6 h-6 mr-2 stroke-[3]" />
              ADD ITEM
            </>
          )}
        </Button>
        <button
          className={`h-14 w-14 shrink-0 rounded-full flex items-center justify-center shadow-float transition-all select-none touch-none active:scale-95 ${
            isRecording
              ? 'bg-destructive text-destructive-foreground animate-pulse'
              : parseVoice.isPending
                ? 'bg-muted text-muted-foreground'
                : 'bg-foreground text-background'
          }`}
          onPointerDown={(e) => { e.preventDefault(); void startRecording(); }}
          onPointerUp={stopRecording}
          onPointerLeave={() => { if (isRecording) stopRecording(); }}
          onPointerCancel={stopRecording}
          onContextMenu={(e) => e.preventDefault()}
          disabled={parseVoice.isPending || isUploading}
          aria-label="Hold to talk"
          data-testid="button-hold-to-talk"
        >
          {parseVoice.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Mic className="w-6 h-6" />}
        </button>
      </div>

      {/* Recording overlay chip */}
      {isRecording && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-30 bg-destructive text-destructive-foreground rounded-full px-5 py-2.5 shadow-float flex items-center gap-2 font-extrabold text-sm animate-in fade-in slide-in-from-bottom-2" data-testid="chip-recording">
          <span className="w-2.5 h-2.5 rounded-full bg-destructive-foreground animate-pulse" />
          Listening… {recordSecs}s — release when done
        </div>
      )}

      {/* Delete Options Drawer */}
      <Drawer open={deleteDrawerOpen} onOpenChange={setDeleteDrawerOpen}>
        <DrawerContent className="bg-card rounded-t-3xl border-0">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-xl font-extrabold">Photo Options</DrawerTitle>
            <DrawerDescription>Manage this captured item</DrawerDescription>
          </DrawerHeader>
          <div className="p-4 pb-8 space-y-3">
            <Button 
              variant="destructive" 
              className="w-full h-14 rounded-2xl text-lg font-bold"
              onClick={confirmDelete}
            >
              <Trash2 className="w-5 h-5 mr-2" />
              Delete Item
            </Button>
            <Button 
              variant="secondary" 
              className="w-full h-14 rounded-2xl text-lg font-bold bg-muted hover:bg-muted/80"
              onClick={() => setDeleteDrawerOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Tagging Drawer */}
      <Drawer open={isTagging} onOpenChange={setIsTagging} dismissible={false}>
        <DrawerContent className="max-h-[95dvh] flex flex-col bg-background border-0 rounded-t-3xl overflow-hidden">
          <DrawerHeader className="border-b border-black/[0.05] pb-4 shrink-0 bg-background z-10 px-6 pt-6 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <DrawerTitle className="text-2xl font-extrabold">Item Details</DrawerTitle>
              {voiceQueue.length > 0 && (
                <span className="text-[11px] font-extrabold bg-primary text-primary-foreground rounded-full px-2.5 py-1 uppercase tracking-wide" data-testid="badge-voice-item">
                  Voice {voiceIndex + 1}/{voiceQueue.length}
                </span>
              )}
            </div>
            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full bg-muted hover:bg-muted/80" onClick={() => { setIsTagging(false); advanceVoiceQueue(); }}>
              <X className="w-5 h-5" />
            </Button>
          </DrawerHeader>
          
          <div className="p-5 overflow-y-auto flex-1 space-y-6 scroll-smooth">
            {currentPhotoPath && (
              <div className="w-full h-40 rounded-3xl overflow-hidden bg-card border border-black/[0.05] shadow-inner relative group shrink-0">
                <img src={`/api/storage/objects${currentPhotoPath}`} className="w-full h-full object-cover" alt="Current capture" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/0 to-black/20" />
              </div>
            )}

            <div className="space-y-5">
              {/* Unit Input */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Unit / Location</label>
                <Input 
                  value={formUnit} 
                  onChange={e => setFormUnit(e.target.value)} 
                  placeholder="e.g. 101, Gym, Hallway"
                  className="h-12 text-base font-bold rounded-xl border-0 bg-muted focus-visible:ring-2 focus-visible:ring-primary px-4 placeholder:font-normal placeholder:text-muted-foreground/60"
                  data-testid="input-unit"
                />
              </div>

              {/* Scope Picker */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1">What needs work?</label>
                <div className="grid grid-cols-1 gap-2 max-h-[30vh] overflow-y-auto pr-1 pb-1 -mr-1">
                  {property?.priceItems?.map(item => {
                    const isSelected = formService === item.service;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setFormService(item.service); setFormUnitPrice(item.rate || undefined); }}
                        className={`p-3 rounded-xl border text-left flex justify-between items-center transition-all ${
                          isSelected 
                            ? 'border-transparent bg-foreground text-background ring-[3px] ring-primary/20 shadow-md' 
                            : 'border-black/[0.05] bg-card text-foreground hover:border-black/10'
                        }`}
                      >
                        <span className="font-bold text-sm">{item.service}</span>
                        {item.rate ? (
                          <span className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded ${isSelected ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'}`}>
                            ${item.rate}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                  
                  {/* Custom Scope */}
                  <div className="pt-2 mt-1 space-y-2 border-t border-black/[0.05]">
                    <Input 
                      value={!property?.priceItems?.find(p => p.service === formService) ? formService : ''}
                      onChange={e => { setFormService(e.target.value); setFormUnitPrice(undefined); }}
                      placeholder="Type custom service..."
                      className="h-12 rounded-xl border-0 bg-card shadow-sm focus-visible:ring-2 focus-visible:ring-primary px-4 font-bold text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Qty & Note inline */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-2">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Qty</label>
                  <Input 
                    type="number" 
                    min="1" 
                    value={formQty} 
                    onChange={e => setFormQty(Number(e.target.value))}
                    className="h-12 text-lg font-black text-center rounded-xl border-0 bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Note</label>
                  <Input 
                    value={formNote} 
                    onChange={e => setFormNote(e.target.value)}
                    placeholder="Optional detail"
                    className="h-12 rounded-xl border-0 bg-muted focus-visible:ring-2 focus-visible:ring-primary px-4 placeholder:text-muted-foreground/60 text-sm"
                  />
                </div>
              </div>

            </div>
          </div>

          <DrawerFooter className="border-t border-black/[0.05] p-5 shrink-0 bg-background">
            <Button 
              size="lg" 
              className="h-14 text-lg font-extrabold w-full rounded-2xl shadow-float"
              onClick={handleSaveCapture}
              disabled={addCapture.isPending}
            >
              {addCapture.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : 'SAVE ITEM'}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
