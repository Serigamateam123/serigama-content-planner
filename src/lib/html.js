// Single source of the htm-bound `html` tag, bound to Preact's `h`.
// Importing htm (raw) and binding it here guarantees every component shares
// ONE preact instance — mixing `htm/preact` (which bundles its own preact)
// with `preact/hooks` causes "Cannot read properties of undefined (reading '__H')".
import { h } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);
