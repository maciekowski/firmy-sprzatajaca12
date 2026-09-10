/**
 * Preload dla skryptów CLI (seed, worker).
 *
 * Skrypty uruchamiane przez tsx nie działają wewnątrz React Server Components,
 * a moduły aplikacji importują „server-only”. Podmieniamy ten import na pusty
 * moduł, dzięki czemu ten sam kod domenowy działa w CLI i w aplikacji.
 */
const Module = require('node:module');
const path = require('node:path');

const stub = path.join(__dirname, 'stubs', 'server-only.cjs');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function patchedResolve(request, ...args) {
  if (request === 'server-only' || request === 'client-only') return stub;
  return originalResolve.call(this, request, ...args);
};
