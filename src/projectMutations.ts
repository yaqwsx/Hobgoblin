import type { HobgoblinProject, PlanningRegion, StackItem } from "./project";

export type StackItemType =
  | "cylindrical_section"
  | "spur_gear"
  | "helical_gear"
  | "herringbone_gear"
  | "eccentric_section";

export type StackItemPatch = Partial<Omit<StackItem, "id">>;
export type ProjectStockPatch = Partial<HobgoblinProject["stock"]>;
export type ProjectMetadataPatch = Partial<HobgoblinProject["project"]>;
export type SetupPatch = Partial<HobgoblinProject["setup"]> & Record<string, unknown>;

const ENDMILL_TOOL_ID = "tool.endmill.3mm.flat";
const V_CUTTER_TOOL_ID = "tool.v.60deg.3mm_flat";

const STACK_TYPE_LABELS: Record<StackItemType, string> = {
  cylindrical_section: "Cylindrical section",
  spur_gear: "Spur gear",
  helical_gear: "Helical gear",
  herringbone_gear: "Herringbone gear",
  eccentric_section: "Eccentric section",
};

const STACK_TYPE_SLUGS: Record<StackItemType, string> = {
  cylindrical_section: "cylindrical",
  spur_gear: "spur",
  helical_gear: "helical",
  herringbone_gear: "herringbone",
  eccentric_section: "eccentric",
};

const gearMachining = {
  od_tool_id: ENDMILL_TOOL_ID,
  v_tool_id: V_CUTTER_TOOL_ID,
  root_tool_id: V_CUTTER_TOOL_ID,
};

const cylindricalMachining = {
  roughing_tool_id: ENDMILL_TOOL_ID,
  finishing_tool_id: ENDMILL_TOOL_ID,
};

const defaultSpurGear = {
  module_mm: 0.5,
  tooth_count: 20,
  pressure_angle_deg: 20.0,
  profile_shift: 0.0,
  addendum_coeff: 1.0,
  dedendum_coeff: 1.25,
  backlash_mm: 0.02,
  phase_deg: 0.0,
  machining: gearMachining,
};

export function createStackItem(type: StackItemType, existingStack: StackItem[]): StackItem {
  const id = nextId(`feature.${STACK_TYPE_SLUGS[type]}`, existingStack.map((item) => item.id));
  const name = numberedName(STACK_TYPE_LABELS[type], id);

  switch (type) {
    case "cylindrical_section":
      return {
        id,
        name,
        length_mm: 12.0,
        type,
        radius_mm: 4.0,
        machining: { ...cylindricalMachining },
      };
    case "spur_gear":
      return {
        id,
        name,
        length_mm: 10.0,
        type,
        ...defaultSpurGear,
        machining: { ...gearMachining },
      };
    case "helical_gear":
      return {
        id,
        name,
        length_mm: 12.0,
        type,
        helix_angle_deg: 15.0,
        hand: "right",
        spur: {
          ...defaultSpurGear,
          machining: { ...gearMachining },
        },
      };
    case "herringbone_gear":
      return {
        id,
        name,
        length_mm: 16.0,
        type,
        center_relief_width_mm: 1.0,
        left: {
          helix_angle_deg: 15.0,
          hand: "left",
          spur: {
            ...defaultSpurGear,
            machining: { ...gearMachining },
          },
        },
        right: {
          helix_angle_deg: 15.0,
          hand: "right",
          spur: {
            ...defaultSpurGear,
            phase_deg: 180.0 / defaultSpurGear.tooth_count,
            machining: { ...gearMachining },
          },
        },
      };
    case "eccentric_section":
      return {
        id,
        name,
        length_mm: 12.0,
        type,
        radius_mm: 3.0,
        offset_y_mm: 1.0,
        offset_z_mm: 0.0,
      };
  }
}

export function insertStackItem(
  project: HobgoblinProject,
  item: StackItem,
  index = project.stack.length,
): HobgoblinProject {
  const boundedIndex = clampIndex(index, project.stack.length);
  return {
    ...project,
    stack: [
      ...project.stack.slice(0, boundedIndex),
      item,
      ...project.stack.slice(boundedIndex),
    ],
  };
}

export function updateStackItem(
  project: HobgoblinProject,
  itemId: string,
  patch: StackItemPatch,
): HobgoblinProject {
  return {
    ...project,
    stack: project.stack.map((item) => (item.id === itemId ? { ...item, ...patch, id: item.id } : item)),
  };
}

export function reorderStackItem(
  project: HobgoblinProject,
  itemId: string,
  direction: "up" | "down",
): HobgoblinProject {
  const fromIndex = project.stack.findIndex((item) => item.id === itemId);
  if (fromIndex === -1) {
    return project;
  }

  const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= project.stack.length) {
    return project;
  }

  const stack = [...project.stack];
  const [item] = stack.splice(fromIndex, 1);
  stack.splice(toIndex, 0, item);
  return { ...project, stack };
}

export function createPlanningRegion(project: HobgoblinProject): PlanningRegion {
  const stockStartS = project.project.datum.s_offset_mm;
  const stockEndS = stockStartS + project.stock.length_mm;
  const stockRadius = project.stock.diameter_mm / 2.0;
  const safeLengthEnd = Math.max(stockStartS, stockEndS - Math.min(5.0, project.stock.length_mm * 0.1));
  const innerRadius = Math.max(0.0, stockRadius - Math.min(2.0, stockRadius * 0.3));
  const existingRegions = project.planning_regions ?? [];

  return {
    id: nextId("region.roughing", existingRegions.map((region) => region.id)),
    name: "Roughing region",
    stage: 10,
    purpose: "roughing",
    allowed_feature_ids: project.stack.map((item) => item.id),
    polygon: [
      { s_mm: stockStartS, r_mm: stockRadius },
      { s_mm: safeLengthEnd, r_mm: stockRadius },
      { s_mm: safeLengthEnd, r_mm: innerRadius },
      { s_mm: stockStartS, r_mm: innerRadius },
    ],
  };
}

export function insertPlanningRegion(
  project: HobgoblinProject,
  region: PlanningRegion,
): HobgoblinProject {
  return {
    ...project,
    planning_regions: [...(project.planning_regions ?? []), region],
  };
}

export function updateProjectStock(
  project: HobgoblinProject,
  patch: ProjectStockPatch,
): HobgoblinProject {
  return {
    ...project,
    stock: { ...project.stock, ...patch },
  };
}

export function updateProjectMetadata(
  project: HobgoblinProject,
  patch: ProjectMetadataPatch,
): HobgoblinProject {
  return {
    ...project,
    project: { ...project.project, ...patch },
  };
}

export function updateSetup(project: HobgoblinProject, patch: SetupPatch): HobgoblinProject {
  return {
    ...project,
    setup: { ...project.setup, ...patch },
  };
}

function nextId(prefix: string, existingIds: string[]): string {
  const existing = new Set(existingIds);
  if (!existing.has(prefix)) {
    return prefix;
  }

  let suffix = 2;
  while (existing.has(`${prefix}_${suffix}`)) {
    suffix += 1;
  }
  return `${prefix}_${suffix}`;
}

function numberedName(baseName: string, id: string): string {
  const suffixMatch = id.match(/_(\d+)$/);
  return suffixMatch ? `${baseName} ${suffixMatch[1]}` : baseName;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length;
  }
  return Math.min(Math.max(Math.trunc(index), 0), length);
}
