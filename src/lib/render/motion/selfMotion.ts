/**
 * Which algorithm renders SELF's movement. The switch lives at the
 * composition root (jamera/main.ts): in 'prewalk' mode the walk/route
 * send hooks feed the prediction chain and the renderer draws from it;
 * in 'playout' mode no chain is ever seeded and the renderer's fallback
 * — the fixed-delay playout buffer, the pre-prediction behavior — is
 * all there is. Other creatures always use the forward glide.
 *
 * Toggled per session with `?selfmotion=playout|prewalk` for live A/B
 * against the same server.
 */
export type SelfMotionMode = 'prewalk' | 'playout';

export const DEFAULT_SELF_MOTION: SelfMotionMode = 'prewalk';

export function resolveSelfMotionMode(param: string | null): SelfMotionMode {
  return param === 'playout' || param === 'prewalk' ? param : DEFAULT_SELF_MOTION;
}
