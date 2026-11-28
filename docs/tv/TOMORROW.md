# First hardware session

1. **Prepare the host.** Run the commands below. Install Node 24 using the repository's .nvmrc. The CLI must expose ares-package, ares-setup-device, ares-novacom, ares-install, ares-launch and ares-inspect. If a command is missing, save its name and the output of node -v and npm -v.

   ```sh
   git clone --branch feature/tv-gamepad https://github.com/davideluque/otclient-web.git
   cd otclient-web
   nvm install
   npm ci
   npm install --global @webos-tools/cli@3.2.6
   cp .env.tv.example .env.tv.local
   ```

2. **Supply the game assets and network settings.** Place your own Tibia.dat, Tibia.spr and items.otb in public/assets/760/. Run `ls -lh public/assets/760/{Tibia.dat,Tibia.spr,items.otb}`. Expect three nonempty files. Edit .env.tv.local and fill in TV_IP, HOST_IP and OT_HOST. Keep TV_PORT and WS_PORT unless those ports are in use. Set both OT ports to 7171 for a single-port Jamera deployment. Otherwise use the server's actual login and game ports. Start that server. Allow the TV to reach the HTTP and WS ports over your trusted LAN.

3. **Enable the TV developer session.** On the TV install Developer Mode from LG's app store, sign in with your LG developer account, enable Dev Mode, follow the restart prompt, reopen Developer Mode, and enable Key Server. Keep the passphrase on the TV screen. If Dev Mode is off after restarting, complete that step before proceeding.

4. **Pair the CLI.** In the repository terminal run the commands below. Enter the displayed passphrase only at the CLI prompt. The final listing should include the CLI device alias. For a pre-existing alias with a changed address, use `--modify` in place of `--add`. If SSH fails, verify the screen's address, Key Server, session time and TCP 9922. Send the CLI error with the passphrase and addresses removed.

   ```sh
   . ./.env.tv.local
   ares-setup-device --add "$TV_DEVICE" --info "host=$TV_IP" --info "port=9922" --info "username=prisoner"
   ares-novacom --device "$TV_DEVICE" --getkey
   ares-setup-device --list
   ```

5. **Build, install and run diagnostics.** Run `npm run tv:deploy -- --diagnostics --logs`. Leave the terminal running. The TV should show Device diagnostics. If it says it cannot reach the host, open `http://<HOST_IP>:<TV_PORT>/jamera.html` on another device on the same LAN, check HOST_IP, the HTTP port and firewall, then select Retry. If the home screen opens an already-running game instead, open a second terminal in the checkout, run `. ./.env.tv.local`, then `ares-launch -d "$TV_DEVICE" -c org.otclient.tv` and `npm run tv:launch -- --diagnostics --logs`.

6. **Exercise the hardware.** Press and release each face and shoulder button, both stick clicks, Options and Create. Move the D-pad in all four directions. Push both sticks to every extreme. Press remote Back once. Wait at least five seconds. Expect a live pad ID and changing values plus “Report saved on host.” Run `cat docs/tv/device-report.json` on the host. Verify dimensions, WebGL renderer and maximum texture size, round-trip milliseconds, five-second rAF reading, input extrema and key codes. The diagnostic rAF reading measures an idle page. Save the report for comparison. If saving fails, check the WS port, exact origin and host console.

7. **Choose the observed branch.** A standard pad goes straight to play. A pad with an empty mapping goes through calibration. If Bluetooth produces no pad entry after a button press, connect via USB-C and repeat step 6. If only keys appear, stop before step 8. Save the file and identify the codes for each physical control, including controls that emit nothing. This build implements standard mapping and calibration through the Gamepad API. A key-only mapping requires those observations. If neither API nor keys produce input, stop here and share the report. In diagnostics, padChanges entries are [milliseconds, pad index, button or axis, control index, value]. Compare milliseconds with keys to identify duplicate inputs. A possible later fallback is a phone or laptop input relay. It has not been built.

8. **Log in and render.** Choose Open game in diagnostics. On a first launch, press and release a button. If prompted, leave sticks neutral for two seconds, press each requested control fully, then release it. Watch the step count and raw input readout. Choose Skip for an unavailable control. After 15 seconds the wizard offers Skip again. Finish can save a partial profile once ✕, ○, Options and all four directions on either input are assigned. Select account and password with ✕. Enter characters on the controller grid and choose Done. Account and password storage are independent opt-ins. Select Log in, then your character. Expect a visible world, health HUD, controller HUD and metrics. If Pixi fails, stop and collect the exact error and stack via `npm run tv:inspect`, the device report and any docs/tv/device-events.jsonl. Record whether WebGL1 and WebGL2 were available. A missing API can warrant a compatibility patch. An unsupported GL driver or shader requires a separate rendering decision.

9. **Test play and recovery.** Walk with D-pad and left stick. Open Options → Controller spells, assign an incantation your character knows, close with ○, and cast. Hold L1, L2 and both to check all layers. Before the first R3 press, run `rg -n 'idRange\(' '<deployed Jamera source>/source 7.6/'{player,monster,npc}.h` against the source of the running server. Expect 0x10000000, 0x40000000 and 0x80000000 respectively. For an unknown build, obtain the allocator from its operator before testing targeting. Once verified, use R3 near known monsters and L3 to stop. Check all four edges from the sofa. Open and close a pane using remote Back, disconnect the controller during a walk, reconnect, and select Retry. Press Ctrl-C in the deployment terminal, run `npm run tv:serve`, select Retry on the TV, and log in again. If an input fires twice, record the physical button, page, action and diagnostic key code.

10. **Record the baseline and reopen from Home.** Note resolution, scene, FPS, repaint, step latency, JS heap and atlas page count/bytes after one minute of movement with the real assets. A missing performance.memory reading is reported as unavailable. Close the app, launch it from TV Home, log in and repeat a walk and a cast without another device. Keep the host serving. For routine deployment use `npm run tv:deploy`. After a Developer Mode expiry enable it again and reinstall using the same command.

## Verification status

| Capability | Verified by tests here | Verified in real Chromium 79 here | Needs the TV |
| --- | --- | --- | --- |
| Production bundle | ES2019 parse of emitted JS and inline scripts, ES2017 diagnostic script, real replacement APIs removed in smoke, CSS declaration gate | Not run | LG module loading and WebGL driver |
| Input | Mapping, nonstandard profile, raw hats/triggers, neutral/release, repeated focus, disconnect and layer transitions in Vitest | Not run | Bluetooth/USB visibility, actual control positions and duplicate key timing |
| Play loop | Headless desktop Chromium 159.0.8154.6 with SwiftShader, controller-only account/password entry, character select, mock-server walk, cast, monster cycle, binding editor and retry | Not run | Physical DualSense, native TV environment, real OT service |
| TV layout and isolation | In-game computed insets measured 64 × 36 px at 720p and 96 × 54 px at 1080p. The touch joystick, touch spell bar and chat launcher were hidden at both sizes. Both flags off exercised through login and game in dev and built output. Password-saving prompt absent from default dist. | Not run | Overscan, legibility, stored options after cold launch |
| Diagnostics and deployment | Report POST, round trip, timestamped controls, opt-in log, unreachable-host Retry, cold launch in desktop Chromium, both IPK resolutions packaged with CLI 3.2.6 | Not run | Key exchange, IPK install/launch, remote Back and Developer Mode renewal |

Local gates passed under Node 24.22.3. Lint, default build, proxy typecheck, 986 unit tests, four development browser tests, four production smoke tests and the high-severity audit passed. No physical TV, physical controller or legacy browser was used. The ARM64 host has an x86-64 Chromium 79 executable. The standalone driver below remains unrun.

### Mock memory floor

| Viewport | JS heap bytes | Retained CPU atlas | Sampled FPS / last repaint |
| --- | ---: | --- | --- |
| 1280 × 720 | 27,600,000 | 1 × 2048² RGBA (16 MiB) | fps 13 / repaint 3ms |
| 1920 × 1080 | 26,000,000 | 1 × 2048² RGBA (16 MiB) | fps 6 / repaint 2ms |

Readings come after a confirmed step and a world repaint using generated fixtures. JS heap is the browser's reported value. GPU textures and driver allocations are additional. Software WebGL and an unthrottled cloud CPU produced these FPS samples. They cannot predict the K7LP frame rate. On the TV compare the Settings metrics with the real atlas loaded.

## Optional Chromium 79 check on x64 or Rosetta

Use a separate directory for Puppeteer 2 and an actual Chromium 79 executable. Run Node 24 for this repository and the driver. In three terminals in the checkout run `npm exec -- tsx proxy/mockOtServer.ts`, `npm run proxy`, and `npm run tv:build && npm exec -- vite preview --config vite.tv.config.ts --port 8180 --strictPort`. Stop the normal TV host first and use the default mock ports in these terminals. Then run the driver below. It intercepts assets, provides a fake pad, runs both resolutions and prints MOCK_BASELINE. If Chromium exits or the page fails, save its stderr, screenshot and exception.

```sh
# In the separate tools directory, install the driver once if needed:
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install --prefix "<tools directory>" puppeteer@2.0.0
PUPPETEER_2_DIR="<directory containing node_modules/puppeteer>" \
  node scripts/chromium79-smoke.mjs "<path to Chromium 79 executable>" \
  'http://127.0.0.1:8180/jamera.html?tv=1&metrics=1&proxy=ws://127.0.0.1:8090'
```
