import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { authenticatedFetch } from "../lib/authFetch";

const imageUrlCache = new Map<string, Promise<string>>();

export async function clearAuthenticatedImageCache() {
  const urls = await Promise.allSettled(imageUrlCache.values());
  for (const result of urls) {
    if (result.status === "fulfilled" && result.value.startsWith("blob:")) {
      URL.revokeObjectURL(result.value);
    }
  }
  imageUrlCache.clear();
}

export function loadAuthenticatedImageUrl(source: string): Promise<string> {
  if (source.startsWith("blob:") || source.startsWith("data:")) return Promise.resolve(source);
  let cached = imageUrlCache.get(source);
  if (!cached) {
    cached = authenticatedFetch(source)
      .then((response) => {
        if (!response.ok) throw new Error(`Image loading failed (${response.status})`);
        return response.blob();
      })
      .then((blob) => URL.createObjectURL(blob))
      .catch((error) => {
        imageUrlCache.delete(source);
        throw error;
      });
    imageUrlCache.set(source, cached);
  }
  return cached;
}

export function AuthenticatedImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [resolvedSource, setResolvedSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setResolvedSource(null);
    if (!src) return () => { active = false; };
    loadAuthenticatedImageUrl(src)
      .then((url) => { if (active) setResolvedSource(url); })
      .catch((error: unknown) => console.error("Authenticated image loading failed", error));
    return () => { active = false; };
  }, [src]);

  if (!resolvedSource) return <span className="image-loading" aria-label={`${alt ?? "画像"}を読み込み中`} />;
  return <img src={resolvedSource} alt={alt ?? ""} {...props} />;
}
