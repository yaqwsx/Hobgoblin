# M5 - Desktop UI

## Issue: Implement 2D stack and planning region editor

### Context

The 2D view is the main shaft/planning editor. It represents `s` horizontally and radius vertically.

### Scope

- Draw stock, final stack profile, protected intervals, and planning polygons.
- Support feature selection from preview and feature tree.
- Support axis-aligned region handles.
- Support basic arbitrary polygon vertex move/add/delete.
- Add temporary measurement mode between selectable anchors.

### Out Of Scope

- Full simulation animation.
- 3D preview.
- Automatic planning optimization.

### Deliverables

- Interactive 2D planning view.
- Hit testing and selection model.
- Temporary measurement overlay.

### Verification

- Manual interaction with sample project.
- UI tests where practical.

### Dependencies

- M5 Tauri shell.
- M3 planning region model.

