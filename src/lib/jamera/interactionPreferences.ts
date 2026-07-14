const TAP_TO_WALK_KEY = 'jamera.tapToWalk';

let tapToWalkCache: boolean | null = null;

export function loadTapToWalk(): boolean {
  if (tapToWalkCache !== null) return tapToWalkCache;
  try {
    const stored = localStorage.getItem(TAP_TO_WALK_KEY);
    if (stored === 'false') return (tapToWalkCache = false);
    if (stored === 'true') return (tapToWalkCache = true);
  } catch { /* storage blocked */ }
  return (tapToWalkCache = true);
}

export function saveTapToWalk(enabled: boolean): void {
  tapToWalkCache = enabled;
  try {
    localStorage.setItem(TAP_TO_WALK_KEY, String(enabled));
  } catch { /* storage blocked — session-only via the cache */ }
}

export function resetTapToWalkCache(): void {
  tapToWalkCache = null;
}
