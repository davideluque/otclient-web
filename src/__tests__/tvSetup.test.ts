// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { rememberField } from '../lib/tv/setup';
afterEach(() => { localStorage.clear(); document.body.replaceChildren(); });
it('requires separate opt-ins and removes a saved secret immediately on opt-out', () => {
  document.body.innerHTML = '<div class="jamera-login"><form><input name="account" value="12"><input name="password" value="test"><button></button></form></div>';
  rememberField('account','Remember account');
  rememberField('password','Save password');
  const form = document.querySelector('form')!;
  const options = form.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
  options[0].checked = true;
  form.dispatchEvent(new Event('submit'));
  expect(localStorage.getItem('jamera.tv.account')).toBe('12');
  expect(localStorage.getItem('jamera.tv.password')).toBeNull();
  options[1].checked = true;
  form.dispatchEvent(new Event('submit'));
  expect(localStorage.getItem('jamera.tv.password')).toBe('test');
  options[1].click();
  expect(localStorage.getItem('jamera.tv.password')).toBeNull();
});
