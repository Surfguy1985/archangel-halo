import React, { useState, useRef, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { 
  useGetWalk, 
  useGetProperty,
  useAddWalkCapture,
  useDeleteWalkCapture,
  useDeleteWalk,
  WalkCapture,
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
  Tag
} from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '@/components/ui/drawer';
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
          storagePath: currentPhotoPath,
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
          refetchWalk(); // refresh list
          toast({ title: 'Capture saved' });
        },
        onError: (err: any) => {
          toast({ title: 'Failed to save', description: err?.data?.error || err?.message, variant: 'destructive' });
        }
      }
    );
  };

  const handleDelete = (captureId: string) => {
    if (!confirm('Delete this photo?')) return;
    deleteCapture.mutate(
      { id: captureId },
      {
        onSuccess: () => refetchWalk()
      }
    );
  };

  if (isLoadingWalk || isLoadingProperty) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
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
    <div className="flex flex-col h-[100dvh] bg-muted/20">
      {/* Header */}
      <div className="bg-card p-4 border-b border-border flex justify-between items-center shrink-0">
        <div>
          <h2 className="font-bold text-lg leading-tight">{walk.walk.propertyName}</h2>
          <p className="text-sm text-muted-foreground capitalize">{walk.walk.kind} Walk</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDiscardWalk}
            disabled={deleteWalk.isPending}
            data-testid="button-discard-walk"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Discard walk"
          >
            {deleteWalk.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
          </Button>
          <Button 
            variant="default" 
            onClick={() => setLocation(`/walk/${walkId}/review`)}
            data-testid="button-finish-walk"
            className="font-bold"
          >
            Review
          </Button>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-32">
        {Object.keys(capturesByUnit).length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
            <ImageIcon className="w-16 h-16" />
            <p className="font-medium text-lg">No photos yet.<br/>Tap the camera to start.</p>
          </div>
        ) : (
          Object.entries(capturesByUnit).map(([unit, caps]) => (
            <div key={unit} className="space-y-3">
              <h3 className="font-bold text-lg border-b border-border pb-1">{unit}</h3>
              <div className="grid grid-cols-1 gap-3">
                {caps.map(cap => (
                  <div key={cap.id} className="bg-card rounded-xl border border-border overflow-hidden shadow-sm flex">
                    <div className="w-24 h-24 shrink-0 bg-muted relative">
                      <img 
                        src={`/api/storage/objects${cap.storagePath}`} 
                        alt="capture" 
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-3 flex-1 min-w-0 flex flex-col justify-center">
                      <div className="font-bold text-foreground truncate">{cap.service}</div>
                      <div className="text-sm text-muted-foreground flex justify-between mt-1">
                        <span>Qty: {cap.qty}</span>
                        {cap.unitPrice ? <span>${cap.unitPrice}</span> : null}
                      </div>
                      {cap.note && <div className="text-xs text-muted-foreground mt-1 truncate italic">"{cap.note}"</div>}
                    </div>
                    <button 
                      onClick={() => handleDelete(cap.id)}
                      className="p-4 text-muted-foreground hover:text-destructive transition-colors border-l border-border"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-6 left-0 right-0 max-w-md mx-auto px-4 pointer-events-none">
        <input 
          type="file" 
          accept="image/*" 
          capture="environment" 
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button 
          className="w-full h-20 rounded-full shadow-2xl pointer-events-auto text-xl font-bold"
          size="lg"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          data-testid="button-capture-photo"
        >
          {isUploading ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : (
            <>
              <Camera className="w-8 h-8 mr-3" />
              TAKE PHOTO
            </>
          )}
        </Button>
      </div>

      {/* Tagging Drawer */}
      <Drawer open={isTagging} onOpenChange={setIsTagging} dismissible={false}>
        <DrawerContent className="max-h-[90dvh] flex flex-col bg-card">
          <DrawerHeader className="border-b border-border pb-4 shrink-0">
            <DrawerTitle>Tag Photo</DrawerTitle>
          </DrawerHeader>
          
          <div className="p-4 overflow-y-auto flex-1 space-y-6">
            {currentPhotoPath && (
              <div className="w-full h-48 rounded-xl overflow-hidden bg-muted border border-border">
                <img src={`/api/storage/objects${currentPhotoPath}`} className="w-full h-full object-contain" alt="Current capture" />
              </div>
            )}

            <div className="space-y-4">
              {/* Unit Input */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-muted-foreground">Unit Number</label>
                <Input 
                  value={formUnit} 
                  onChange={e => setFormUnit(e.target.value)} 
                  placeholder="e.g. 101, Common Area"
                  className="h-14 text-lg"
                  data-testid="input-unit"
                />
              </div>

              {/* Scope Picker */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-muted-foreground">Scope / Service</label>
                <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto p-1">
                  {property?.priceItems?.map(item => (
                    <button
                      key={item.id}
                      onClick={() => { setFormService(item.service); setFormUnitPrice(item.rate || undefined); }}
                      className={`p-3 rounded-lg border text-left flex justify-between items-center transition-colors ${
                        formService === item.service ? 'border-primary bg-primary/10' : 'border-border bg-card'
                      }`}
                    >
                      <span className="font-medium">{item.service}</span>
                      {item.rate ? <span className="text-muted-foreground font-mono">${item.rate}</span> : null}
                    </button>
                  ))}
                  
                  {/* Custom Scope */}
                  <div className="pt-2 border-t border-border mt-2 space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground">Custom Scope (Other)</label>
                    <Input 
                      value={!property?.priceItems?.find(p => p.service === formService) ? formService : ''}
                      onChange={e => { setFormService(e.target.value); setFormUnitPrice(undefined); }}
                      placeholder="Type custom service..."
                      className="h-12"
                    />
                  </div>
                </div>
              </div>

              {/* Qty & Note inline */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1 space-y-2">
                  <label className="text-sm font-bold text-muted-foreground">Qty</label>
                  <Input 
                    type="number" 
                    min="1" 
                    value={formQty} 
                    onChange={e => setFormQty(Number(e.target.value))}
                    className="h-14 text-lg text-center"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <label className="text-sm font-bold text-muted-foreground">Note (Optional)</label>
                  <Input 
                    value={formNote} 
                    onChange={e => setFormNote(e.target.value)}
                    placeholder="Add detail..."
                    className="h-14"
                  />
                </div>
              </div>

            </div>
          </div>

          <DrawerFooter className="border-t border-border pt-4 pb-8 shrink-0">
            <Button 
              size="lg" 
              className="h-16 text-xl font-bold w-full"
              onClick={handleSaveCapture}
              disabled={addCapture.isPending}
            >
              {addCapture.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : 'SAVE'}
            </Button>
            <Button 
              variant="outline" 
              className="h-14 text-lg w-full mt-2"
              onClick={() => setIsTagging(false)}
              disabled={addCapture.isPending}
            >
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
