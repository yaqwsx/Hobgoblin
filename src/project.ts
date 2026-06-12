import type { ValidationDiagnostic, ValidationResponse } from "./tauri";

export interface HobgoblinProject {
  schema_version: number;
  unit_system: "metric";
  project: {
    id: string;
    name: string;
    datum: {
      kind: string;
      s_offset_mm: number;
    };
  };
  setup: {
    id: string;
    name: string;
    machine_profile_id: string;
    workholding?: {
      held_side: "left" | "right";
      tailstock: {
        enabled: boolean;
        protected_start_s_mm: number | null;
        protected_end_s_mm: number | null;
      };
    };
    protected_intervals?: ProtectedInterval[];
  };
  stock: {
    id: string;
    diameter_mm: number;
    length_mm: number;
    material_id: string;
  };
  stack: StackItem[];
  planning_regions?: PlanningRegion[];
  library_refs?: {
    machine_profile_id?: string;
    material_id?: string;
    tool_ids?: string[];
  };
}

export interface StackItem {
  id: string;
  name: string;
  length_mm: number;
  type: string;
  [key: string]: unknown;
}

export interface ProtectedInterval {
  id: string;
  purpose: string;
  start_s_mm: number;
  end_s_mm: number;
}

export interface PlanningRegion {
  id: string;
  name: string;
  stage: number;
  purpose: string;
  polygon: PointSr[];
  allowed_feature_ids?: string[];
}

export interface PointSr {
  s_mm: number;
  r_mm: number;
}

export interface ParsedProject {
  source: string;
  project: HobgoblinProject;
}

export function parseProjectSource(source: string): ParsedProject {
  return {
    source,
    project: JSON.parse(source) as HobgoblinProject,
  };
}

export function validateProjectInBrowser(source: string): ValidationResponse {
  const diagnostics: ValidationDiagnostic[] = [];
  let project: HobgoblinProject | null = null;
  try {
    project = parseProjectSource(source).project;
  } catch (error) {
    diagnostics.push({
      severity: "error",
      object_id: null,
      message: error instanceof Error ? error.message : "Project JSON could not be parsed",
    });
  }

  if (!project) {
    return { diagnostics, intervals: [] };
  }

  if (project.unit_system !== "metric") {
    diagnostics.push({
      severity: "error",
      object_id: project.project?.id ?? null,
      message: "Only metric projects are supported",
    });
  }

  const intervals = [];
  let cursor = project.project.datum.s_offset_mm;
  for (const item of project.stack ?? []) {
    const start = cursor;
    cursor += item.length_mm;
    intervals.push({
      item_id: item.id,
      start_s_mm: start,
      end_s_mm: cursor,
    });
    if (!(item.length_mm > 0)) {
      diagnostics.push({
        severity: "error",
        object_id: item.id,
        message: "Stack item length must be positive",
      });
    }
  }

  return { diagnostics, intervals };
}

export function featureTypeLabel(type: string): string {
  switch (type) {
    case "cylindrical_section":
      return "Cylindrical";
    case "spur_gear":
      return "Spur gear";
    case "helical_gear":
      return "Helical gear";
    case "herringbone_gear":
      return "Herringbone";
    case "eccentric_section":
      return "Eccentric";
    default:
      return type;
  }
}
