# CLAUDE.md - AI Assistant Guide for Append HMI Web

## Project Overview

Append HMI Web (Append Automation) serves Append HMI Studio projects (`.ahmi`) to web browsers.

- **Command line:** `append-hmi-web [--port n] [--view fit|fill|original] [--local-only] [--headless] project.ahmi` starts a project's web server.
- **Launcher:** with no project, a launcher window picks the file, port (default 8480), view and remote access, starts the server, creates shortcuts, and shows the link with Copy.
- **Repository:** https://github.com/AppendAutomation/AppendHMIWeb
- **License:** Apache 2.0 (`LICENSE`, `NOTICE`)

## Quick Reference

```bash
git clone --recursive https://github.com/AppendAutomation/AppendHMIWeb.git
npm install
npm run build-comms        # hmi-comms into studio/comms/publish (needs the .NET 8 SDK)
npm start                  # launcher; npm start -- --headless file.ahmi serves one (HMI_ENV=dev opens DevTools)
npm test                   # Node unit tests (server, sessions, args, links, shortcuts, packaging, installer)
npm run dist-win           # Windows x64 installer (on Linux too; no wine) -> dist/
npm run dist-linux         # AppImage + deb -> dist/
```

## Structure

```
src/main/main.js            Main process: args, headless mode, single instance, launcher, servers by port
src/main/server.js          HmiWebServer: HTTP (allowlisted web app files, gzip, index.html with the bridge) + WebSocket
src/main/rpc.js             BrowserSession: one per WebSocket, answers the runtime's requests; AlarmEvents
src/main/webfiles.js        The web app files served and packaged (WEBAPP_FILES)
src/main/network.js         The links to show (LAN addresses first)
src/web/bridge.js           Browser side: window.electron over the WebSocket, window.process, reconnect
src/launcher/               Launcher page (plain HTML/CSS/JS, strict CSP)
scripts/nsis.mjs            Installer script (firewall rule for private/domain networks)
studio/                     Submodule: AppendHMIStudio (drawio fork, comms server, main-process stores)
```

## How it reuses the Studio

- **The page:** browsers load `studio/drawio/src/main/webapp/index.html?chrome=0&hmiruntime=1&hmiviewmenu=1&hmiview=<view>`.
  - `/` redirects there; `index.html` is served with `/hmi-web/bridge.js` before `bootstrap.js`.
- **The bridge:** sets `window.electron` (with `hmiWeb: true`) and `window.process.versions.electron`.
  - The editor then runs in its desktop mode. This relies on the drawio fork's `bootstrap.js` accepting `window.electron.hmiWeb`, and on `EditorUi.isElectronApp`.
- **Server answers:** `rpc.js` answers the same actions Studio's main process answers for a published package: `hmiRuntime.*`, `hmiComms.*`, `hmiAlarms.*`, `hmiRetentive.*` and `hmiUsers.*`. `hmiRuntime.exit` answers false.
- **Imported from `studio/src/main`:** `runtime/RuntimeMode.js`, `comms/*`, `alarms/AlarmLog.js`, `retentive/RetentiveStore.js`, `security/UserStore.js`.
- **Views:** Fit, Maximize (`fill`: CSS stretch, with `mxUtils.convertPoint` corrected) and Original, plus the in-page menu. They live in Studio (`HmiWindowManager.setView`, `HmiRuntimeApp.showViewMenu`).
- **Changing the runtime:** make the change in AppendHMIStudio first, then move the submodule.

## Behaviour to keep

- **Browsers are independent:** comms session, login and acknowledgements are per browser.
  - The alarm history is shared and written once per real change (`AlarmEvents` keeps each tag's alarm state).
  - Retentive values and runtime users are shared.
- **What is served:** only `WEBAPP_FILES` and the bridge. Paths are normalised and traversal refused.
  - The WebSocket requires an `Origin` matching `Host`.
  - CSP and `frame-ancestors 'none'` on every response.
- **The launcher:** it may act only on paths from the OS dialog, the command line or the recent list. Copy and Open accept only links of running servers.
- **Shutting down:** closing the launcher with servers running asks first. Quitting stops the servers before the process exits, so browsers see the connection close.
- **Windows Firewall:** the per-machine installer adds a rule named "Append HMI Web" for the exe, on private and domain profiles only, and removes it on uninstall.

## Code Style

- ES modules in the main process, Tab indentation, Allman braces, sparse comments.
- US spelling in UI text and comments.

## Testing

- `npm test`: `server.test.js` starts a real server on a free port against the submodule's web app, including a WebSocket round trip.
- **Browsers:** Chrome headless over CDP, and Firefox (a snap here) over WebDriver BiDi, with a profile under `~/snap/firefox/common`.
  - Load `http://localhost:<port>/`, then check `HmiRuntimeApp.ui.hmiRuntime` and screenshot.
  - A JavaScript `alert()` blocks a headless page, so handle dialogs.
- **Windows box:** install `/S`, run `--headless` on a port, and open `http://<the box's address>:<port>/` from another computer (this tests the firewall rule); then uninstall.
