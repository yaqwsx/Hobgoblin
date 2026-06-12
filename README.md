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
```

CI runs these checks on pushes to `main`, pull requests, and manual dispatch.
