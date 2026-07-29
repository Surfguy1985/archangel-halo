// Storage upload flow. NEVER prefix /api URLs with BASE_URL.
// POST metadata -> receive presigned uploadURL + objectPath -> PUT file bytes.
export async function uploadFile(
  file: File,
): Promise<{ objectPath: string; contentType: string } | null> {
  try {
    const contentType = file.type || 'application/octet-stream';
    const resp = await fetch('/api/storage/uploads/request-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name || 'upload',
        size: Math.max(file.size, 1),
        contentType,
      }),
    });
    if (!resp.ok) return null;
    const { uploadURL, objectPath } = (await resp.json()) as {
      uploadURL: string;
      objectPath: string;
    };
    const put = await fetch(uploadURL, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': contentType },
    });
    return put.ok ? { objectPath, contentType } : null;
  } catch {
    return null;
  }
}
