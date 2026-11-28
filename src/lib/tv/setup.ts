import './tv.css';

export function configureTV(): void {
  document.documentElement.classList.add('tv-layout');
  const resize = () => {
    const style = document.documentElement.style;
    for (const side of ['top','bottom']) style.setProperty('--game-inset-' + side, Math.round(innerHeight * .05) + 'px');
    for (const side of ['left','right']) style.setProperty('--game-inset-' + side, Math.round(innerWidth * .05) + 'px');
  };
  resize();
  window.addEventListener('resize', resize);
}

export function rememberField(name: 'account' | 'password', label: string): void {
  const form = document.querySelector<HTMLFormElement>('.jamera-login form');
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>('input[name="' + name + '"]')!;
  const key = 'jamera.tv.' + name;
  const option = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  const showWhileEditing = () => { checkbox.disabled = input.disabled; option.hidden = input.disabled; };
  showWhileEditing();
  new MutationObserver(showWhileEditing).observe(input, { attributes:true, attributeFilter:['disabled'] });
  option.append(checkbox, label);
  form.insertBefore(option, form.querySelector('button'));
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) { input.value = saved; checkbox.checked = true; }
  } catch { /* Storage disabled. */ }
  checkbox.onchange = () => {
    try { if (!checkbox.checked) localStorage.removeItem(key); } catch { /* Optional. */ }
  };
  form.addEventListener('submit', () => {
    try { if (checkbox.checked) localStorage.setItem(key, input.value); } catch { /* Optional. */ }
  });
}
