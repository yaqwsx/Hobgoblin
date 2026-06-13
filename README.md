# Hobgoblin
Single-purpose CAM for cutting gears via hobbing simulation on 4 axis CNC machine using V-bits.

## Development

The current scaffold is a Rust workspace with a procedural project model, validation CLI, sample project files, and architecture notes.

Useful entry points:

- [Architecture](docs/architecture.md)
- [GitHub roadmap and milestones](docs/github-roadmap.md)
- [Agent task drafts](docs/tasks)

Once a Rust toolchain is installed:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p hobgoblin-cli -- validate examples/projects/simple_spur_stack.hobgoblin.json \
  --machine examples/library/carvera_air.machine.json \
  --tools examples/library/basic_tools.tools.json \
  --material examples/library/brass.material.json
cargo run -p hobgoblin-cli -- plan examples/projects/simple_spur_stack.hobgoblin.json \
  --machine examples/library/carvera_air.machine.json \
  --tools examples/library/basic_tools.tools.json \
  --material examples/library/brass.material.json
cargo run -p hobgoblin-cli -- debug-spur-path \
  examples/projects/simple_spur_stack.hobgoblin.json \
  feature.spur_20t \
  --stepping adaptive \
  --quality draft \
  --depth-layers 0.25 \
  --machine examples/library/carvera_air.machine.json \
  --tools examples/library/basic_tools.tools.json \
  --material examples/library/brass.material.json
cargo run -p hobgoblin-cli -- simulate-spur-path \
  examples/projects/simple_spur_stack.hobgoblin.json \
  feature.spur_20t \
  --stepping adaptive \
  --quality draft \
  --depth-layers 0.25 \
  --machine examples/library/carvera_air.machine.json \
  --tools examples/library/basic_tools.tools.json \
  --material examples/library/brass.material.json
cargo run -p hobgoblin-cli -- export-gcode \
  examples/projects/simple_spur_stack.hobgoblin.json \
  feature.spur_20t \
  examples/exports/simple_spur_stack.nc \
  --report examples/exports/simple_spur_stack.export.json \
  --stepping adaptive \
  --quality draft \
  --depth-layers 0.25 \
  --machine examples/library/carvera_air.machine.json \
  --tools examples/library/basic_tools.tools.json \
  --material examples/library/brass.material.json
```

The desktop shell is a Tauri + React/TypeScript app:

```sh
npm ci
npm run build
npm run dev
```

`npm run dev` starts the browser UI on port 1420 when it is free. If that port
is already occupied, Vite will choose the next available port and print the URL
to open. Native Tauri development uses the fixed URL from
`src-tauri/tauri.conf.json`:

```sh
npm run tauri dev
```

If a Hobgoblin Vite server is already running on port 1420, the Tauri dev
wrapper reuses it. If another process owns the port, the wrapper prints a
command for finding the owner.

Native `npm run tauri dev` requires the platform Tauri/WebKit system
dependencies. CI installs the Linux dependencies and covers:

```sh
npm ci
npm run build
npm run dev
HOBGOBLIN_UI_URL=http://127.0.0.1:1420/?sample=1 npm run test:ui
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

The UI smoke command expects a running Vite server; CI starts `npm run dev` in
the background before invoking it.

CI runs these checks on pushes to `main`, pull requests, and manual dispatch.
