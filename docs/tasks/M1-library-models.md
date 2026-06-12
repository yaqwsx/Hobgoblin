# M1 - Core project model and validation

## Issue: Add typed machine, tool, and material library models

### Context

Libraries are global app configuration, but projects reference tools/materials/machines and later need generation-time snapshots.

### Scope

- Add Rust structs for machine profiles, V cutters, cylindrical cutters, and material recipes.
- Parse example library JSON files.
- Validate project references against loaded libraries.
- Represent feed recipes by material, tool class, operation type, and engagement mode.

### Out Of Scope

- In-app library editor.
- Real feed/speed recommendations beyond sample defaults.
- Project snapshotting.

### Deliverables

- Typed library model.
- Library loading helpers.
- Validation that missing tool/material/machine IDs are errors.

### Verification

- `cargo test --workspace`
- CLI validation with explicit library paths, if implemented.

### Dependencies

- M1 core validation.

