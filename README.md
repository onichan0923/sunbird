# Phoenix Unlock

[![discord][discord]](https://discord.gg/jEmw3bC2m7)

Patches Phoenix, the native Rust client in Discord's Android alpha builds (356.7, versionCode
356207), so it opens without the access gate. It also adds a plugin runtime: TypeScript plugins
that hook gateway events, add buttons, rows and slash commands to Discord's own UI, and get their
own pages under Settings → Phoenix Unlocker.

No root and no Xposed: the APK itself is patched and re-signed.

## Install

Open **https://sunbird.tools/** on the phone. The page downloads Discord's
split APKs, patches them, merges them into one APK and signs it, all in the browser. Options:

- **Install as**: replace Discord (`com.discord`, the default) or next to it (`com.discord.phoenix`).
- **Plugin runtime** on or off. Off gives a plain unlock with no runtime.
- **Plugins**: pick from the bundled ones and/or add your own `.js` files.
- **Frida gadget** (advanced): runs Frida scripts inside Discord at startup.

Builds need Android 9+ and install over each other, so updating keeps you logged in.

After installing, open Discord → Settings → **Phoenix** to turn plugins on and off, change their
settings, install more from a URL or a file, edit their code and use the JS console.

## How it works

- **Unlock**: the launcher method that decides whether Phoenix may start is patched to return
  true, and so is the access check in Phoenix's native library (`liblibdiscord_wasm_host.so`).
  Both are found by strings and code shape, not fixed offsets.
- **Loading**: the native library's `liblog.so` dependency is renamed to `libplm.so`, our loader
  (`crates/loader`). It starts the runtime as soon as Phoenix's library loads.
- **Hooks**: gateway events are hooked by swapping handler pointers in Phoenix's event registry,
  which is found from the event names. The UI is driven through Phoenix's own UI-op bridge
  between Rust and Java. ShadowHook, through the [sunhook](https://github.com/sunbird-tools/sunhook)
  fork, is linked in for native hooks on arm64 and armv7.
- **Signing**: every build is signed with the key in `crates/patcher/keys/`, using APK Signature
  Scheme v3 with a proof of rotation from the key older builds used. The key is public; it only
  lets builds update each other.

## Plugins

Plugins are TypeScript bundles that get a global `phoenix` object. The API reference is
[`crates/runtime/phoenix.d.ts`](crates/runtime/phoenix.d.ts), and
[`plugins/example`](plugins/example/src/index.ts) uses most of it:

```ts
// @description Logs incoming messages
// @version 1.0.0
// @author you

phoenix.on(phoenix.gateway.messageCreate, (message) => {
  phoenix.log.info(`<${message.author.username}> ${message.content}`);
});

phoenix.commands.register({
  name: "shrug",
  description: "Sends your text with ¯\\_(ツ)_/¯",
  // the returned text is sent in place of "/shrug ..."
  execute: (args) => `${args} ¯\\_(ツ)_/¯`.trim(),
});
```

Leading `// @` lines describe the plugin. Besides gateway hooks there are `settings`, `storage`,
`ui` (header and composer buttons, message accessories and actions, profile sections),
`commands`, `messages` (local-only messages, send interceptors), `stores` (Phoenix's cache),
`fetch` and Discord API helpers.

The bundled plugins live in `plugins/*/src/index.ts`. CI bundles them with esbuild
(`web/tools/bundle-plugins.ts`) and publishes them to https://assets.sunbird.tools/.

Building this fork's Android runtime requires a JDK, Android SDK platform 30 or newer, and
SDK Build Tools with D8. Point `ANDROID_HOME` at the SDK. Cargo compiles the status-bar helper
from `crates/runtime-mobile/android/StatusBar.java` and bundles it with each Android ABI.

## Repository

| Path | What |
|---|---|
| `crates/loader` | The injected library (`libplm.so`). |
| `crates/runtime` | The QuickJS plugin runtime and the `phoenix` API, shared by every platform. |
| `crates/runtime-mobile` | The runtime's Android and iOS side: Phoenix's UI-op bridge, the Settings → Phoenix Unlocker pages and the UI patches. |
| `crates/runtime-desktop` | The runtime's Desktop Phoenix side. |
| `crates/hook`, `crates/sigs`, `crates/sigscan` | Native hooks, the gateway registry walk, a registry dump CLI. |
| `crates/ui-mobile`, `crates/wire` | Mobile (Android/iOS) UI-op and bridge frame codecs. |
| `crates/ui-desktop` | Desktop UI host primitives (clipboard, URLs, notifications, GPUI hooks). |
| `crates/patcher` | The command-line patcher. |
| `crates/patcher-web` | The same patcher built to wasm for the site. |
| `crates/stand-in*` | A fake Phoenix gateway library for testing hooks without Discord. |
| `plugins/` | The bundled plugins. |
| `web/` | What CI deploys to assets.sunbird.tools: the patcher wasm, loader libraries and plugin bundles. |
| `frida/` | The Frida gadget bootstrap. |

## Building

On Linux, with nix:

```sh
nix develop
nu scripts/phoenix.nu base.apk config.arm64_v8a.apk config.xxhdpi.apk config.en.apk
```

Pass `config.armeabi_v7a.apk` in place of the arm64 split for a 32-bit phone.
This builds the loader and the patcher, bundles the plugins, patches the splits and installs them
with adb. [AGENTS.md](AGENTS.md) covers building on Windows, the web patcher and testing.

The page itself lives in [sunbird-tools/site](https://github.com/sunbird-tools/site).

## Contributors

- [mantikafasi](https://github.com/mantikafasi)
- [Amaan Qureshi](https://github.com/amaanq)

Not affiliated with Discord.

[discord]: https://img.shields.io/discord/917308687423533086?logo=discord&label=discord
