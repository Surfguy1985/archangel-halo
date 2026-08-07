import { useCallback, useEffect, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useUploadPortalPhoto } from '@workspace/api-client-react';

const QUEUE_KEY = 'halo_photo_queue';
const MAX_DIMENSION = 1920;
const COMPRESS = 0.82;
const MAX_SIZE_BYTES = 1_500_000;

type QueueItem = {
  id: string;
  uri: string;
  phase: 'before' | 'after' | null;
  jobId: string | null;
  takenOn: string;
  capturedAt: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  errorMsg?: string;
};

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function compressImage(uri: string): Promise<{ uri: string; base64: string }> {
  // Resize to max 1920px on longest side, get base64 for upload
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_DIMENSION } }],
    {
      compress: COMPRESS,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    },
  );
  return { uri: result.uri, base64: result.base64 ?? '' };
}

async function uploadToStorage(
  base64: string,
  domain: string,
): Promise<string> {
  // Step 1: Get presigned upload URL
  const urlResp = await fetch(
    `https://${domain}/api/storage/uploads/request-url`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `crew-photo-${Date.now()}.jpg`,
        size: Math.round(base64.length * 0.75),
        contentType: 'image/jpeg',
      }),
    },
  );
  if (!urlResp.ok) throw new Error(`Request URL failed: ${urlResp.status}`);
  const { uploadURL, objectPath } = await urlResp.json();

  // Step 2: Convert base64 to binary and PUT to presigned URL
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'image/jpeg' });

  const putResp = await fetch(uploadURL, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  if (!putResp.ok) throw new Error(`PUT failed: ${putResp.status}`);

  return objectPath as string;
}

export function usePhotoUpload(
  token: string | null,
  jobId: string | null = null,
) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const { mutateAsync: registerPhoto } = useUploadPortalPhoto();
  const queryClient = useQueryClient();

  // Load persisted queue on mount
  useEffect(() => {
    AsyncStorage.getItem(QUEUE_KEY).then((raw) => {
      if (raw) {
        try {
          const saved: QueueItem[] = JSON.parse(raw);
          // Reset any "uploading" to "pending" from a previous interrupted session
          const reset = saved.map((item) =>
            item.status === 'uploading' ? { ...item, status: 'pending' as const } : item,
          );
          const active = reset.filter((i) => i.status !== 'done');
          setQueue(active);
          // Kick off uploads for any persisted pending/error items
          if (token) {
            const toResume = active.filter(
              (i) => i.status === 'pending' || i.status === 'error',
            );
            // Upload serially to avoid overwhelming a slow connection
            const runSerial = async () => {
              for (const item of toResume) {
                await uploadItem(item).catch(() => {});
              }
            };
            runSerial();
          }
        } catch {
          // ignore parse errors
        }
      }
    });
    // uploadItem is stable (useCallback with deps); token is the auth credential
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const saveQueue = useCallback(async (q: QueueItem[]) => {
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch {
      // ignore storage errors
    }
  }, []);

  const uploadItem = useCallback(
    async (item: QueueItem): Promise<void> => {
      if (!token || !process.env.EXPO_PUBLIC_DOMAIN) return;

      setQueue((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: 'uploading' as const } : i,
        ),
      );

      try {
        const { base64 } = await compressImage(item.uri);
        const storagePath = await uploadToStorage(
          base64,
          process.env.EXPO_PUBLIC_DOMAIN!,
        );

        await registerPhoto({
          token,
          data: {
            storagePath,
            takenOn: item.takenOn,
            phase: item.phase,
            jobId: item.jobId,
            capturedAt: item.capturedAt,
          },
        });

        setQueue((prev) => {
          const next = prev.map((i) =>
            i.id === item.id ? { ...i, status: 'done' as const } : i,
          );
          // Remove done items from local queue after a short delay
          const filtered = next.filter((i) => i.status !== 'done');
          saveQueue(filtered);
          return next;
        });

        // Refresh photos in the query cache
        queryClient.invalidateQueries({
          queryKey: [`/api/portal/${token}/photos`],
        });
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : 'Upload failed';
        setQueue((prev) => {
          const next = prev.map((i) =>
            i.id === item.id
              ? { ...i, status: 'error' as const, errorMsg }
              : i,
          );
          saveQueue(next.filter((i) => i.status !== 'done'));
          return next;
        });
      }
    },
    [token, registerPhoto, queryClient, saveQueue],
  );

  const addPhoto = useCallback(
    async (uri: string, phase: 'before' | 'after' | null = null) => {
      const item: QueueItem = {
        id: generateId(),
        uri,
        phase,
        jobId,
        takenOn: localDateStr(),
        capturedAt: new Date().toISOString(),
        status: 'pending',
      };

      setQueue((prev) => {
        const next = [...prev, item];
        saveQueue(next);
        return next;
      });

      // Start upload immediately
      await uploadItem(item);
    },
    [jobId, uploadItem, saveQueue],
  );

  const retryFailed = useCallback(() => {
    setQueue((prev) => {
      const failed = prev.filter((i) => i.status === 'error');
      failed.forEach((i) => uploadItem({ ...i }));
      return prev.map((i) =>
        i.status === 'error' ? { ...i, status: 'pending' as const } : i,
      );
    });
  }, [uploadItem]);

  const pendingCount = queue.filter(
    (i) => i.status === 'pending' || i.status === 'uploading',
  ).length;

  const visibleQueue = queue.filter((i) => i.status !== 'done');

  return { queue: visibleQueue, addPhoto, retryFailed, pendingCount };
}
