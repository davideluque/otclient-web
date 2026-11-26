/**
 * Tibia-canonical visible-region half-extents around the player. The
 * server feeds an 18×14 window (`playerX-8 … playerX+9`, `playerY-6 …
 * playerY+7`); the renderer paints the same span so it draws whatever
 * the server has sent and not a tile more, and the viewport cover-zoom
 * derives its guaranteed-coverage core from the same numbers.
 */
export const HALF_W_LEFT = 8;
export const HALF_W_RIGHT = 9;
export const HALF_H_TOP = 6;
export const HALF_H_BOTTOM = 7;
