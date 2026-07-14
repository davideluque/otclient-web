import { describe, expect, it } from 'vitest';
import { defaultProxyUrl, resolveProxyOverride } from '../lib/jamera/proxyUrl';

function page(hostname: string): Pick<Location, 'hostname'> {
  return { hostname };
}

describe('resolveProxyOverride', () => {
  it('ignores missing, blank, malformed, and non-WebSocket overrides', () => {
    expect(resolveProxyOverride(null, page('official.example'))).toBeUndefined();
    expect(resolveProxyOverride('   ', page('official.example'))).toBeUndefined();
    expect(resolveProxyOverride('not a url', page('official.example'))).toBeUndefined();
    expect(resolveProxyOverride('https://official.example:8090', page('official.example'))).toBeUndefined();
  });

  it('rejects remote proxy hosts controlled by the query string', () => {
    expect(resolveProxyOverride('wss://attacker.example', page('official.example'))).toBeUndefined();
  });

  it('allows loopback proxy overrides for local development', () => {
    expect(resolveProxyOverride('ws://localhost:8090/', page('official.example'))).toBe('ws://localhost:8090');
    expect(resolveProxyOverride('ws://127.42.0.1:8090', page('official.example'))).toBe('ws://127.42.0.1:8090');
    expect(resolveProxyOverride('ws://[::1]:8090', page('official.example'))).toBe('ws://[::1]:8090');
  });

  it('allows same-host proxy overrides for trusted deployments', () => {
    expect(resolveProxyOverride('wss://official.example:8443', page('official.example'))).toBe(
      'wss://official.example:8443',
    );
  });
});

describe('defaultProxyUrl', () => {
  it('uses the page host bridge on :8090 in dev (so LAN testing needs no override)', () => {
    expect(defaultProxyUrl({ protocol: 'http:', host: 'localhost:5173', hostname: 'localhost' }, true)).toBe(
      'ws://localhost:8090',
    );
    expect(defaultProxyUrl({ protocol: 'http:', host: '192.168.1.5:5173', hostname: '192.168.1.5' }, true)).toBe(
      'ws://192.168.1.5:8090',
    );
  });

  it('defaults to the same origin over wss on an https production page', () => {
    expect(defaultProxyUrl({ protocol: 'https:', host: 'tibia.example', hostname: 'tibia.example' }, false)).toBe(
      'wss://tibia.example',
    );
  });

  it('preserves a non-default port and falls back to ws on a plain-http page', () => {
    expect(defaultProxyUrl({ protocol: 'http:', host: 'box.local:8080', hostname: 'box.local' }, false)).toBe(
      'ws://box.local:8080',
    );
  });
});
