import type { SupabaseClient } from '@supabase/supabase-js';
import { readWithTimeout } from './query-utils';

const buckets = new Set(['avatars', 'photos', 'maintenance-photos']);
type ImageClient = Pick<SupabaseClient, 'storage'>;
interface ImageCacheEntry { expiresAt: number; promise: Promise<string | null> }
const imageCaches = new WeakMap<ImageClient, Map<string, ImageCacheEntry>>();

export function clearImageCache(client: ImageClient): void { imageCaches.delete(client); }

/** Persist object references, never expiring signed tokens or device-only paths. */
export function imageReference(value: string | null | undefined, projectUrl: string): string | null {
  if (!value) return null;
  let reference = value;
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.origin !== new URL(projectUrl).origin) throw new Error('Image must belong to this project.');
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
    if (!match) throw new Error('Invalid storage image URL.');
    reference = `storage://${match[1]}/${decodeURIComponent(match[2])}`;
  }
  const match = reference.match(/^storage:\/\/([^/]+)\/(.+)$/);
  if (!match || !buckets.has(match[1]) || match[2].split('/').some(part => !part || part === '.' || part === '..') || /[\\?#\u0000-\u001f]/.test(match[2])) {
    throw new Error('Invalid storage image reference.');
  }
  return reference;
}

export async function displayImage(client: ImageClient, value: string | null | undefined, projectUrl: string, refresh = false): Promise<string | null> {
  if (!value) return null;
  try {
    const ref = imageReference(value, projectUrl)!;
    const [, bucket, path] = ref.match(/^storage:\/\/([^/]+)\/(.+)$/)!;
    let cache = imageCaches.get(client);
    if (!cache) { cache = new Map(); imageCaches.set(client, cache); }
    if (refresh) cache.delete(ref);
    const cached = cache.get(ref);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const currentCache = cache;
    const entry: ImageCacheEntry = {
      expiresAt: Date.now() + 3540_000,
      promise: Promise.resolve().then(async () => {
        try {
          const { data, error } = await readWithTimeout(() => client.storage.from(bucket).createSignedUrl(path, 3600));
          if (!error && data?.signedUrl) return data.signedUrl;
          if (currentCache.get(ref) === entry) currentCache.delete(ref);
          const { data: pubData } = client.storage.from(bucket).getPublicUrl(path);
          return pubData?.publicUrl || (value.startsWith('http') ? value : null);
        } catch {
          if (currentCache.get(ref) === entry) currentCache.delete(ref);
          return value.startsWith('http') ? value : null;
        }
      }),
    };
    cache.set(ref, entry);
    if (cache.size > 512) cache.delete(cache.keys().next().value!);
    return entry.promise;
  } catch {
    return value && value.startsWith('http') ? value : null;
  }
}

export function isImageSignature(bytes: Uint8Array, mime: string): boolean {
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  if (mime === 'image/png') return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === 'image/jpeg') return starts(255, 216, 255);
  if (mime === 'image/gif') return starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]) && bytes[5] === 97;
  if (mime === 'image/webp') return starts(82, 73, 70, 70) && [87, 69, 66, 80].every((v, i) => bytes[i + 8] === v);
  return false;
}
