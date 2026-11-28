# TV implementation decisions

| Question | Choice and reason | How to change it |
| --- | --- | --- |
| Which hardware branch can run unattended? | Implement W3C mapping and calibration. Local tests exercise both. Actual branch selection still requires the report from the TV. | Follow the decision tree in TOMORROW.md. |
| Which IDs can R3 attack? | The local Jamera server checkout at `0eb87c7` declares prefixes 0x1, 0x4 and 0x8 in player.h, monster.h and npc.h. R3 only accepts 0x4, including timer-based replacement. The same protection covers Battle and the Settings auto-attack toggle throughout an opted-in controller session. A missing target disarms an unrestricted attack. | Confirm the deployed allocator against that revision before changing the policy. |
| How does the IPK find the host? | CLI launch parameters carry the address. The shell saves the host and proxy port in its own origin for home-screen launches. A cache-busted image probe works across file and HTTP origins. | Launch again with updated .env.tv.local. |
| How to meet a strict ES2019 gate and still load on demand? | Use Vite 8's Chromium 79 and ES2019 targets across dependencies. Convert literal lazy imports in emitted modules into static module facades loaded on demand. Acorn already comes with the locked lint toolchain. | Revisit when retiring ES2019. The regular Vite config is independent. |
| What changed for existing users? | CSS longhands preserve pane positioning. Desktop and touch casts share cooldown per incantation even after slot edits. A failed send leaves the spell available. Removed the existing development window.jameraClient global because it retained the password. GameWorld, chat and Pixi development hooks remain available to tests. An early clean close of the login socket now re-enables the form instead of leaving every login control disabled. A normal close after the list arrives preserves selection. | Adjust the cooldown policy in combatBinding. Inspect non-secret data through dedicated hooks. |
| How can login work without a trusted native keyboard event? | Provide a controller text-entry grid for activated fields, with masked password output. Physical keyboards and native field input still work. | Replace it with native OSK invocation if the TV proves that path reliable for every controller press. |
| How is UI mode determined? | Use the visible login screen, open menu, known pane classes and dialogs. Compare stacking order and document order. Recheck on DOM changes. Scope directional focus and Back to the top surface. | Register future pane selectors in gamepad/focus.ts or mark a new dialog with data-pad-dialog. |
| Can the remote duplicate controller keys? | Compare matching events in an 80 ms window. Remote Back uses the pane back action. | Tune padKeyMs after measuring the device. |
| Which resolution and which performance changes? | Start at 1280×720, keep WebGL, cover zoom, density, atlas construction and walk timing. Display JS heap when exposed plus exact retained CPU atlas bytes. GPU texture memory is additional. | Set TV_RESOLUTION=1920x1080 and redeploy only after a real measurement. |
| Does this run need extra wire operations? | The existing say, attack and movement builders cover the requested play loop. No new wire operations. | Separate a future capability into a tested game-level change with protocol fixtures. |
| Where can credentials and diagnostic data go? | Unchecked storage options by default. Password option requires TV runtime and TV build mode. Opt-in logs send lifecycle labels and error locations. Raw key codes are collected on the separate diagnostic page only. Host records are ignored by git. | Uncheck storage or clear site data. Omit --logs, or stop the local diagnostics-enabled proxy. |
| Which assets and test tools were used? | Ignored asset files were present in this checkout. All game smoke flows intercept the three asset downloads with generated fixtures. Node 24, global LG CLI, Acorn and Playwright were available. The sandbox could not initialize its loopback namespace, so repository commands ran with reviewed escalation. | Use the documented host setup. Run the legacy browser check separately on x64. |

LG documents launch parameters on cold launch and relaunch. The shell also reads the initial system launchParams string supported by the installed CLI. [LG app lifecycle](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management)

The shell requests the 720p resolution and direct Back events. Its two icon sizes follow the LG metadata specification. LG documents cloudgame_active for webOS TV 23 and later, so the 2021 device report remains essential. [LG app metadata](https://webostv.developer.lge.com/develop/references/appinfo-json)

Both 1280×720 and 1920×1080 IPKs were packaged with CLI 3.2.6 and their embedded appinfo.json files inspected. The last local package is 720p. The hosted server and proxy also answered an HTTP request and a WebSocket ping together on loopback.

### A1 · Calibration

Learn the resting axes after 160 ms of stable release. Finish becomes available once ✕, ○, Options and a complete direction source are assigned. Skip preserves an empty slot. A 15-second prompt leaves the decision to the player. Run calibration again to replace these assignments.

### A2 · Remote and keyboard fallback

Match Arrow and Enter against their individual pad events for 80 ms. Adjust with ?padKeyMs=0 through 250 after comparing diagnostics timestamps. Native Enter and gameplay arrow events otherwise keep their usual behavior.

### A3 · Controller profile recovery

Use the LG green key (404) to open recovery without using any mapped button. Continue pauses the controller for this page. Recalibrate or Use standard mapping resumes it. The shell forwards a one-shot reset on launch or deploy.

### A4 · Sleep and network recovery

The pad notice dismisses on reconnection or Continue. The game connection notice has its own Retry and Back route. A sleeping pad can reconnect during keyboard play.
