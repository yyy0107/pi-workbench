// Form and research behavior adapted from pi-browser-harness (MIT); see THIRD_PARTY_NOTICES.md.
export function keyEvent(key: string, modifiers = 0) {
  const special: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Backspace: 8,
    Escape: 27,
    Delete: 46,
    " ": 32,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
  };
  return {
    key,
    modifiers,
    code: /^[a-z]$/i.test(key)
      ? `Key${key.toUpperCase()}`
      : /^\d$/.test(key)
        ? `Digit${key}`
        : key === " "
          ? "Space"
          : key,
    windowsVirtualKeyCode: special[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
  };
}

export const elementAction = `function(command) {
  const el = this, win = el.ownerDocument.defaultView;
  const fire = type => el.dispatchEvent(new win.Event(type, { bubbles: true, composed: true }));
  const fail = error => ({ ok: false, error });
  if (!el.isConnected) return fail('The element was removed. Take a new snapshot.');
  if (el.matches(':disabled') || el.closest('[aria-disabled="true"]')) return fail('This element is disabled.');
  if (command.type === 'focus') {
    el.focus();
    return { ok: el.getRootNode().activeElement === el, focused: el.getRootNode().activeElement === el };
  }
  if (command.type === 'dispatch-key') {
    const modifiers = command.modifiers || 0;
    el.dispatchEvent(new win.KeyboardEvent(command.eventType || 'keydown', {
      key: command.key, code: command.code, keyCode: command.windowsVirtualKeyCode, which: command.windowsVirtualKeyCode,
      altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), metaKey: !!(modifiers & 4), shiftKey: !!(modifiers & 8),
      bubbles: true, composed: true, cancelable: true
    }));
    return { ok: true, dispatched: true };
  }
  if (el.readOnly) return fail('This is not a writable field: it is read-only.');
  if (command.type === 'select' || command.type === 'fill' && el.tagName === 'SELECT') {
    if (el.tagName !== 'SELECT') return fail('Use select on a native select element.');
    const options = Array.from(el.options);
    const option = command.index !== undefined ? options[command.index] : options.find(option =>
      command.label !== undefined ? option.label === command.label : option.value === (command.value ?? command.text));
    if (!option) return fail('No matching option. Available: ' + JSON.stringify(options.slice(0,100).map(option => ({value:option.value,label:option.label}))));
    if (option.disabled || option.closest('optgroup')?.disabled) return fail('The selected option is disabled.');
    Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(el, option.value);
    fire('input'); fire('change');
    return { ok: el.value === option.value, value: el.value, label: option.label };
  }
  if (command.type === 'set-checked' || command.type === 'fill' && /^(checkbox|radio)$/.test(el.type)) {
    if (el.tagName !== 'INPUT' || !/^(checkbox|radio)$/.test(el.type)) return fail('This element is not a checkbox or radio.');
    const checked = command.type === 'set-checked' ? command.checked : command.text === 'true';
    if (command.type === 'fill' && !['true','false'].includes(command.text)) return fail('Use true or false for checkbox/radio values.');
    if (el.type === 'radio' && !checked && el.checked) return fail('Select another radio in the group to clear this option.');
    const changed = el.checked !== checked;
    if (changed) el.click();
    return { ok: el.checked === checked, checked: el.checked, changed };
  }
  if (command.type !== 'fill') return fail('Unsupported field operation.');
  const value = command.text;
  el.focus();
  if (!el.isConnected) return fail('The field was removed during focus. Take a new snapshot.');
  if (el.isContentEditable) {
    el.focus();
    const selection = win.getSelection(), range = el.ownerDocument.createRange();
    range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range);
    if (!el.ownerDocument.execCommand('insertText', false, value)) {
      el.textContent = value;
      el.dispatchEvent(new win.InputEvent('input', {bubbles:true,composed:true,inputType:'insertText',data:value}));
    }
    fire('change');
    return { ok: el.textContent === value, value: el.textContent };
  }
  if (el.tagName !== 'TEXTAREA' && (el.tagName !== 'INPUT' || /^(button|submit|reset|image|file|hidden)$/.test(el.type)))
    return fail('This target is not a writable editable field.');
  const prototype = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
  fire('input'); fire('change');
  return { ok: el.value === value, ...(el.type === 'password' ? { redacted: true } : { value: el.value }) };
}`;

export const pageInfoExpression = `({ url: location.href, title: document.title, readyState: document.readyState,
  width: innerWidth, height: innerHeight, scrollX, scrollY,
  pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight })`;

export const readPageExpression = `(() => {
  const root = document.querySelector('article,main,[role="main"]') || document.body;
  const blocks = [];
  let length = 0;
  for (const el of root?.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre') || []) {
    if (length >= 100000) break;
    if (el.closest('nav,header,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"]') ||
      !el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
    const value = (el.innerText || '').trim();
    const linkLength = [...el.querySelectorAll('a')].reduce((n,a) => n + (a.innerText || '').length,0);
    if (!value || linkLength > value.length / 2 || el.tagName === 'P' && value.length < 25) continue;
    const text = /^H[1-6]$/.test(el.tagName) ? '#'.repeat(Number(el.tagName[1])) + ' ' + value :
      el.tagName === 'LI' ? '- ' + value : el.tagName === 'BLOCKQUOTE' ? '> ' + value : value;
    blocks.push(text); length += text.length;
  }
  const article = blocks.join('\\n\\n');
  const fallback = article.length < 200;
  const full = fallback ? (root?.innerText || '') : article;
  const text = full.slice(0,65536);
  return { url: location.href, title: document.title, text, fallback, truncated: full.length > text.length,
    wordCount: [...new Intl.Segmenter(undefined,{granularity:'word'}).segment(text)].filter(part => part.isWordLike).length };
})()`;

export const searchExpression = `(limit => {
  const root = document.querySelector('#search,#rso,#main') || document.body;
  const results = [], seen = new Set();
  for (const heading of root?.querySelectorAll('a h3') || []) {
    const link = heading.closest('a[href]');
    if (!link) continue;
    let url;
    try {
      url = new URL(link.href);
      if (url.pathname === '/url' && /(^|\\.)google\\.[a-z.]+$/.test(url.hostname)) url = new URL(url.searchParams.get('q') || url.searchParams.get('url'));
    } catch { continue; }
    if (!['http:','https:'].includes(url.protocol) || /(^|\\.)google(?:usercontent)?\\.[a-z.]+$/.test(url.hostname)) continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const title = (heading.innerText || heading.textContent || '').trim();
    const container = link.closest('div.g,div[data-hveid]') || link.parentElement?.parentElement;
    results.push({title,url:url.href,snippet:(container?.innerText || '').replace(title,'').replace(/\\s+/g,' ').trim().slice(0,500),rank:results.length+1});
    if (results.length >= limit) break;
  }
  const pageText = (document.body?.innerText || '').slice(0,8000).toLowerCase();
  const blocked = /unusual traffic|not a robot|recaptcha|before you continue to google/.test(pageText) || !!document.querySelector('iframe[src*="recaptcha"],form[action*="sorry"]');
  return {results,reason:results.length ? undefined : blocked ? 'captcha' : 'no_results',url:location.href};
})`;
