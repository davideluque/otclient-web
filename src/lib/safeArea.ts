import './safeArea.css';

export interface PlayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The playable rectangle in CSS pixels relative to the full-bleed canvas. */
export function readPlayArea(width: number, height: number): PlayArea {
  const style = getComputedStyle(document.documentElement);
  const inset = (side: string): number => parseFloat(style.getPropertyValue(`--game-inset-${side}`)) || 0;
  const x = inset('left');
  const y = inset('top');
  return {
    x, y,
    width: Math.max(0, width - x - inset('right')),
    height: Math.max(0, height - y - inset('bottom')),
  };
}
