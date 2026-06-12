# M4 - Carvera Air postprocessor and export

## Issue: Emit conservative Carvera Air G-code from abstract paths

### Context

Carvera Air is the first physical target. Abstract paths should be postprocessed only after validation/simulation succeeds.

### Scope

- Add Carvera Air machine profile loading.
- Map project axes to machine `X/Y/Z/A`.
- Emit startup, spindle, feed, rapid, linear cut, and shutdown G-code.
- Preserve rotary sign as a machine-profile setting.
- Write sidecar export report.

### Out Of Scope

- Tool changer automation beyond placeholders.
- Controller-specific probing.
- Multi-setup workflows.

### Deliverables

- G-code postprocessor API.
- CLI `export-gcode` command.
- Sidecar report with project hash, tools, operations, and simulation status.

### Verification

- `cargo test -p hobgoblin-post`
- Golden G-code fixture for the sample project once path generation exists.

### Dependencies

- M3 simulation preview.

