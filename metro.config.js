// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// hikvision-bridge is a standalone Node service (its own package.json + runtime),
// never imported by the app. Keep Metro from scanning/bundling it — otherwise it
// tries to resolve the bridge's Node modules and fails the web export.
config.resolver.blockList = /[/\\]hikvision-bridge[/\\].*/;

// expo-sqlite on web ships a WebAssembly build (wa-sqlite.wasm). Metro must
// resolve .wasm as an asset, otherwise bundling fails with:
//   "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm"
config.resolver.assetExts.push("wasm");

// wa-sqlite uses SharedArrayBuffer, which the browser only exposes when the
// page is cross-origin isolated. Add the required COOP/COEP headers to the dev
// server so the worker can spin up.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    return middleware(req, res, next);
  };
};

module.exports = config;
