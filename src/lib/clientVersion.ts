// Resolves the active Tibia client version. Single source of truth shared
// between the asset autoloader and the persistent cache, so both agree on
// the same key.
//
// Resolution order:
//   1. ?version=<v>     URL query string
//   2. VITE_CLIENT_VERSION   build-time env (.env / .env.local)
//   3. DEFAULT_VERSION  fallback

export const DEFAULT_VERSION = '760';

export function resolveVersion(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('version');
  if (fromUrl) return fromUrl;
  const fromEnv = import.meta.env.VITE_CLIENT_VERSION as string | undefined;
  return fromEnv || DEFAULT_VERSION;
}
