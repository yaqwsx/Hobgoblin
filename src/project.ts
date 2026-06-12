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

  for (const region of project.planning_regions ?? []) {
    if (region.polygon.length < 3) {
      diagnostics.push({
        severity: "error",
        object_id: region.id,
        message: "planning region polygon must contain at least three points",
      });
    }
    for (const point of region.polygon) {
      if (!Number.isFinite(point.s_mm) || !Number.isFinite(point.r_mm)) {
        diagnostics.push({
          severity: "error",
          object_id: region.id,
          message: "planning region polygon points must be finite",
        });
      }
      if (point.r_mm < 0) {
        diagnostics.push({
          severity: "error",
          object_id: region.id,
          message: "planning region radius coordinates must be non-negative",
        });
      }
    }
    if (polygonSelfIntersects(region.polygon)) {
      diagnostics.push({
        severity: "error",
        object_id: region.id,
        message: "planning region polygon must not self-intersect",
      });
    }
  }

  return { diagnostics, intervals };
}

function polygonSelfIntersects(points: PointSr[]): boolean {
  if (points.length < 4) {
    return false;
  }
  for (let startIndex = 0; startIndex < points.length; startIndex += 1) {
    const startA = points[startIndex];
    const endA = points[(startIndex + 1) % points.length];
    for (let candidateIndex = startIndex + 1; candidateIndex < points.length; candidateIndex += 1) {
      if (polygonEdgesAreAdjacent(startIndex, candidateIndex, points.length)) {
        continue;
      }
      const startB = points[candidateIndex];
      const endB = points[(candidateIndex + 1) % points.length];
      if (segmentsIntersect(startA, endA, startB, endB)) {
        return true;
      }
    }
  }
  return false;
}

function polygonEdgesAreAdjacent(firstIndex: number, secondIndex: number, count: number): boolean {
  return (
    firstIndex === secondIndex ||
    Math.abs(firstIndex - secondIndex) === 1 ||
    (firstIndex === 0 && secondIndex === count - 1)
  );
}

function segmentsIntersect(a: PointSr, b: PointSr, c: PointSr, d: PointSr): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && pointOnSegment(a, c, b)) {
    return true;
  }
  if (abD === 0 && pointOnSegment(a, d, b)) {
    return true;
  }
  if (cdA === 0 && pointOnSegment(c, a, d)) {
    return true;
  }
  if (cdB === 0 && pointOnSegment(c, b, d)) {
    return true;
  }
  return abC !== abD && cdA !== cdB;
}

function orientation(a: PointSr, b: PointSr, c: PointSr): -1 | 0 | 1 {
  const cross = (b.s_mm - a.s_mm) * (c.r_mm - a.r_mm) - (b.r_mm - a.r_mm) * (c.s_mm - a.s_mm);
  const epsilon = 1e-9;
  if (Math.abs(cross) <= epsilon) {
    return 0;
  }
  return cross > 0 ? 1 : -1;
}

function pointOnSegment(a: PointSr, point: PointSr, b: PointSr): boolean {
  const epsilon = 1e-9;
  return (
    point.s_mm >= Math.min(a.s_mm, b.s_mm) - epsilon &&
    point.s_mm <= Math.max(a.s_mm, b.s_mm) + epsilon &&
    point.r_mm >= Math.min(a.r_mm, b.r_mm) - epsilon &&
    point.r_mm <= Math.max(a.r_mm, b.r_mm) + epsilon
  );
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
