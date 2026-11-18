/**
 * Ponytail for PI-Desktop — pure skill pack.
 * All behavior lives in the injected skill documents; no tools, no panels,
 * no filesystem or network access. Entry is .cjs because the surrounding
 * workspace package.json declares "type": "module".
 */

async function onLoad() {
  // Skills are contributed via manifest; nothing to initialize.
}

async function onUnload() {
  // nothing to tear down
}

module.exports = { onLoad, onUnload };
