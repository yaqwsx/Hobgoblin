# GitHub Roadmap

Use GitHub Issues as the task handoff surface for Hobgoblin agents. Use GitHub Milestones to group issues by implementation phase.

## Milestones

Create these milestones in GitHub:

1. `M0 - Architecture and scaffold`
2. `M1 - Core project model and validation`
3. `M2 - Gear math and generated shaping kernel`
4. `M3 - Planning and simulation`
5. `M4 - Carvera Air postprocessor and export`
6. `M5 - Desktop UI`

## Labels

Recommended labels:

- `agent-task`: scoped task suitable for an implementation agent.
- `design`: unresolved product, geometry, or CAM decision.
- `kernel`: Rust core, gear, planner, simulation, or postprocessor work.
- `ui`: desktop/web UI work.
- `simulation`: material removal, preview, or collision validation.
- `postprocessor`: machine profile or G-code export work.
- `docs`: architecture or user/developer documentation.

## Agent Task Rules

Each task should include:

- Context: what the agent needs to know before editing.
- Scope: concrete included work.
- Out of scope: explicit boundaries.
- Deliverables: expected files/APIs/behavior.
- Verification: commands, tests, sample projects, or manual checks.
- Dependencies: prior issues or design decisions.

Agents should keep PRs narrow, link the issue they address, and avoid unrelated refactors.

## Ready-To-Create Issues

The issue drafts in [docs/tasks](tasks) are written so they can be pasted into GitHub issues. Assign each issue to the milestone named in its header.

## Current Automation Note

Milestones were created with `gh milestone-manager` on 2026-06-12:

- [M0 - Architecture and scaffold](https://github.com/yaqwsx/Hobgoblin/milestone/1)
- [M1 - Core project model and validation](https://github.com/yaqwsx/Hobgoblin/milestone/2)
- [M2 - Gear math and generated shaping kernel](https://github.com/yaqwsx/Hobgoblin/milestone/3)
- [M3 - Planning and simulation](https://github.com/yaqwsx/Hobgoblin/milestone/4)
- [M4 - Carvera Air postprocessor and export](https://github.com/yaqwsx/Hobgoblin/milestone/5)
- [M5 - Desktop UI](https://github.com/yaqwsx/Hobgoblin/milestone/6)

The task drafts in [docs/tasks](tasks) still need to be imported as GitHub issues and assigned to these milestones.
