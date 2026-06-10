// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountLoginScreen } from '../lib/jamera/loginScreen';

/**
 * These tests exercise the login screen as a black box — they don't open
 * real WebSockets; the GameClient sits idle in `disconnected` state until
 * the user clicks Log in, at which point `Connection.connect` reaches for
 * a real `WebSocket` and fails fast inside happy-dom. We assert against
 * the rendered DOM only.
 */
describe('mountLoginScreen', () => {
  let root: HTMLElement;
  let mounted: ReturnType<typeof mountLoginScreen>;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    mounted = mountLoginScreen(root);
  });

  afterEach(() => {
    mounted.unmount();
    root.remove();
  });

  it('renders an account + password form and a status line', () => {
    expect(root.querySelector('input[name="account"]')).toBeTruthy();
    expect(root.querySelector('input[name="password"]')).toBeTruthy();
    expect(root.querySelector('button[type="submit"]')).toBeTruthy();
    const status = root.querySelector('[data-role="status"]');
    expect(status?.textContent).toBe('Idle.');
  });

  it('returns a GameClient and disconnects it on unmount', () => {
    expect(mounted.client.getState()).toBe('disconnected');
  });

  it('shows a validation error when the account input is non-positive', async () => {
    const account = root.querySelector('input[name="account"]') as HTMLInputElement;
    const password = root.querySelector('input[name="password"]') as HTMLInputElement;
    const form = root.querySelector('form') as HTMLFormElement;

    account.value = '0';
    password.value = 'hunter2';
    form.dispatchEvent(new Event('submit'));

    // Submit handler is async but the validation branch is synchronous.
    await Promise.resolve();
    const err = root.querySelector('[data-role="error"]');
    expect(err?.textContent).toMatch(/account/i);
    // Client should not have advanced past disconnected.
    expect(mounted.client.getState()).toBe('disconnected');
  });

  it('rejects fractional account numbers (would be U32-truncated on the wire)', async () => {
    const account = root.querySelector('input[name="account"]') as HTMLInputElement;
    const password = root.querySelector('input[name="password"]') as HTMLInputElement;
    const form = root.querySelector('form') as HTMLFormElement;

    account.value = '1.5';
    password.value = 'hunter2';
    form.dispatchEvent(new Event('submit'));

    await Promise.resolve();
    const err = root.querySelector('[data-role="error"]');
    expect(err?.textContent).toMatch(/integer/i);
    expect(mounted.client.getState()).toBe('disconnected');
  });

  it('rejects account numbers above the U32 range (would wrap on the wire)', async () => {
    const account = root.querySelector('input[name="account"]') as HTMLInputElement;
    const password = root.querySelector('input[name="password"]') as HTMLInputElement;
    const form = root.querySelector('form') as HTMLFormElement;

    // 2^32 — one past the U32 max. Without the upper-bound check this
    // would serialise to 0 on the wire and silently land the user on a
    // different account.
    account.value = '4294967296';
    password.value = 'hunter2';
    form.dispatchEvent(new Event('submit'));

    await Promise.resolve();
    const err = root.querySelector('[data-role="error"]');
    expect(err?.textContent).toMatch(/4294967295/);
    expect(mounted.client.getState()).toBe('disconnected');
  });

  it('disables the form once the client transitions out of disconnected', () => {
    const form = root.querySelector('form') as HTMLFormElement;
    const account = form.querySelector('input[name="account"]') as HTMLInputElement;
    const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;

    expect(account.disabled).toBe(false);
    expect(button.disabled).toBe(false);

    // Drive the onStateChange callback directly — we can't open a real
    // WebSocket here. The handler is attached via the events object the
    // GameClient was constructed with.
    // @ts-expect-error reaching into private state for the test
    mounted.client.events.onStateChange?.('logging_in');
    expect(button.disabled).toBe(true);
    expect(account.disabled).toBe(true);
  });

  it('keeps the login form disabled in character_list so a second submit cannot open a duplicate socket', () => {
    const form = root.querySelector('form') as HTMLFormElement;
    const account = form.querySelector('input[name="account"]') as HTMLInputElement;
    const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;

    // @ts-expect-error reaching into private events
    mounted.client.events.onStateChange?.('character_list');
    expect(button.disabled).toBe(true);
    expect(account.disabled).toBe(true);
  });

  it('renders the character list when the server sends one', () => {
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(
      [
        { name: 'GOD Bruno', worldName: 'Jamera', worldIp: '127.0.0.1', worldPort: 7172 },
        { name: 'Squirrel', worldName: 'Jamera', worldIp: '127.0.0.1', worldPort: 7172 },
      ],
      0,
      'Welcome.',
    );

    const list = root.querySelector('[data-role="characters"]') as HTMLElement;
    expect(list.hidden).toBe(false);
    expect(list.getAttribute('data-character-count')).toBe('2');
    expect(list.textContent).toContain('GOD Bruno');
    expect(list.textContent).toContain('Squirrel');
    expect(list.querySelector('.motd')?.textContent).toBe('Welcome.');
  });

  it('surfaces login errors from the server', () => {
    // @ts-expect-error reaching into private events
    mounted.client.events.onLoginError?.('Account is banned.');
    const err = root.querySelector('[data-role="error"]');
    expect(err?.textContent).toBe('Account is banned.');
  });
});
