import { useCallback, useEffect, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
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
  /**
   * Set the moment the bytes land in the bucket, and persisted with the queue.
   * A retry MUST register this same path instead of uploading again: if the
   * first registration committed and only its response was lost — the normal
   * failure on site LTE — a fresh upload would mint a new object and the same
   * shot would appear twice in the crew vault and the office feed. The server
   * treats a repeated path as the same photo.
   */
  storagePath?: string;
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

async function compressImage(uri: string): Promise<string> {
  // Resize to max 1920px on longest side, return local file URI
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_DIMENSION } }],
    {
      compress: COMPRESS,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );
  return result.uri;
}

async function uploadToStorage(
  localUri: string,
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
        contentType: 'image/jpeg',
      }),
    },
  );
  if (!urlResp.ok) throw new Error(`Request URL failed: ${urlResp.status}`);
  const { uploadURL, objectPath } = await urlResp.json();

  // Step 2: PUT the file directly from disk — avoids Blob/atob issues in Hermes
  const result = await uploadAsync(localUri, uploadURL, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`PUT failed: ${result.status}`);
  }

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
        let storagePath = item.storagePath;
        if (!storagePath) {
          const compressedUri = await compressImage(item.uri);
          storagePath = await uploadToStorage(
            compressedUri,
            process.env.EXPO_PUBLIC_DOMAIN!,
          );
          // Persist the path before registering: a crash or force-quit between
          // here and the register call must not orphan the uploaded object into
          // a re-upload on the next launch.
          const uploaded = storagePath;
          setQueue((prev) => {
            const next = prev.map((i) =>
              i.id === item.id ? { ...i, storagePath: uploaded } : i,
            );
            saveQueue(next.filter((i) => i.status !== 'done'));
            return next;
          });
        }

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
          // Persist without the done item, but keep it visible for 1.5s
          saveQueue(next.filter((i) => i.status !== 'done'));
          return next;
        });
        // Remove the done item from UI after a brief success flash
        setTimeout(() => {
          setQueue((prev) => prev.filter((i) => i.id !== item.id));
        }, 1500);

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
