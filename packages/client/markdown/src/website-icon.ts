/** Only the origin is sent; message paths, queries and fragments stay local. */
export function websiteIconUrl(href: string): string | null {
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return `${url.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<string | null>>();

export function loadWebsiteIcon(href: string): Promise<string | null> {
  const url = websiteIconUrl(href);
  if (!url || typeof Image === "undefined") return Promise.resolve(null);
  const existing = cache.get(url);
  if (existing) return existing;
  const result = new Promise<string | null>((resolve) => {
    const image = new Image();
    const finish = (value: string | null) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 8_000);
    image.referrerPolicy = "no-referrer";
    image.onload = () => finish(url);
    image.onerror = () => finish(null);
    image.src = url;
  });
  // Bound the session cache, including failed lookups.
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(url, result);
  return result;
}
