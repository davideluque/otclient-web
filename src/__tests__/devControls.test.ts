/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createDevControls } from '../lib/devControls';
import type { DevControlsHandle } from '../lib/devControls';

describe('createDevControls', () => {
  let handle: DevControlsHandle;

  afterEach(() => handle?.destroy());

  it('renders a collapse button and hidden panel', () => {
    handle = createDevControls([]);
    const btn = handle.el.querySelector('.dev-controls-toggle') as HTMLElement;
    const panel = handle.el.querySelector('.dev-controls-panel') as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Dev');
    expect(panel.style.display).toBe('none');
  });

  it('toggles panel visibility on click', () => {
    handle = createDevControls([]);
    const btn = handle.el.querySelector('.dev-controls-toggle') as HTMLElement;
    const panel = handle.el.querySelector('.dev-controls-panel') as HTMLElement;

    btn.dispatchEvent(new PointerEvent('pointerdown'));
    expect(panel.style.display).toBe('block');

    btn.dispatchEvent(new PointerEvent('pointerdown'));
    expect(panel.style.display).toBe('none');
  });

  it('renders toggle buttons with correct default state', () => {
    const onChange = vi.fn();
    handle = createDevControls([
      { label: 'Night', defaultOn: true, onChange },
      { label: 'Zoom', defaultOn: false, onChange },
    ]);
    const buttons = handle.el.querySelectorAll('.dev-controls-btn');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe('ON');
    expect(buttons[1].textContent).toBe('OFF');
  });

  it('fires onChange when toggle is pressed', () => {
    const onChange = vi.fn();
    handle = createDevControls([
      { label: 'Test', defaultOn: false, onChange },
    ]);
    const btn = handle.el.querySelector('.dev-controls-btn') as HTMLElement;
    btn.dispatchEvent(new PointerEvent('pointerdown'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('setToggle updates button state from outside', () => {
    const onChange = vi.fn();
    handle = createDevControls([
      { label: 'Zoom', defaultOn: false, onChange },
    ]);
    handle.setToggle('Zoom', true);
    const btn = handle.el.querySelector('.dev-controls-btn') as HTMLElement;
    expect(btn.textContent).toBe('ON');
  });

  it('setVisible hides and shows the root', () => {
    handle = createDevControls([]);
    handle.setVisible(false);
    expect(handle.el.style.display).toBe('none');
    handle.setVisible(true);
    expect(handle.el.style.display).toBe('block');
  });
});
