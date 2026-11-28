# Integration and verification log

1. Map TV implementation to the live client. [#409](https://github.com/davideluque/otclient-web/pull/409)
2. Expand game CSS inset declarations. [#410](https://github.com/davideluque/otclient-web/pull/410)
3. Add a monster-only attack cycle. [#411](https://github.com/davideluque/otclient-web/pull/411)
4. Share spell casting and cooldowns. [#412](https://github.com/davideluque/otclient-web/pull/412)
5. Build and check the ES2019 TV distribution. [#413](https://github.com/davideluque/otclient-web/pull/413)
6. Map controller frames to layered actions. [#414](https://github.com/davideluque/otclient-web/pull/414)
7. Read standard and calibrated gamepad snapshots. [#415](https://github.com/davideluque/otclient-web/pull/415)
8. Navigate game surfaces with directional focus. [#416](https://github.com/davideluque/otclient-web/pull/416)
9. Display the current controller spell layer. [#417](https://github.com/davideluque/otclient-web/pull/417)
10. Edit controller spells and calibrate raw controls. [#418](https://github.com/davideluque/otclient-web/pull/418)
11. Play the live client through controller actions. [#419](https://github.com/davideluque/otclient-web/pull/419)
12. Adapt login and game surfaces for webOS TV. [#420](https://github.com/davideluque/otclient-web/pull/420)
13. Collect webOS device observations through the proxy. [#421](https://github.com/davideluque/otclient-web/pull/421)
14. Package and launch the hosted webOS app. [#422](https://github.com/davideluque/otclient-web/pull/422)
15. Verify compatibility and flag isolation on the TV build. [#423](https://github.com/davideluque/otclient-web/pull/423)
16. Recover login after an early WebSocket close. [#424](https://github.com/davideluque/otclient-web/pull/424)
17. Show controller activation and spell readiness. [#425](https://github.com/davideluque/otclient-web/pull/425)
18. Hardware checklist, decision record and verification inventory. [#426](https://github.com/davideluque/otclient-web/pull/426)

Each integration PR received a fresh read-only review and a local run of lint, production build, proxy typecheck, Vitest and the development Playwright suite. The production smoke suite additionally exercises the TV distribution. GitHub runs the main-branch CI on the final draft PR.

## Phase reports

| Phase | Changes and local evidence | Hardware acceptance remaining |
| --- | --- | --- |
| 0 | PLAN.md reconciles the revision, manifest, combat timer, developer hooks and test harness. | Match the local server source to the installed OT service. |
| 1 | Dedicated Vite build, strict emitted syntax/API/CSS checks, plain diagnostics, opt-in proxy sink and address-free shell. LG CLI packaged the IPK. Playwright tested unreachable-host Retry and remembered cold launch. | Developer Mode install, remote launch, report capture, Gamepad API access on a LAN HTTP origin. |
| 2 | Production distribution logged in, mounted Pixi, repainted a mock map, displayed metrics and received server-confirmed steps at both resolutions. | LG WebGL driver, real asset set, real server login and sustained memory. |
| 3 | Pure frame mapping and fresh snapshot polling tested for first activation, mode changes, holds, disconnects, same-slot replacements, hats and axis triggers. Mock-server D-pad walk confirmed. | Physical stick dead zone, Bluetooth reconnection and button layout. |
| 4 | Shared cooldowns, filtered cycling/retargeting, HUD gallery and four layers. Browser asserted spell echoes and the complete mock attack ID sequence with another player nearby. | Confirm real character spell availability, target IDs and HUD legibility. |
| 5 | Top-surface focus, controller text grid, login/character selection, overscan, opt-in storage, Back and recovery. Tests exercised gamepad-only entry and retry. | Remote duplication, overscan edges, TV storage durability and Home relaunch. |
| 6 | Spell editor, picker and raw calibration. Unit tests covered duplicate capture, optional unused stick and a complete profile. Browser edited and cast from L1/L2. | Learn and reuse this particular DualSense profile. |
| 7 | TOMORROW.md has the measurements, checklist, legacy-browser driver and fallback branches. | Device tuning and the final sofa session. |

## Existing files changed

Paths below are relative to the repository root. This inventory includes every pre-existing file changed since 1dcfcbb.

| File | Reason |
| --- | --- |
| `.gitignore` | Exclude TV build, IPK staging and private reports. |
| `README.md` | Correct the online asset path and link the TV setup and deployment checklist. |
| `eslint.config.js` | Exclude the generated TV distribution. |
| `package.json` | Expose build, checks, smoke, host and LG deployment commands. Dependency versions are unchanged. |
| `proxy/mockOtServer.ts` | Provide two monsters, a closer player and acknowledgements for attack assertions. |
| `proxy/server.ts` | Route the opt-in report, logs and ping, and signal readiness to the deployment command after binding the port. |
| `scripts/playwright.config.mjs` | Share mock services between the dev and production flows, configure SwiftShader, isolate TV reports. |
| `src/__tests__/GameClient.test.ts` | Cover a clean login close before and after delivery of a character list. |
| `src/__tests__/combatBinding.test.ts` | Exercise cooldown ownership, filtered selection and automatic replacement. |
| `src/lib/actionSheet.ts` | Expand inset shorthand for Chromium 79 and use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/battleList.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/changelogPane.ts` | Expand inset shorthand for Chromium 79. |
| `src/lib/chat/ChatUI.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/chat/FullChatView.ts` | Expand inset shorthand for Chromium 79 and use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/chat/GlanceChatOverlay.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/chat/QuickChatView.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/combatModes.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/containerPane.ts` | Expand inset shorthand for Chromium 79 and use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/deathDialog.ts` | Expand inset shorthand for Chromium 79. |
| `src/lib/devControls.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/gallery/registry.ts` | Register the controller HUD after existing gallery entries. |
| `src/lib/gameMenu.ts` | Expand inset shorthand for Chromium 79 and use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/hud.ts` | Expand inset shorthand for Chromium 79 and use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/inventoryPane.ts` | Expand inset shorthand for Chromium 79 and use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/jamera/battleBinding.ts` | Extract the sorted living-candidate list. |
| `src/lib/jamera/combatBinding.ts` | Own spell readiness and enforce the monster policy for controller sessions. |
| `src/lib/jamera/gameMessageOverlay.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/jamera/loginScreen.html` | Expand inset shorthand for Chromium 79. |
| `src/lib/jamera/main.ts` | Flag-gated module loading, session handles, movement source, menu actions, metrics, renderer errors and credential hook removal. |
| `src/lib/jamera/metricsOverlay.ts` | Render TV heap and atlas readings and respect the safe area. |
| `src/lib/jamera/tapFeedback.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/joystick.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/minimap.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/net/common/GameClient.ts` | Re-enable login after an early socket close, using the existing error and state events. |
| `src/lib/settingsPane.ts` | Expand inset shorthand for Chromium 79. |
| `src/lib/shopPane.ts` | Expand inset shorthand for Chromium 79. |
| `src/lib/skillPane.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/spellBar.ts` | Delegate live readiness to combat, preserve standalone cooldowns and expand CSS offsets. |
| `src/lib/spellCustomizer.ts` | Expand inset shorthand for Chromium 79. |
| `src/lib/statusBar.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/storageNotice.ts` | Use the TV overscan variable with the existing safe-area fallback. |
| `src/lib/textWindow.ts` | Expand inset shorthand for Chromium 79. |
| `src/lib/vipList.ts` | Expand inset shorthand for Chromium 79. |

- **A1 · Calibration** — Regression coverage for changed trigger rests, dual exposure, hat and split-axis pads, skipping and cancellation.

- **A2 · Remote and keyboard fallback** — Browser regression exercises server-confirmed keyboard walking, native Enter and duplicate activation with an attached pad.

- **A3 · Controller profile recovery** — Shell cold-launch and hosted-game tests cover scoped reset, standard override and forgetting a profile.

- **A4 · Sleep and network recovery** — Reproduced stuck native Enter. Browser tests cover no-pad Enter, pointer continuation, reconnect and network Back.

- **A5 · Startup failure evidence** — Browser regression checks banner, bounded stack, rejection and omission of unrelated error properties. Diagnostics displays and saves its own errors.

- **B1 · Passive game panes** — Browser regression reproduces blocked steps and checks server confirmation from both controller and keyboard with Battle visible.
