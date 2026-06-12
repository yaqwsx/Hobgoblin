# UI smoke testing

Run the M6 browser smoke test against a local UI server:

```sh
npm run dev
```

Then, in another shell:

```sh
npm run test:ui
```

The smoke script uses `HOBGOBLIN_UI_URL` when set and otherwise loads the sample project from `http://127.0.0.1:1420/?sample=1`.
It writes a visual smoke screenshot to `target/ui-smoke/hobgoblin-ui-smoke.png` by default.

```sh
HOBGOBLIN_UI_URL=http://127.0.0.1:4173/?sample=1 npm run test:ui
```

Use `HOBGOBLIN_UI_SCREENSHOT=/path/to/file.png` to choose a different screenshot output path.

The workflow covered by `scripts/ui-smoke.mjs` loads the simple spur stack sample, checks the grouped command ribbon accessibility, creates cylinder, spur, protected interval, and planning-region edits, verifies tree and viewport selection drive the inspector, edits stock and gear values, exercises non-finite numeric input without crashing, reorders a stack item, exercises region vertex add/delete, and verifies measure mode.
