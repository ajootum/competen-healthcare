// Preloaded by `next dev` when it is started from .claude/launch.json. It sets ONE environment
// variable and does nothing else.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WITHOUT THIS, THE DEV SERVER RENDERS FINE AND EVERY SERVER-SIDE DATABASE READ FAILS.
//
// Avast intercepts HTTPS on this machine and presents its own root. That root is installed in the
// WINDOWS certificate store; Node trusts its own bundled list instead, so `fetch` to Supabase dies with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE. Pages still return 200 -- what breaks is everything behind them, and
// the visible symptom is platformFlag() logging "could not read launch flag ... treating it as OFF", so
// the whole of Practice quietly presents its pre-launch face on a machine where the flags are ON.
//
// WHY A PRELOAD AND NOT AN `env` BLOCK IN launch.json. That field is not honoured -- it was tried, and
// the failure was byte-identical. NODE_EXTRA_CA_CERTS has to exist before the process that opens the
// socket starts, and it cannot be set from inside that process.
//
// WHY NOT `--use-system-ca`, WHICH IS WHAT THE ERROR ITSELF SUGGESTS. `next dev` does the fetching in a
// CHILD process (start-server.js), and argv flags do not cross that boundary. The environment does --
// which is why this sets a variable rather than passing a flag, and why it works when the flag did not.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

// CommonJS, and require() rather than import, because `node --require` preloads CJS. That is the whole
// reason for the .cjs extension: an ESM module cannot be loaded this way.
/* eslint-disable @typescript-eslint/no-require-imports */
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

// ⚠ AN ALREADY-SET VALUE WINS. Somebody starting the server from a shell that exports this has chosen a
// bundle deliberately, and silently overriding it would make this file the reason their choice stopped
// working -- the kind of override that is only ever found by bisecting.
if (!process.env.NODE_EXTRA_CA_CERTS) {
  const candidates = [
    // Avast's own root, which is the interceptor here. Proven to work from a shell on this machine.
    "C:\\ProgramData\\Avast Software\\Avast\\wscert.pem",
    // The merged bundle this machine's User environment points at, as a fallback.
    join(homedir(), "node-ca-bundle.pem"),
  ];
  const found = candidates.find(p => existsSync(p));
  // NOT AN ERROR WHEN NOTHING IS FOUND. A machine without the interceptor needs none of this, and a
  // preload that refused to start the dev server on a clean machine would be worse than the problem.
  if (found) process.env.NODE_EXTRA_CA_CERTS = found;
}
