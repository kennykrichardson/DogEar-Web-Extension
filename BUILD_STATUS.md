# Build and validation status

**Release candidate:** DogEar 1.0.0 source package (renamed from the previous project build)  
**Validation date:** 2026-11-09

## Checks completed in this environment

- 23 Node.js unit tests pass, covering text normalization and matching, repeated and overlapping passage recovery, URL/permission-pattern handling, tag normalization, DogEar Markdown/JSON export, legacy backup compatibility, 0.x and 1.0.0 data migration, malformed-storage recovery, serialized saves, update, and delete.
- The corrected storage layer (`storage.ts`, shared types, and anchor helpers) passes strict TypeScript 5.8.3 checking with a temporary `chrome.storage` declaration. The full project typecheck against installed React, Chrome, Lucide, Vite, and Node declarations remains unverified because dependencies are not installed in this environment.
- Manifest JSON and source resource references were inspected.
- The content script is wrapped in an isolated IIFE and the production verification script checks that the built injected script is self-contained, that required extension pages/assets exist, and that the Manifest V3 package is structurally complete.
- Runtime source inspection confirms the extension has no backend, AI service, telemetry, external API, remote font, or runtime network request.

## Checks blocked by this environment

The uploaded source package has no `node_modules` folder, and npm registry access is unavailable in this environment. Consequently:

- The actual dependency-backed `npm run typecheck` has **not** been completed.
- The Vite production build and `scripts/verify-build.mjs` have **not** been executed against a generated `dist/` directory.
- A real Chrome/Edge unpacked-extension smoke test has **not** been completed.

No generated `dist/` folder is included or represented as tested. On a machine with npm registry access, run:

```bash
npm install
npm run check
npm run build
```

Then load `dist/` from `chrome://extensions` or `edge://extensions` with Developer mode enabled and run the end-to-end checklist in `README.md`.
