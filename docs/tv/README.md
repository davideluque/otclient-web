# Playing the hosted client on webOS

The host serves dist-tv over HTTP and bridges game traffic to the OT server. The installed app is a small launcher. Keep the host running while playing. Use the hardware checklist for first-time Developer Mode setup, assets, pairing, diagnostics and the first login. [Hardware checklist](TOMORROW.md)

After setup, run `npm run tv:deploy` from the checkout. This builds the client, checks compatibility, packages the shell, installs it, starts both host services and launches the app. Keep that terminal open. On subsequent days, `npm run tv:serve` serves the last build with the same proxy. Open OTClient from the TV home screen. Rebuild client-only updates with `npm run tv:build` and reopen the app.

| Command | Purpose |
| --- | --- |
| `npm run tv:build` / `npm run tv:check` | Build the TV distribution, or repeat its syntax, API and CSS checks. |
| `npm run tv:package` | Make the address-free IPK under .webos-build using the global LG CLI. |
| `npm run tv:install` | Install the last IPK on the configured CLI device. |
| `npm run tv:launch -- --diagnostics --logs` | Launch diagnostics with the configured host and proxy. Choose Open game to continue with opt-in logs. |
| `npm run tv:inspect` | Open LG's remote web inspector for the running app. |
| `npm run tv:smoke` | Rebuild and test both TV resolutions with generated mock assets, a fake controller and software WebGL. |

## Controller

Press and release a button once to make the browser expose the pad. D-pad or left stick moves one cardinal direction. ✕ ○ □ △ R1 R2 cast the six visible incantations. Hold L1, L2 or both for the other three layers. R3 cycles living monsters, nearest first. L3 clears the attack. Options opens the game menu. Create shows or closes the layout.

Choose **Controller spells** to assign or clear any slot. Changes take effect immediately. **Calibrate controller** learns the raw inputs one at a time and stores the profile by device ID. Follow the neutral and release prompts. An unknown mapping opens calibration on first connection. Every game session displays the active layer and cooling spells in the controller HUD.

In a menu the D-pad moves focus, ✕ selects, and ○ or remote Back closes the top surface. Activate a login field to use the controller text-entry grid. The password grid includes printable ASCII, Shift, Delete and Done. Choose Done to return to the form. Saving the account is optional. The TV distribution separately offers plain-text password storage. Clear its checkbox to erase the saved value. Pad profiles, spells and credentials belong to the hosted origin, so changing the host address or port changes which settings are visible.

On a fresh Linux test host, install Playwright’s software-browser prerequisites with `npx playwright install --with-deps --only-shell chromium` before running the smoke suite.

## Desktop development

Run `npm run dev` and the proxy, connect the pad to the computer and open `/jamera.html?gamepad=1&autologin=0` on localhost. Use `?tv=1` for TV layout and `?tv=0` to override Web0S user-agent detection. Password storage is offered only in the TV build.

## Limits

Inventory management, chat typing during combat, targeted runes, item use-with, diagonals and turn-in-place have no game-mode controller binding. The binding editor lists spell incantations, including spells that conjure items. Actual availability depends on character vocation, learned spells, mana and the server. The system owns PS. A missing device report means hardware verification is still pending.

The baseline uses one mock atlas page. The real asset set, CPU/GPU memory, Bluetooth mapping and sustained frame rate require measurement on the TV before changing resolution or atlas allocation. Developer Mode expires on the TV's own countdown. Open Developer Mode and extend the session before it expires. If the app was removed, enable Dev Mode again, verify the CLI key, and run the deployment command again.
