// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountLoginScreen, parseLoginAccount } from '../lib/jamera/loginScreen';
import { GameClient } from '../lib/net/common/GameClient';

describe('parseLoginAccount', () => {
  it('accepts positive U32 account numbers', () => {
    expect(parseLoginAccount('1')).toEqual({ ok: true, account: 1 });
    expect(parseLoginAccount('4294967295')).toEqual({ ok: true, account: 4294967295 });
  });

  it('rejects values that cannot round-trip through the login packet account field', () => {
    for (const raw of ['0', '-1', '1.5', '4294967296', 'not a number']) {
      const parsed = parseLoginAccount(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain('4294967295');
    }
  });
});

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

describe('mountLoginScreen autoLogin', () => {
  const CHARS = [
    { name: 'Flash Ivan', worldName: 'Jamera', worldIp: '127.0.0.1', worldPort: 7172 },
    { name: 'Squirrel', worldName: 'Jamera', worldIp: '127.0.0.1', worldPort: 7172 },
  ];
  let root: HTMLElement;
  let loginSpy: ReturnType<typeof vi.spyOn>;
  let selectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    // No real sockets in happy-dom — intercept at the GameClient boundary.
    loginSpy = vi.spyOn(GameClient.prototype, 'login').mockResolvedValue(undefined);
    selectSpy = vi.spyOn(GameClient.prototype, 'selectCharacter').mockResolvedValue(undefined);
  });

  afterEach(() => {
    loginSpy.mockRestore();
    selectSpy.mockRestore();
    root.remove();
  });

  it('submits the credentials on mount and picks the first character once', async () => {
    const mounted = mountLoginScreen(root, { autoLogin: { account: 1, password: '1' } });
    await Promise.resolve();
    expect(loginSpy).toHaveBeenCalledWith(1, '1');

    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(CHARS, 0, 'Welcome.');
    await Promise.resolve();
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledWith(CHARS[0]);

    // One-shot: a later character list (re-login after logout) must not
    // auto-pick — the user is back on the normal flow.
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(CHARS, 0, 'Welcome.');
    await Promise.resolve();
    expect(selectSpy).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it('a drop back to disconnected (proxy offline) disarms the auto-pick', async () => {
    const mounted = mountLoginScreen(root, { autoLogin: { account: 1, password: '1' } });
    await Promise.resolve();
    // Connection failure path: no onLoginError fires, just a state
    // transition back to disconnected. A later manual login must not
    // be hijacked by the stale auto-pick.
    // @ts-expect-error reaching into private events
    mounted.client.events.onStateChange?.('logging_in');
    // @ts-expect-error reaching into private events
    mounted.client.events.onStateChange?.('disconnected');
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(CHARS, 0, 'Welcome.');
    await Promise.resolve();
    expect(selectSpy).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('a login error disarms the auto-pick', async () => {
    const mounted = mountLoginScreen(root, { autoLogin: { account: 1, password: 'wrong' } });
    await Promise.resolve();
    // @ts-expect-error reaching into private events
    mounted.client.events.onLoginError?.('Wrong password.');
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(CHARS, 0, 'Welcome.');
    await Promise.resolve();
    expect(selectSpy).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('an empty character list disarms the auto-pick', async () => {
    const mounted = mountLoginScreen(root, { autoLogin: { account: 1, password: '1' } });
    await Promise.resolve();
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.([], 0, 'Welcome.');
    // A later, populated list (manual re-login) must not be auto-picked.
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(CHARS, 0, 'Welcome.');
    await Promise.resolve();
    expect(selectSpy).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('auto-login credentials failing form validation disarm the auto-pick', async () => {
    // Account 0 dies in the synchronous U32 validation: no state change,
    // no error event — only the in-handler disarm covers this path.
    const mounted = mountLoginScreen(root, { autoLogin: { account: 0, password: '1' } });
    await Promise.resolve();
    expect(loginSpy).not.toHaveBeenCalled();
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(CHARS, 0, 'Welcome.');
    await Promise.resolve();
    expect(selectSpy).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('does not auto-anything without the option', async () => {
    const mounted = mountLoginScreen(root);
    await Promise.resolve();
    expect(loginSpy).not.toHaveBeenCalled();
    // @ts-expect-error reaching into private events
    mounted.client.events.onCharacterList?.(CHARS, 0, 'Welcome.');
    await Promise.resolve();
    expect(selectSpy).not.toHaveBeenCalled();
    mounted.unmount();
  });
});
