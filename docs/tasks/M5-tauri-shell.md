# M5 - Desktop UI

## Issue: Create Tauri desktop shell with project loading and validation panel

### Context

The UI should be a client of the Rust kernel. The first screen is the shaft editor, not a landing page.

### Scope

- Scaffold Tauri + TypeScript app.
- Load/save `*.hobgoblin.json` project files.
- Call Rust validation from the UI.
- Display feature tree, inspector placeholder, and diagnostics panel.

### Out Of Scope

- Full 2D polygon editing.
- 3D preview.
- Toolpath simulation playback.

### Deliverables

- Tauri app scaffold.
- Project load/save flow.
- Validation diagnostics with object selection hooks.

### Verification

- `npm run build` or equivalent.
- Manual load of `examples/projects/simple_spur_stack.hobgoblin.json`.

### Dependencies

- M1 core validation.

