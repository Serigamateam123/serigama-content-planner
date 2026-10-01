// useState that remembers its value for this browser tab (sessionStorage), so a
// page's chosen dates / tab / filters survive switching to another page and back
// — and a reload — instead of snapping back to "this month". Closing the tab
// starts fresh. `opts.override` (e.g. dates passed in the link) wins over the
// remembered value; `opts.revive` rebuilds non-JSON values such as Dates.
import { useState } from 'preact/hooks';

const PREFIX = 'serigama.ui.';

export function useRemembered(key, initial, opts = {}) {
  const k = PREFIX + key;
  const write = (val) => { try { sessionStorage.setItem(k, JSON.stringify(val)); } catch (e) { /* not essential */ } };
  const [value, setValue] = useState(() => {
    if (opts.override != null) { write(opts.override); return opts.override; }
    try {
      const raw = sessionStorage.getItem(k);
      if (raw != null) { const v = JSON.parse(raw); return opts.revive ? opts.revive(v) : v; }
    } catch (e) { /* fall back to the default */ }
    return typeof initial === 'function' ? initial() : initial;
  });
  const set = (next) => setValue((prev) => {
    const val = typeof next === 'function' ? next(prev) : next;
    write(val);
    return val;
  });
  return [value, set];
}
