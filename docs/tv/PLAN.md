# Hosted TV client plan

Reconnaissance used 1dcfcbb on the integration branch. The live entry is jamera.html. Leave the offline demo, packet implementations, walk cadence, cover zoom and atlas allocation alone.

| Phase | Integration and acceptance evidence |
| --- | --- |
| 1 | Lower the complete TV module graph, including Pixi, and parse the emitted modules. Expand positioning declarations in shared source. Package an address-free launcher and save device diagnostics on the host. |
| 2 | Exercise the shipped login and renderer through the mock bridge at both panel resolutions. Include atlas and heap readings. Repeat on the TV. |
| 3 | Poll fresh snapshots in a flag-loaded input module. Feed a cardinal direction into the existing walk controller. Test held controls across transitions. |
| 4 | Share the cast throttle and distance-sorted candidates. Keep automatic retargeting monster-only after a controller selection. Mount a six-slot HUD per session. |
| 5 | Navigate visible overlays in z-order. Keep the page-lifetime login navigator active across session changes. Apply overscan to both play area and DOM. |
| 6 | Persist 24 spell words separately from the touch slots. Learn button, signed axis and hat positions from neutral and active snapshots. |
| 7 | Record local evidence, package and document device checks. Measure before tuning. |

## Findings affecting the implementation

- README mentions root-level assets. The shipped manifest requests public/assets/760/Tibia.dat, Tibia.spr and items.otb. The cloud checkout contains ignored files at these paths. Use generated mock data in browser tests and never distribute those files.
- The battle list truncates to 25 after sorting. Filter monsters before truncation. Combat has a separate periodic nearest-target fallback that can acquire a player after the original target dies.
- main.ts already exposes the credential-bearing client in development. Remove that hook in accordance with the explicit credential requirement.
- The Playwright spec intercepts asset requests in the page. Use its generator for both development and production browser runs.
- The packaged shell cannot embed a host URL and also satisfy the address-free IPK requirement. Supply the URL on launch and remember it in the shell origin for later home-screen starts.
- ES2019 itself lacks module dynamic import and import.meta syntax. Check the emitted TV distribution, including inline scripts, and handle module loading explicitly if necessary.
- Real server identifiers, LG keyboard invocation, duplicate remote events, GPU initialization, memory and frame pacing require the hardware session.
- interactions.ts documents the Jamera allocator prefixes for players (1), monsters (4) and NPCs (8). Reject all other prefixes. Confirm the deployment uses that allocator before the first live fight.
- The manifest also lists world.otbm for the offline map. Online play needs only the other three entries.
