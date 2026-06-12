import type { HobgoblinProject, PlanningRegion, PointSr, StackItem } from "./project";

export interface StackSpan {
  item: StackItem;
  startS: number;
  endS: number;
}

export interface RegionBounds {
  minS: number;
  maxS: number;
  minR: number;
  maxR: number;
}

export function stackSpans(project: HobgoblinProject): StackSpan[] {
  let cursor = project.project.datum.s_offset_mm;
  return project.stack.map((item) => {
    const startS = cursor;
    cursor += item.length_mm;
    return { item, startS, endS: cursor };
  });
}

export function radiusForItem(item: StackItem): number {
  if (typeof item.radius_mm === "number") {
    return item.radius_mm;
  }
  if (item.type === "spur_gear") {
    return radiusForSpurLike(item);
  }
  if (item.type === "helical_gear") {
    return radiusForSpurLike(objectValue(item.spur));
  }
  if (item.type === "herringbone_gear") {
    return Math.max(
      radiusForSpurLike(objectValue(objectValue(item.left)?.spur)),
      radiusForSpurLike(objectValue(objectValue(item.right)?.spur)),
    );
  }
  return 0;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function radiusForSpurLike(gear: Record<string, unknown> | null): number {
  if (!gear || typeof gear.module_mm !== "number" || typeof gear.tooth_count !== "number") {
    return 0;
  }
  const addendumCoeff = typeof gear.addendum_coeff === "number" ? gear.addendum_coeff : 1.0;
  return (gear.module_mm * gear.tooth_count) / 2.0 + gear.module_mm * addendumCoeff;
}

export function regionBounds(region: PlanningRegion): RegionBounds | null {
  if (region.polygon.length === 0) {
    return null;
  }
  return region.polygon.reduce<RegionBounds>(
    (bounds, point) => ({
      minS: Math.min(bounds.minS, point.s_mm),
      maxS: Math.max(bounds.maxS, point.s_mm),
      minR: Math.min(bounds.minR, point.r_mm),
      maxR: Math.max(bounds.maxR, point.r_mm),
    }),
    {
      minS: region.polygon[0].s_mm,
      maxS: region.polygon[0].s_mm,
      minR: region.polygon[0].r_mm,
      maxR: region.polygon[0].r_mm,
    },
  );
}

export function isAxisAlignedRectangle(region: PlanningRegion): boolean {
  if (region.polygon.length !== 4) {
    return false;
  }
  const bounds = regionBounds(region);
  if (!bounds) {
    return false;
  }
  const corners = new Set(
    region.polygon.map((point) => `${point.s_mm.toFixed(6)},${point.r_mm.toFixed(6)}`),
  );
  return (
    corners.has(`${bounds.minS.toFixed(6)},${bounds.minR.toFixed(6)}`) &&
    corners.has(`${bounds.minS.toFixed(6)},${bounds.maxR.toFixed(6)}`) &&
    corners.has(`${bounds.maxS.toFixed(6)},${bounds.minR.toFixed(6)}`) &&
    corners.has(`${bounds.maxS.toFixed(6)},${bounds.maxR.toFixed(6)}`)
  );
}

export function rectanglePolygon(bounds: RegionBounds): PointSr[] {
  return [
    { s_mm: bounds.minS, r_mm: bounds.maxR },
    { s_mm: bounds.maxS, r_mm: bounds.maxR },
    { s_mm: bounds.maxS, r_mm: bounds.minR },
    { s_mm: bounds.minS, r_mm: bounds.minR },
  ];
}

export function distance(a: PointSr, b: PointSr): number {
  return Math.hypot(b.s_mm - a.s_mm, b.r_mm - a.r_mm);
}

export function formatMm(value: number): string {
  return `${value.toFixed(3)} mm`;
}
