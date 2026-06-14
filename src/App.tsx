import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  CheckCircle2,
  CirclePlus,
  Cog,
  Crosshair,
  Database,
  FileDown,
  FileUp,
  HardDrive,
  Layers,
  ListTree,
  Maximize2,
  MousePointer2,
  MoveDown,
  MoveUp,
  Play,
  Save,
  Trash2,
  Wrench,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import * as THREE from "three";
import {
  distance,
  formatMm,
  isAxisAlignedRectangle,
  radiusForItem,
  rectanglePolygon,
  regionBounds,
  stackSpans,
  type RegionBounds,
} from "./geometry";
import {
  featureTypeLabel,
  parseProjectSource,
  validateProjectInBrowser,
  type HobgoblinProject,
  type PlanningRegion,
  type PointSr,
  type StackItem,
} from "./project";
import {
  createPlanningRegion,
  createStackItem,
  insertPlanningRegion,
  insertStackItem,
  reorderStackItem,
  updateProjectMetadata as patchProjectMetadata,
  updateProjectStock,
  updateSetup as patchSetup,
  updateStackItem,
  type StackItemType,
} from "./projectMutations";
import {
  generateToolpathsFromSource,
  isTauriRuntime,
  loadProjectFromPath,
  pickProjectOpenPath,
  pickProjectSavePath,
  saveProjectToPath,
  validateProjectSource,
  type AbstractMove,
  type GeneratedToolpath,
  type OperationSummary,
  type ToolpathGenerationResponse,
  type ValidationDiagnostic,
  type ValidationResponse,
} from "./tauri";

interface LoadedProject {
  source: string;
  project: HobgoblinProject;
  validation: ValidationResponse;
  pathLabel: string;
  savePath: string | null;
}

const samplePath = "examples/projects/simple_spur_stack.hobgoblin.json";
type EditorMode = "select" | "measure";
type PreviewMode = "schematic" | "model3d";
type MeasurementAnchor = {
  id: string;
  label: string;
  point: PointSr;
};
type FeaturePosition = {
  start_s_mm: number;
  end_s_mm: number;
};
type MoveDirection = "up" | "down";
type AppMode = "design" | "libraries";
type LibraryTab = "machine" | "tools" | "materials" | "exchange";
type ToolType = "v_cutter" | "cylindrical_cutter";

interface LibraryConfig {
  machineProfiles: MachineProfile[];
  tools: ToolDefinition[];
  materials: MaterialDefinition[];
}

interface MachineProfile {
  id: string;
  name: string;
  axis_mapping: {
    shaft_axis: string;
    virtual_rack_axis: string;
    radial_axis: string;
    rotary_axis: string;
    rotary_sign: number;
  };
  limits: {
    max_stock_diameter_mm: number;
    max_stock_length_mm: number;
    travel_x_mm: number;
    travel_y_mm: number;
    travel_z_mm: number;
    max_spindle_rpm: number;
  };
  postprocessor: string;
}

interface ToolDefinition {
  id: string;
  type: ToolType;
  name: string;
  included_angle_deg?: number;
  tip_flat_width_mm?: number;
  max_cut_diameter_mm?: number;
  diameter_mm?: number;
  corner_radius_mm?: number;
  flute_length_mm: number;
  cutting_length_mm?: number;
  shank_diameter_mm: number;
  stickout_mm: number;
  holder_diameter_mm?: number;
  holder_length_mm?: number;
}

interface MaterialDefinition {
  id: string;
  name: string;
  recipes: MaterialRecipe[];
}

interface MaterialRecipe {
  tool_class: ToolType;
  operation: string;
  engagement: string;
  feed_mm_min: number;
  spindle_rpm: number;
  radial_depth_per_pass_mm: number;
}

const defaultMachineId = "machine.carvera_air.default";
const defaultMaterialId = "material.brass.generic";
const defaultEndmillId = "tool.endmill.3mm.flat";
const defaultVCutterId = "tool.v.60deg.3mm_flat";
const defaultLibraryConfig: LibraryConfig = {
  machineProfiles: [
    {
      id: defaultMachineId,
      name: "Makera Carvera Air",
      axis_mapping: {
        shaft_axis: "X",
        virtual_rack_axis: "Y",
        radial_axis: "Z",
        rotary_axis: "A",
        rotary_sign: 1,
      },
      limits: {
        max_stock_diameter_mm: 92,
        max_stock_length_mm: 200,
        travel_x_mm: 300,
        travel_y_mm: 200,
        travel_z_mm: 130,
        max_spindle_rpm: 13000,
      },
      postprocessor: "carvera_air",
    },
  ],
  tools: [
    {
      id: defaultVCutterId,
      type: "v_cutter",
      name: "60 degree V cutter, 0.3 mm flat",
      included_angle_deg: 60,
      tip_flat_width_mm: 0.3,
      max_cut_diameter_mm: 6,
      flute_length_mm: 8,
      shank_diameter_mm: 3.175,
      stickout_mm: 18,
      holder_diameter_mm: 12,
      holder_length_mm: 25,
    },
    {
      id: defaultEndmillId,
      type: "cylindrical_cutter",
      name: "3 mm flat endmill",
      diameter_mm: 3,
      corner_radius_mm: 0,
      flute_length_mm: 10,
      cutting_length_mm: 10,
      shank_diameter_mm: 3.175,
      stickout_mm: 18,
    },
  ],
  materials: [
    {
      id: defaultMaterialId,
      name: "Generic brass",
      recipes: [
        {
          tool_class: "v_cutter",
          operation: "roughing",
          engagement: "full_width_generate",
          feed_mm_min: 80,
          spindle_rpm: 12000,
          radial_depth_per_pass_mm: 0.1,
        },
        {
          tool_class: "v_cutter",
          operation: "flank_generation",
          engagement: "side_flank_generate",
          feed_mm_min: 160,
          spindle_rpm: 12000,
          radial_depth_per_pass_mm: 0.05,
        },
        {
          tool_class: "cylindrical_cutter",
          operation: "surface_finishing",
          engagement: "cylindrical_surface",
          feed_mm_min: 250,
          spindle_rpm: 12000,
          radial_depth_per_pass_mm: 0.2,
        },
      ],
    },
  ],
};

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [status, setStatus] = useState("No project loaded");
  const [editorMode, setEditorMode] = useState<EditorMode>("select");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("schematic");
  const [measurementAnchors, setMeasurementAnchors] = useState<MeasurementAnchor[]>([]);
  const [undoStack, setUndoStack] = useState<LoadedProject[]>([]);
  const [redoStack, setRedoStack] = useState<LoadedProject[]>([]);
  const [appMode, setAppMode] = useState<AppMode>("design");
  const [toolpathResult, setToolpathResult] = useState<ToolpathGenerationResponse | null>(null);
  const [library, setLibrary] = useState<LibraryConfig>(defaultLibraryConfig);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("machine");
  const [selectedMachineId, setSelectedMachineId] = useState(defaultMachineId);
  const [selectedToolId, setSelectedToolId] = useState(defaultVCutterId);
  const [selectedMaterialId, setSelectedMaterialId] = useState(defaultMaterialId);
  const [libraryJson, setLibraryJson] = useState(() => JSON.stringify(defaultLibraryConfig, null, 2));

  const selectedFeature = useMemo(() => {
    if (!loaded || !selectedObjectId) {
      return null;
    }
    return loaded.project.stack.find((item) => item.id === selectedObjectId) ?? null;
  }, [loaded, selectedObjectId]);

  const selectedFeatureInterval = useMemo(() => {
    if (!loaded || !selectedObjectId) {
      return null;
    }
    const span = stackSpans(loaded.project).find((candidate) => candidate.item.id === selectedObjectId);
    return span ? { start_s_mm: span.startS, end_s_mm: span.endS } : null;
  }, [loaded, selectedObjectId]);

  const selectedRegion = useMemo(() => {
    if (!loaded || !selectedObjectId) {
      return null;
    }
    return (
      (loaded.project.planning_regions ?? []).find((region) => region.id === selectedObjectId) ??
      null
    );
  }, [loaded, selectedObjectId]);

  const selectedProtectedInterval = useMemo(() => {
    if (!loaded || !selectedObjectId) {
      return null;
    }
    return (
      loaded.project.setup.protected_intervals?.find(
        (interval) => interval.id === selectedObjectId,
      ) ?? null
    );
  }, [loaded, selectedObjectId]);

  const diagnosticsForSelection = useMemo(() => {
    if (!loaded || !selectedObjectId) {
      return [];
    }
    return loaded.validation.diagnostics.filter(
      (diagnostic) => diagnostic.object_id === selectedObjectId,
    );
  }, [loaded, selectedObjectId]);

  const validationCounts = useMemo(() => {
    const diagnostics = loaded?.validation.diagnostics ?? [];
    return {
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    };
  }, [loaded]);
  const machineOptions = library.machineProfiles.map((profile) => profile.id);
  const toolOptions = library.tools.map((tool) => tool.id);
  const materialOptions = library.materials.map((material) => material.id);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sample") === "1") {
      void loadSampleProject();
    }
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    const validation = validateBrowserSource(loaded.source);
    setLoaded((current) => (current?.source === loaded.source ? { ...current, validation } : current));
  }, [library]);

  function selectProjectObject(objectId: string) {
    setAppMode("design");
    setSelectedObjectId(objectId);
  }

  async function openProject() {
    if (!isTauriRuntime()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const path = await pickProjectOpenPath();
      if (!path) {
        setStatus("Open canceled");
        return;
      }
      const response = await loadProjectFromPath(path);
      applyLoadedSource(response.source, response.validation, path, path);
      setStatus(`Loaded ${path}`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function loadSampleProject() {
    if (isTauriRuntime()) {
      try {
        const response = await loadProjectFromPath(samplePath);
        applyLoadedSource(response.source, response.validation, samplePath, samplePath);
        setStatus(`Loaded ${samplePath}`);
      } catch (error) {
        setStatus(errorMessage(error));
      }
      return;
    }

    try {
      const response = await fetch(`/${samplePath}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch sample project: ${response.status}`);
      }
      const source = await response.text();
      const validation = await validateSource(source);
      applyLoadedSource(source, validation, samplePath, samplePath);
      setStatus(`Loaded ${samplePath}`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function openFromFile(file: File) {
    try {
      const source = await file.text();
      const validation = await validateSource(source);
      applyLoadedSource(source, validation, file.name, null);
      setStatus(`Loaded ${file.name}`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  function newProject() {
    const project = createDefaultProject();
    const source = JSON.stringify(project, null, 2);
    applyLoadedSource(source, validateProjectInBrowser(source), "untitled.hobgoblin.json", null);
    setStatus("Created new shaft project");
  }

  async function saveProject() {
    if (!loaded) {
      setStatus("No project is loaded");
      return;
    }
    if (isTauriRuntime()) {
      const targetPath = loaded.savePath ?? (await pickProjectSavePath(fileNameFromPathLabel(loaded.pathLabel)));
      if (!targetPath) {
        setStatus("Save canceled");
        return;
      }
      try {
        await saveProjectToPath(targetPath, loaded.source);
        if (targetPath !== loaded.savePath) {
          setLoaded({ ...loaded, pathLabel: targetPath, savePath: targetPath });
        }
        setStatus(`Saved ${targetPath}`);
      } catch (error) {
        setStatus(errorMessage(error));
      }
      return;
    }

    const blob = new Blob([loaded.source], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = fileNameFromPathLabel(loaded.pathLabel);
    link.click();
    URL.revokeObjectURL(href);
    setStatus("Downloaded project JSON");
  }

  async function revalidate() {
    if (!loaded) {
      setStatus("No project is loaded");
      return;
    }
    try {
      const validation = await validateSource(loaded.source);
      setLoaded({ ...loaded, validation });
      setStatus("Validation refreshed");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  function previewSchematic() {
    if (!loaded) {
      setStatus("No project is loaded");
      return;
    }
    setStatus(`Preview ready: ${loaded.project.stack.length} stack items, ${(loaded.project.planning_regions ?? []).length} planning regions`);
  }

  async function generateToolpaths() {
    if (!loaded) {
      setStatus("No project is loaded");
      return;
    }
    try {
      const usingRustPlanner = isTauriRuntime();
      const result = usingRustPlanner
        ? await generateToolpathsFromSource(loaded.source)
        : generateBrowserToolpathPreview(loaded.project);
      setToolpathResult(result);
      const diagnosticCount = result.diagnostics.length;
      const pathMoveCount = result.paths.reduce((sum, path) => sum + path.path.path.moves.length, 0);
      setStatus(
        diagnosticCount > 0
          ? `Toolpath generation reported ${diagnosticCount} diagnostic${diagnosticCount === 1 ? "" : "s"}`
          : usingRustPlanner
            ? `Generated ${result.paths.length} path${result.paths.length === 1 ? "" : "s"} with ${pathMoveCount} abstract moves`
            : `Browser preview generated ${result.paths.length} fallback path${result.paths.length === 1 ? "" : "s"} with ${pathMoveCount} abstract moves; desktop uses the Rust planner`,
      );
    } catch (error) {
      setToolpathResult(null);
      setStatus(`Toolpath generation failed: ${errorMessage(error)}`);
    }
  }

  async function validateSource(source: string) {
    const validation = isTauriRuntime() ? await validateProjectSource(source) : validateProjectInBrowser(source);
    return appendLibraryDiagnostics(source, validation);
  }

  function validateBrowserSource(source: string) {
    return appendLibraryDiagnostics(source, validateProjectInBrowser(source));
  }

  function appendLibraryDiagnostics(source: string, validation: ValidationResponse): ValidationResponse {
    try {
      const project = parseProjectSource(source).project;
      return {
        ...validation,
        diagnostics: [...validation.diagnostics, ...libraryDiagnostics(project, library)],
      };
    } catch {
      return validation;
    }
  }

  function applyLoadedSource(source: string, validation: ValidationResponse, pathLabel: string, savePath: string | null) {
    const parsed = parseProjectSource(source);
    setLoaded({
      source,
      project: parsed.project,
      validation,
      pathLabel,
      savePath,
    });
    setSelectedObjectId(parsed.project.stack[0]?.id ?? parsed.project.stock.id);
    setMeasurementAnchors([]);
    setUndoStack([]);
    setRedoStack([]);
    setAppMode("design");
    setToolpathResult(null);
  }

  function updateProject(project: HobgoblinProject, statusMessage: string) {
    const source = JSON.stringify(project, null, 2);
    const isDesktopRuntime = isTauriRuntime();
    const validation = isDesktopRuntime
      ? {
          diagnostics: [
            {
              severity: "warning" as const,
              object_id: null,
              message: "Validation pending after edit",
            },
          ],
          intervals: loaded?.validation.intervals ?? [],
        }
      : validateBrowserSource(source);
    if (loaded) {
      setUndoStack((history) => [...history.slice(-19), loaded]);
      setRedoStack([]);
      setLoaded({
        ...loaded,
        source,
        project,
        validation,
      });
    }
    setStatus(statusMessage);
    setToolpathResult(null);
    if (isDesktopRuntime) {
      void validateProjectSource(source)
        .then((nextValidation) => {
          const refreshedValidation = appendLibraryDiagnostics(source, nextValidation);
          setLoaded((current) =>
            current?.source === source ? { ...current, validation: refreshedValidation } : current,
          );
          setStatus(`${statusMessage}; validation refreshed`);
        })
        .catch((error) => {
          setStatus(errorMessage(error));
        });
    }
  }

  function updateMachineProfile(profileId: string, updater: (profile: MachineProfile) => MachineProfile) {
    setLibrary((current) => ({
      ...current,
      machineProfiles: current.machineProfiles.map((profile) =>
        profile.id === profileId ? updater(profile) : profile,
      ),
    }));
    setStatus(`Edited ${profileId}`);
  }

  function updateTool(toolId: string, updater: (tool: ToolDefinition) => ToolDefinition) {
    setLibrary((current) => ({
      ...current,
      tools: current.tools.map((tool) => (tool.id === toolId ? updater(tool) : tool)),
    }));
    setStatus(`Edited ${toolId}`);
  }

  function updateMaterial(materialId: string, updater: (material: MaterialDefinition) => MaterialDefinition) {
    setLibrary((current) => ({
      ...current,
      materials: current.materials.map((material) =>
        material.id === materialId ? updater(material) : material,
      ),
    }));
    setStatus(`Edited ${materialId}`);
  }

  function addLibraryTool(type: ToolType) {
    setLibrary((current) => {
      const prefix = type === "v_cutter" ? "tool.v.manual" : "tool.endmill.manual";
      const existingIds = new Set(current.tools.map((tool) => tool.id));
      let suffix = 1;
      let id = prefix;
      while (existingIds.has(id)) {
        suffix += 1;
        id = `${prefix}_${suffix}`;
      }
      const tool: ToolDefinition =
        type === "v_cutter"
          ? {
              id,
              type,
              name: "Manual V cutter",
              included_angle_deg: 60,
              tip_flat_width_mm: 0.2,
              max_cut_diameter_mm: 6,
              flute_length_mm: 8,
              shank_diameter_mm: 3.175,
              stickout_mm: 18,
              holder_diameter_mm: 12,
              holder_length_mm: 25,
            }
          : {
              id,
              type,
              name: "Manual cylindrical cutter",
              diameter_mm: 3,
              corner_radius_mm: 0,
              flute_length_mm: 10,
              cutting_length_mm: 10,
              shank_diameter_mm: 3.175,
              stickout_mm: 18,
            };
      setSelectedToolId(id);
      setLibraryTab("tools");
      setAppMode("libraries");
      setStatus(`Added ${tool.name}`);
      return { ...current, tools: [...current.tools, tool] };
    });
  }

  function exportLibraryConfig() {
    setLibraryJson(JSON.stringify(library, null, 2));
    setStatus("Library JSON refreshed for export");
  }

  function importLibraryConfig() {
    try {
      const parsed = JSON.parse(libraryJson) as LibraryConfig;
      if (!Array.isArray(parsed.machineProfiles) || !Array.isArray(parsed.tools) || !Array.isArray(parsed.materials)) {
        throw new Error("Library JSON must contain machineProfiles, tools, and materials arrays");
      }
      setLibrary(parsed);
      setSelectedMachineId(parsed.machineProfiles[0]?.id ?? defaultMachineId);
      setSelectedToolId(parsed.tools[0]?.id ?? defaultVCutterId);
      setSelectedMaterialId(parsed.materials[0]?.id ?? defaultMaterialId);
      setStatus("Imported library JSON");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  function restoreProjectSnapshot(snapshot: LoadedProject, statusMessage: string) {
    setLoaded(snapshot);
    setSelectedObjectId(snapshot.project.stack[0]?.id ?? snapshot.project.stock.id);
    setMeasurementAnchors([]);
    setStatus(statusMessage);
  }

  function undoProjectEdit() {
    const previous = undoStack[undoStack.length - 1];
    if (!previous || !loaded) {
      return;
    }
    setRedoStack((redoHistory) => [...redoHistory.slice(-19), loaded]);
    setUndoStack(undoStack.slice(0, -1));
    restoreProjectSnapshot(previous, "Undid project edit");
  }

  function redoProjectEdit() {
    const next = redoStack[redoStack.length - 1];
    if (!next || !loaded) {
      return;
    }
    setUndoStack((undoHistory) => [...undoHistory.slice(-19), loaded]);
    setRedoStack(redoStack.slice(0, -1));
    restoreProjectSnapshot(next, "Redid project edit");
  }

  function updatePlanningRegion(regionId: string, updater: (region: PlanningRegion) => PlanningRegion) {
    if (!loaded) {
      return;
    }
    const project = {
      ...loaded.project,
      planning_regions: (loaded.project.planning_regions ?? []).map((region) =>
        region.id === regionId ? updater(region) : region,
      ),
    };
    updateProject(project, `Edited ${regionId}`);
  }

  function updateFeature(featureId: string, patch: Partial<StackItem>) {
    if (!loaded) {
      return;
    }
    updateProject(updateStackItem(loaded.project, featureId, patch), `Edited ${featureId}`);
  }

  function updateStock(patch: Partial<HobgoblinProject["stock"]>) {
    if (!loaded) {
      return;
    }
    updateProject(updateProjectStock(loaded.project, patch), "Edited stock");
  }

  function updateProjectMetadata(patch: Partial<HobgoblinProject["project"]>) {
    if (!loaded) {
      return;
    }
    updateProject(patchProjectMetadata(loaded.project, patch), "Edited project");
  }

  function updateSetup(patch: Partial<HobgoblinProject["setup"]>) {
    if (!loaded) {
      return;
    }
    updateProject(patchSetup(loaded.project, patch), "Edited setup");
  }

  function updateProtectedInterval(intervalId: string, patch: { start_s_mm?: number; end_s_mm?: number; purpose?: string }) {
    if (!loaded) {
      return;
    }
    updateProject(
      {
        ...loaded.project,
        setup: {
          ...loaded.project.setup,
          protected_intervals: (loaded.project.setup.protected_intervals ?? []).map((interval) =>
            interval.id === intervalId ? { ...interval, ...patch } : interval,
          ),
        },
      },
      `Edited ${intervalId}`,
    );
  }

  function deleteStackItem(itemId: string) {
    if (!loaded) {
      return;
    }
    if (loaded.project.stack.length <= 1) {
      setStatus("The stack must contain at least one feature");
      return;
    }
    const deletedIndex = loaded.project.stack.findIndex((item) => item.id === itemId);
    const deletedItem = loaded.project.stack[deletedIndex];
    if (deletedIndex < 0) {
      return;
    }
    const stack = loaded.project.stack.filter((item) => item.id !== itemId);
    let removedDependentRegionCount = 0;
    const planningRegions = (loaded.project.planning_regions ?? []).flatMap((region) => {
      if (!region.allowed_feature_ids) {
        return [region];
      }
      const allowed_feature_ids = region.allowed_feature_ids.filter((featureId) => featureId !== itemId);
      if (allowed_feature_ids.length === 0) {
        removedDependentRegionCount += 1;
        return [];
      }
      return [{ ...region, allowed_feature_ids }];
    });
    updateProject(
      {
        ...loaded.project,
        stack,
        planning_regions: planningRegions,
      },
      removedDependentRegionCount > 0
        ? `Deleted ${deletedItem?.name ?? itemId} and ${removedDependentRegionCount} dependent planning region${removedDependentRegionCount === 1 ? "" : "s"}`
        : `Deleted ${deletedItem?.name ?? itemId}`,
    );
    setMeasurementAnchors([]);
    setSelectedObjectId(stack[Math.min(deletedIndex, stack.length - 1)]?.id ?? loaded.project.stock.id);
  }

  function deletePlanningRegion(regionId: string) {
    if (!loaded) {
      return;
    }
    const region = (loaded.project.planning_regions ?? []).find((candidate) => candidate.id === regionId);
    updateProject(
      {
        ...loaded.project,
        planning_regions: (loaded.project.planning_regions ?? []).filter((candidate) => candidate.id !== regionId),
      },
      `Deleted ${region?.name ?? regionId}`,
    );
    setMeasurementAnchors([]);
    setSelectedObjectId(loaded.project.stock.id);
  }

  function deleteProtectedInterval(intervalId: string) {
    if (!loaded) {
      return;
    }
    updateProject(
      {
        ...loaded.project,
        setup: {
          ...loaded.project.setup,
          protected_intervals: (loaded.project.setup.protected_intervals ?? []).filter((interval) => interval.id !== intervalId),
        },
      },
      `Deleted ${intervalId}`,
    );
    setMeasurementAnchors([]);
    setSelectedObjectId(loaded.project.setup.id);
  }

  function addStackItem(type: StackItemType) {
    if (!loaded) {
      return;
    }
    const item = createStackItem(type, loaded.project.stack);
    const project = insertStackItem(loaded.project, item);
    updateProject(project, `Added ${item.name}`);
    setSelectedObjectId(item.id);
  }

  function moveStackItem(itemId: string, direction: MoveDirection) {
    if (!loaded) {
      return;
    }
    const item = loaded.project.stack.find((candidate) => candidate.id === itemId);
    updateProject(reorderStackItem(loaded.project, itemId, direction), `Moved ${item?.name ?? itemId}`);
  }

  function moveStackItemToIndex(itemId: string, targetIndex: number) {
    if (!loaded) {
      return;
    }
    const fromIndex = loaded.project.stack.findIndex((item) => item.id === itemId);
    if (fromIndex < 0 || targetIndex < 0 || targetIndex >= loaded.project.stack.length || fromIndex === targetIndex) {
      return;
    }
    const stack = [...loaded.project.stack];
    const [item] = stack.splice(fromIndex, 1);
    stack.splice(targetIndex, 0, item);
    updateProject(
      {
        ...loaded.project,
        stack,
      },
      `Moved ${item.name}`,
    );
    setSelectedObjectId(item.id);
  }

  function addPlanningRegion() {
    if (!loaded) {
      return;
    }
    const region = createPlanningRegion(loaded.project);
    updateProject(insertPlanningRegion(loaded.project, region), `Added ${region.name}`);
    setSelectedObjectId(region.id);
  }

  function addProtectedInterval() {
    if (!loaded) {
      return;
    }
    const existingIds = new Set((loaded.project.setup.protected_intervals ?? []).map((interval) => interval.id));
    let suffix = 1;
    let id = "protect.manual";
    while (existingIds.has(id)) {
      suffix += 1;
      id = `protect.manual_${suffix}`;
    }
    const endS = loaded.project.project.datum.s_offset_mm;
    const interval = {
      id,
      purpose: "do_not_machine",
      start_s_mm: endS - 10,
      end_s_mm: endS,
    };
    updateProject(
      {
        ...loaded.project,
        setup: {
          ...loaded.project.setup,
          protected_intervals: [...(loaded.project.setup.protected_intervals ?? []), interval],
        },
      },
      `Added ${id}`,
    );
    setSelectedObjectId(id);
  }

  function handleAnchor(anchor: MeasurementAnchor) {
    if (editorMode !== "measure") {
      return;
    }
    setMeasurementAnchors((current) => {
      if (current.length >= 2) {
        return [anchor];
      }
      if (current.some((existing) => existing.id === anchor.id)) {
        return current;
      }
      return [...current, anchor];
    });
  }

  function resetMeasurement() {
    setMeasurementAnchors([]);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <HardDrive aria-hidden="true" />
          <div>
            <h1>Hobgoblin</h1>
            <p>{loaded?.project.project.name ?? "Shaft editor"}</p>
          </div>
        </div>
        <div className="command-ribbon" aria-label="Project commands">
          <CommandGroup label="File">
            <CommandButton icon={<CirclePlus aria-hidden="true" />} label="New" onClick={newProject} />
            <CommandButton icon={<FileUp aria-hidden="true" />} label="Open" onClick={openProject} />
            <CommandButton icon={<FileDown aria-hidden="true" />} label="Sample" onClick={loadSampleProject} />
            <CommandButton icon={<Save aria-hidden="true" />} label="Save" onClick={saveProject} disabled={!loaded} />
          </CommandGroup>
          <CommandGroup label="Create">
            <CommandButton icon={<Box aria-hidden="true" />} label="Cylinder" onClick={() => addStackItem("cylindrical_section")} disabled={!loaded} />
            <CommandButton icon={<Cog aria-hidden="true" />} label="Spur" onClick={() => addStackItem("spur_gear")} disabled={!loaded} />
            <CommandButton icon={<Cog aria-hidden="true" />} label="Helical" secondary="schema" title="Helical schema placeholder; machining kernel is not implemented yet" onClick={() => addStackItem("helical_gear")} disabled={!loaded} />
            <CommandButton icon={<Layers aria-hidden="true" />} label="Herringbone" secondary="schema" title="Herringbone schema placeholder; machining kernel is not implemented yet" onClick={() => addStackItem("herringbone_gear")} disabled={!loaded} />
            <CommandButton icon={<CirclePlus aria-hidden="true" />} label="Eccentric" secondary="schema" title="Eccentric schema placeholder; machining kernel is not implemented yet" onClick={() => addStackItem("eccentric_section")} disabled={!loaded} />
            <CommandButton icon={<Layers aria-hidden="true" />} label="Region" onClick={addPlanningRegion} disabled={!loaded} />
            <CommandButton icon={<ListTree aria-hidden="true" />} label="Protect" onClick={addProtectedInterval} disabled={!loaded} />
          </CommandGroup>
          <CommandGroup label="Inspect">
            <CommandButton icon={<CheckCircle2 aria-hidden="true" />} label="Validate" onClick={revalidate} disabled={!loaded} />
            <CommandButton icon={<Play aria-hidden="true" />} label="Preview" onClick={previewSchematic} disabled={!loaded} />
            <CommandButton icon={<Play aria-hidden="true" />} label="Paths" onClick={generateToolpaths} disabled={!loaded} />
            <CommandButton icon={<Database aria-hidden="true" />} label="Libraries" onClick={() => setAppMode("libraries")} />
            <CommandButton icon={<ArrowLeft aria-hidden="true" />} label="Undo" onClick={undoProjectEdit} disabled={!loaded || undoStack.length === 0} />
            <CommandButton icon={<ArrowRight aria-hidden="true" />} label="Redo" onClick={redoProjectEdit} disabled={!loaded || redoStack.length === 0} />
            <CommandButton icon={<Wrench aria-hidden="true" />} label="Export" disabled title="G-code export shell is tracked separately" />
            <div className="segmented-control" aria-label="Editor mode">
              <button
                type="button"
                className={editorMode === "select" ? "active" : ""}
                onClick={() => setEditorMode("select")}
                title="Select"
                aria-label="Select mode"
              >
                <MousePointer2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className={editorMode === "measure" ? "active" : ""}
                onClick={() => setEditorMode("measure")}
                title="Measure"
                aria-label="Measure mode"
              >
                <Crosshair aria-hidden="true" />
              </button>
            </div>
          </CommandGroup>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,.hobgoblin.json,application/json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void openFromFile(file);
              }
              event.currentTarget.value = "";
            }}
          />
        </div>
      </header>

      {appMode === "libraries" ? (
        <section className="workspace library-workspace" aria-label="Library editor">
          <section className="library-screen">
            <div className="library-screen-header">
              <PanelHeader title="Libraries" subtitle="Machines, tools, materials, and import/export" />
              <button type="button" onClick={() => setAppMode("design")}>
                <ArrowLeft aria-hidden="true" />
                Back to design
              </button>
            </div>
            <LibraryInspector
              library={library}
              tab={libraryTab}
              selectedMachineId={selectedMachineId}
              selectedToolId={selectedToolId}
              selectedMaterialId={selectedMaterialId}
              libraryJson={libraryJson}
              onTabChange={setLibraryTab}
              onSelectMachine={setSelectedMachineId}
              onSelectTool={setSelectedToolId}
              onSelectMaterial={setSelectedMaterialId}
              onUpdateMachine={updateMachineProfile}
              onUpdateTool={updateTool}
              onAddTool={addLibraryTool}
              onUpdateMaterial={updateMaterial}
              onLibraryJsonChange={setLibraryJson}
              onExport={exportLibraryConfig}
              onImport={importLibraryConfig}
            />
          </section>
        </section>
      ) : (
        <section className="workspace">
          <aside className="feature-tree" aria-label="Feature tree">
            <PanelHeader title="Features" subtitle={loaded?.pathLabel ?? "No file"} />
            {loaded ? (
              <FeatureTree
                project={loaded.project}
                selectedObjectId={selectedObjectId}
                diagnostics={loaded.validation.diagnostics}
                onSelect={selectProjectObject}
                onMoveStackItem={moveStackItem}
                onMoveStackItemToIndex={moveStackItemToIndex}
                onDeleteStackItem={deleteStackItem}
                onDeletePlanningRegion={deletePlanningRegion}
                onDeleteProtectedInterval={deleteProtectedInterval}
              />
            ) : (
              <EmptyPanel message="Open a project file to inspect the shaft stack." />
            )}
          </aside>

          <aside className="inspector" aria-label="Inspector">
            <PanelHeader title="Inspector" subtitle={selectedObjectId ?? "Nothing selected"} />
            {loaded && selectedFeature ? (
            <FeatureInspector
              feature={selectedFeature}
              interval={selectedFeatureInterval}
              diagnostics={diagnosticsForSelection}
              toolOptions={toolOptions}
              onUpdate={(patch) => updateFeature(selectedFeature.id, patch)}
              onDelete={() => deleteStackItem(selectedFeature.id)}
              canDelete={loaded.project.stack.length > 1}
            />
          ) : loaded && selectedRegion ? (
            <RegionInspector
              region={selectedRegion}
              onUpdate={(patch) => updatePlanningRegion(selectedRegion.id, (region) => ({ ...region, ...patch }))}
              onDelete={() => deletePlanningRegion(selectedRegion.id)}
              onAddVertexAfter={(vertexIndex) =>
                updatePlanningRegion(selectedRegion.id, (region) => {
                  const point = region.polygon[vertexIndex];
                  const next = region.polygon[(vertexIndex + 1) % region.polygon.length];
                  const polygon = [...region.polygon];
                  polygon.splice(vertexIndex + 1, 0, {
                    s_mm: (point.s_mm + next.s_mm) / 2,
                    r_mm: (point.r_mm + next.r_mm) / 2,
                  });
                  return { ...region, polygon };
                })
              }
              onUpdateBounds={(bounds) =>
                updatePlanningRegion(selectedRegion.id, (region) => ({
                  ...region,
                  polygon: rectanglePolygon(bounds),
                }))
              }
              onDeleteVertex={(vertexIndex) =>
                updatePlanningRegion(selectedRegion.id, (region) => {
                  if (region.polygon.length <= 3) {
                    setStatus("Planning polygons need at least three vertices");
                    return region;
                  }
                  return {
                    ...region,
                    polygon: region.polygon.filter((_, index) => index !== vertexIndex),
                  };
                })
              }
            />
          ) : loaded && selectedProtectedInterval ? (
            <ProtectedIntervalInspector
              interval={selectedProtectedInterval}
              onUpdate={(patch) => updateProtectedInterval(selectedProtectedInterval.id, patch)}
              onDelete={() => deleteProtectedInterval(selectedProtectedInterval.id)}
            />
          ) : loaded && selectedObjectId === loaded.project.stock.id ? (
            <StockInspector
              stock={loaded.project.stock}
              materialOptions={materialOptions}
              onUpdate={updateStock}
            />
          ) : loaded && selectedObjectId === loaded.project.setup.id ? (
            <SetupInspector
              setup={loaded.project.setup}
              machineOptions={machineOptions}
              onUpdate={updateSetup}
            />
          ) : loaded ? (
            <ProjectInspector project={loaded.project} onUpdate={updateProjectMetadata} />
          ) : (
            <EmptyPanel message="Select a feature or diagnostic to inspect its data." />
          )}
          </aside>

          <section className="editor-plane" aria-label="Shaft schematic">
            <PanelHeader
              title="Shaft"
              subtitle={
                loaded
                  ? `${loaded.project.stock.diameter_mm.toFixed(2)} mm stock x ${loaded.project.stock.length_mm.toFixed(2)} mm`
                  : "Waiting for project"
              }
            />
            {loaded ? (
              <div className="preview-mode-shell">
                <div className="preview-mode-tabs" role="tablist" aria-label="Preview mode">
                  <button
                    type="button"
                    className={previewMode === "schematic" ? "active" : ""}
                    onClick={() => setPreviewMode("schematic")}
                  >
                    2D schematic
                  </button>
                  <button
                    type="button"
                    className={previewMode === "model3d" ? "active" : ""}
                    onClick={() => setPreviewMode("model3d")}
                  >
                    3D model
                  </button>
                </div>
                {previewMode === "model3d" ? (
                  <ShaftModel3D
                    project={loaded.project}
                    selectedObjectId={selectedObjectId}
                    toolpaths={toolpathResult?.paths ?? []}
                    onSelect={selectProjectObject}
                  />
                ) : (
                  <PlanningEditor
                    project={loaded.project}
                    selectedObjectId={selectedObjectId}
                    editorMode={editorMode}
                    measurementAnchors={measurementAnchors}
                    toolpaths={toolpathResult?.paths ?? []}
                    onSelect={selectProjectObject}
                    onMeasureAnchor={handleAnchor}
                    onResetMeasurement={resetMeasurement}
                    onMoveRegionVertex={(regionId, vertexIndex, point) =>
                      updatePlanningRegion(regionId, (region) => ({
                        ...region,
                        polygon: region.polygon.map((candidate, index) =>
                          index === vertexIndex ? point : candidate,
                        ),
                      }))
                    }
                    onAddRegionVertex={(regionId, edgeIndex, point) =>
                      updatePlanningRegion(regionId, (region) => {
                        const polygon = [...region.polygon];
                        polygon.splice(edgeIndex + 1, 0, point);
                        return { ...region, polygon };
                      })
                    }
                    onDeleteRegionVertex={(regionId, vertexIndex) =>
                      updatePlanningRegion(regionId, (region) => {
                        if (region.polygon.length <= 3) {
                          setStatus("Planning polygons need at least three vertices");
                          return region;
                        }
                        return {
                          ...region,
                          polygon: region.polygon.filter((_, index) => index !== vertexIndex),
                        };
                      })
                    }
                    onResizeAxisAlignedRegion={(regionId, bounds) =>
                      updatePlanningRegion(regionId, (region) => ({
                        ...region,
                        polygon: rectanglePolygon(bounds),
                      }))
                    }
                  />
                )}
              </div>
            ) : (
              <EmptyPanel message="The shaft preview appears here after loading a project." />
            )}
          </section>
        </section>
      )}

      <section className="diagnostics-panel" aria-label="Diagnostics">
        <div className="diagnostics-summary">
          <PanelHeader
            title="Diagnostics"
            subtitle={`${validationCounts.errors} errors, ${validationCounts.warnings} warnings`}
          />
          <p>{status}</p>
        </div>
        <DiagnosticsList
          diagnostics={loaded?.validation.diagnostics ?? []}
          selectedObjectId={selectedObjectId}
          onSelect={selectProjectObject}
        />
        {toolpathResult ? <ToolpathSummary result={toolpathResult} onSelect={selectProjectObject} /> : null}
      </section>
    </main>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <span>{subtitle}</span>
    </div>
  );
}

function CommandGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`command-group command-group-${label.toLowerCase()}`}>
      <span>{label}</span>
      <div className="command-group-actions">{children}</div>
    </div>
  );
}

function CommandButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  secondary,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  secondary?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title ?? label} aria-label={label}>
      {icon}
      <span>{label}{secondary ? <small>{secondary}</small> : null}</span>
    </button>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return <div className="empty-panel">{message}</div>;
}

function FeatureTree({
  project,
  selectedObjectId,
  diagnostics,
  onSelect,
  onMoveStackItem,
  onMoveStackItemToIndex,
  onDeleteStackItem,
  onDeletePlanningRegion,
  onDeleteProtectedInterval,
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
  diagnostics: ValidationDiagnostic[];
  onSelect: (objectId: string) => void;
  onMoveStackItem: (itemId: string, direction: MoveDirection) => void;
  onMoveStackItemToIndex: (itemId: string, targetIndex: number) => void;
  onDeleteStackItem: (itemId: string) => void;
  onDeletePlanningRegion: (regionId: string) => void;
  onDeleteProtectedInterval: (intervalId: string) => void;
}) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const protectedIntervals = project.setup.protected_intervals ?? [];
  const planningRegions = project.planning_regions ?? [];
  const hasDiagnostics = (objectId: string) =>
    diagnostics.some((diagnostic) => diagnostic.object_id === objectId);
  return (
    <div className="tree-list">
      <div className="tree-section">
        <span>Setup</span>
        <button
          type="button"
          className={selectedObjectId === project.setup.id ? "tree-item selected" : "tree-item"}
          onClick={() => onSelect(project.setup.id)}
        >
          <span className="tree-title">
            {hasDiagnostics(project.setup.id) ? <AlertTriangle aria-hidden="true" /> : <Wrench aria-hidden="true" />}
            {project.setup.name}
          </span>
          <span>{project.setup.machine_profile_id}</span>
        </button>
      </div>
      <div className="tree-section">
        <span>Stock</span>
      <button
        type="button"
        className={selectedObjectId === project.stock.id ? "tree-item selected" : "tree-item"}
        onClick={() => onSelect(project.stock.id)}
      >
          <span className="tree-title">
            {hasDiagnostics(project.stock.id) ? <AlertTriangle aria-hidden="true" /> : <Box aria-hidden="true" />}
            {project.stock.id}
          </span>
          <span>{project.stock.diameter_mm.toFixed(2)} x {project.stock.length_mm.toFixed(2)} mm</span>
      </button>
      </div>
      <div className="tree-section">
        <span>Gear stack</span>
      {project.stack.map((item, index) => {
        const itemHasDiagnostics = hasDiagnostics(item.id);
        return (
          <div
            key={item.id}
            className={[
              "tree-item",
              "tree-item-with-actions",
              selectedObjectId === item.id ? "selected" : "",
              draggedItemId === item.id ? "dragging" : "",
              dragOverItemId === item.id && draggedItemId !== item.id ? "drag-over" : "",
            ].filter(Boolean).join(" ")}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.id);
              setDraggedItemId(item.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverItemId(item.id);
            }}
            onDragLeave={() => {
              setDragOverItemId((current) => (current === item.id ? null : current));
            }}
            onDrop={(event) => {
              event.preventDefault();
              const draggedId = event.dataTransfer.getData("text/plain") || draggedItemId;
              setDraggedItemId(null);
              setDragOverItemId(null);
              if (draggedId) {
                onMoveStackItemToIndex(draggedId, index);
              }
            }}
            onDragEnd={() => {
              setDraggedItemId(null);
              setDragOverItemId(null);
            }}
          >
            <button type="button" className="tree-item-main" onClick={() => onSelect(item.id)}>
              <span className="tree-title">
                {itemHasDiagnostics ? <AlertTriangle aria-hidden="true" /> : <Cog aria-hidden="true" />}
                {item.name}
              </span>
              <span>{featureTypeLabel(item.type)} / {item.length_mm.toFixed(2)} mm</span>
            </button>
            <div className="tree-row-actions">
              <button type="button" onClick={() => onMoveStackItem(item.id, "up")} disabled={index === 0} title="Move up" aria-label={`Move ${item.name} up`}>
                <MoveUp aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onMoveStackItem(item.id, "down")} disabled={index === project.stack.length - 1} title="Move down" aria-label={`Move ${item.name} down`}>
                <MoveDown aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onDeleteStackItem(item.id)} disabled={project.stack.length <= 1} title="Delete feature" aria-label={`Delete ${item.name}`}>
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
      </div>
      <div className="tree-section">
        <span>Planning regions</span>
        {planningRegions.map((region) => (
          <div
            key={region.id}
            className={selectedObjectId === region.id ? "tree-item tree-item-with-actions selected" : "tree-item tree-item-with-actions"}
          >
            <button type="button" className="tree-item-main" onClick={() => onSelect(region.id)}>
              <span className="tree-title">
                {hasDiagnostics(region.id) ? <AlertTriangle aria-hidden="true" /> : <Layers aria-hidden="true" />}
                {region.name}
              </span>
              <span>{region.purpose} / stage {region.stage}</span>
            </button>
            <div className="tree-row-actions single-action">
              <button type="button" onClick={() => onDeletePlanningRegion(region.id)} title="Delete planning region" aria-label={`Delete ${region.name}`}>
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="tree-section">
        <span>Protected intervals</span>
        {protectedIntervals.map((interval) => (
          <div
            key={interval.id}
            className={selectedObjectId === interval.id ? "tree-item tree-item-with-actions selected" : "tree-item tree-item-with-actions"}
          >
            <button type="button" className="tree-item-main" onClick={() => onSelect(interval.id)}>
              <span className="tree-title">
                {hasDiagnostics(interval.id) ? <AlertTriangle aria-hidden="true" /> : <ListTree aria-hidden="true" />}
                {interval.id}
              </span>
              <span>{interval.purpose} / {interval.start_s_mm.toFixed(2)}-{interval.end_s_mm.toFixed(2)} mm</span>
            </button>
            <div className="tree-row-actions single-action">
              <button type="button" onClick={() => onDeleteProtectedInterval(interval.id)} title="Delete protected interval" aria-label={`Delete ${interval.id}`}>
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {project.library_refs ? (
        <div className="tree-section">
          <span>Library refs</span>
          {project.library_refs.machine_profile_id ? (
            <div className="tree-note">Machine: {project.library_refs.machine_profile_id}</div>
          ) : null}
          {project.library_refs.material_id ? (
            <div className="tree-note">Material: {project.library_refs.material_id}</div>
          ) : null}
          {(project.library_refs.tool_ids ?? []).map((toolId) => (
            <div key={toolId} className="tree-note">Tool: {toolId}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlanningEditor({
  project,
  selectedObjectId,
  editorMode,
  measurementAnchors,
  toolpaths,
  onSelect,
  onMeasureAnchor,
  onResetMeasurement,
  onMoveRegionVertex,
  onAddRegionVertex,
  onDeleteRegionVertex,
  onResizeAxisAlignedRegion,
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
  editorMode: EditorMode;
  measurementAnchors: MeasurementAnchor[];
  toolpaths: GeneratedToolpath[];
  onSelect: (objectId: string) => void;
  onMeasureAnchor: (anchor: MeasurementAnchor) => void;
  onResetMeasurement: () => void;
  onMoveRegionVertex: (regionId: string, vertexIndex: number, point: PointSr) => void;
  onAddRegionVertex: (regionId: string, edgeIndex: number, point: PointSr) => void;
  onDeleteRegionVertex: (regionId: string, vertexIndex: number) => void;
  onResizeAxisAlignedRegion: (regionId: string, bounds: RegionBounds) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewCenterOffsetS, setViewCenterOffsetS] = useState(0);
  const [viewCenterOffsetR, setViewCenterOffsetR] = useState(0);
  const [panStart, setPanStart] = useState<{
    pointerId: number;
    clientX: number;
    clientY: number;
    centerOffsetS: number;
    centerOffsetR: number;
  } | null>(null);
  const spans = useMemo(() => stackSpans(project), [project]);
  const stockStartS = project.project.datum.s_offset_mm;
  const stockEndS = stockStartS + project.stock.length_mm;
  const protectedIntervals = project.setup.protected_intervals ?? [];
  const planningRegions = project.planning_regions ?? [];
  const maxProfileRadius = Math.max(
    project.stock.diameter_mm / 2,
    ...spans.map((span) => radiusForItem(span.item)),
    ...planningRegions.flatMap((region) => region.polygon.map((point) => point.r_mm)),
  );
  const domainMinS = Math.min(
    stockStartS,
    ...spans.map((span) => span.startS),
    ...protectedIntervals.map((interval) => interval.start_s_mm),
    ...planningRegions.flatMap((region) => region.polygon.map((point) => point.s_mm)),
  );
  const domainMaxS = Math.max(
    stockEndS,
    ...spans.map((span) => span.endS),
    ...protectedIntervals.map((interval) => interval.end_s_mm),
    ...planningRegions.flatMap((region) => region.polygon.map((point) => point.s_mm)),
  );
  const domainRangeS = Math.max(1, domainMaxS - domainMinS);
  const visibleRangeS = domainRangeS / viewZoom;
  const domainCenterS = (domainMinS + domainMaxS) / 2;
  const visibleCenterS = domainCenterS + viewCenterOffsetS;
  const minS = visibleCenterS - visibleRangeS / 2;
  const maxS = visibleCenterS + visibleRangeS / 2;
  const sRange = Math.max(1, maxS - minS);
  const maxProfileRadiusWithMargin = Math.max(1, maxProfileRadius) * 1.12;
  const domainMinR = -maxProfileRadiusWithMargin;
  const domainMaxR = maxProfileRadiusWithMargin;
  const domainRangeR = domainMaxR - domainMinR;
  const visibleRangeR = domainRangeR / viewZoom;
  const domainCenterR = (domainMinR + domainMaxR) / 2;
  const visibleCenterR = domainCenterR + viewCenterOffsetR;
  const minR = visibleCenterR - visibleRangeR / 2;
  const maxR = visibleCenterR + visibleRangeR / 2;
  const rRange = Math.max(1, maxR - minR);
  const viewWidth = 1000;
  const viewHeight = 420;
  const padding = { left: 0, right: 0, top: 0, bottom: 0 };
  const plotWidth = viewWidth - padding.left - padding.right;
  const plotHeight = viewHeight - padding.top - padding.bottom;
  const gridMinorS = niceGridStep(sRange, plotWidth, 36);
  const gridMinorD = niceGridStep(rRange * 2, plotHeight, 36);

  const xForS = (sMm: number) => padding.left + ((sMm - minS) / sRange) * plotWidth;
  const yForR = (rMm: number) => padding.top + (1 - (rMm - minR) / rRange) * plotHeight;
  const sForX = (x: number) => minS + ((x - padding.left) / plotWidth) * sRange;
  const rForY = (y: number) => minR + (1 - (y - padding.top) / plotHeight) * rRange;
  const clampCenterOffsetS = (offsetS: number, zoom = viewZoom) => {
    const nextVisibleRangeS = domainRangeS / zoom;
    const maxOffset = Math.max(domainRangeS, nextVisibleRangeS);
    return Math.min(maxOffset, Math.max(-maxOffset, offsetS));
  };
  const clampCenterOffsetR = (offsetR: number, zoom = viewZoom) => {
    const nextVisibleRangeR = domainRangeR / zoom;
    const maxOffset = Math.max(domainRangeR, nextVisibleRangeR);
    return Math.min(maxOffset, Math.max(-maxOffset, offsetR));
  };
  const clampPoint = (point: PointSr): PointSr => ({
    s_mm: Math.min(domainMaxS, Math.max(domainMinS, point.s_mm)),
    r_mm: Math.min(domainMaxR, Math.max(0, point.r_mm)),
  });
  const rectForRadius = (radiusMm: number) => {
    const topY = yForR(radiusMm);
    const bottomY = yForR(-radiusMm);
    return { y: topY, height: bottomY - topY };
  };
  const isGearFeature = (item: StackItem) =>
    item.type === "spur_gear" || item.type === "helical_gear" || item.type === "herringbone_gear";
  const toothCountForItem = (item: StackItem): number => {
    const direct = typeof item.tooth_count === "number" ? item.tooth_count : null;
    const spur = typeof item.spur === "object" && item.spur !== null ? (item.spur as Record<string, unknown>) : null;
    const nested = typeof spur?.tooth_count === "number" ? spur.tooth_count : null;
    return Math.max(6, Math.min(48, Math.round(direct ?? nested ?? 18)));
  };
  const moduleForItem = (item: StackItem): number => {
    const direct = typeof item.module_mm === "number" ? item.module_mm : null;
    const spur = typeof item.spur === "object" && item.spur !== null ? (item.spur as Record<string, unknown>) : null;
    const nested = typeof spur?.module_mm === "number" ? spur.module_mm : null;
    return Math.max(0.05, direct ?? nested ?? Math.max(0.1, radiusForItem(item) * 0.08));
  };

  const setZoom = (nextZoom: number) => {
    const clampedZoom = Math.min(8, Math.max(0.25, nextZoom));
    setViewZoom(clampedZoom);
    setViewCenterOffsetS((current) => clampCenterOffsetS(current, clampedZoom));
    setViewCenterOffsetR((current) => clampCenterOffsetR(current, clampedZoom));
  };
  const panView = (directionS: -1 | 0 | 1, directionR: -1 | 0 | 1) => {
    setViewCenterOffsetS((current) => {
      const next = current + directionS * visibleRangeS * 0.25;
      return clampCenterOffsetS(next);
    });
    setViewCenterOffsetR((current) => {
      const next = current + directionR * visibleRangeR * 0.25;
      return clampCenterOffsetR(next);
    });
  };
  const fitView = () => {
    setViewZoom(1);
    setViewCenterOffsetS(0);
    setViewCenterOffsetR(0);
  };

  function viewportCoordinates(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return { x: padding.left, y: yForR(0) };
    }
    const rect = viewport.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * viewWidth,
      y: ((clientY - rect.top) / rect.height) * viewHeight,
    };
  }

  function eventPoint(event: React.PointerEvent<HTMLElement>): PointSr {
    const { x, y } = viewportCoordinates(event.clientX, event.clientY);
    return clampPoint({ s_mm: sForX(x), r_mm: rForY(y) });
  }

  function snapRegionVertex(region: PlanningRegion, vertexIndex: number, point: PointSr): PointSr {
    const snapS = (sRange / Math.max(1, plotWidth)) * 10;
    const snapR = (rRange / Math.max(1, plotHeight)) * 10;
    const previous = region.polygon[(vertexIndex - 1 + region.polygon.length) % region.polygon.length];
    const next = region.polygon[(vertexIndex + 1) % region.polygon.length];
    const sCandidates = [previous.s_mm, next.s_mm]
      .map((value) => ({ value, distance: Math.abs(point.s_mm - value) }))
      .sort((a, b) => a.distance - b.distance);
    const rCandidates = [previous.r_mm, next.r_mm]
      .map((value) => ({ value, distance: Math.abs(point.r_mm - value) }))
      .sort((a, b) => a.distance - b.distance);
    return {
      s_mm: sCandidates[0].distance <= snapS ? sCandidates[0].value : point.s_mm,
      r_mm: rCandidates[0].distance <= snapR ? rCandidates[0].value : point.r_mm,
    };
  }

  function zoomToClientPoint(clientX: number, clientY: number, nextZoom: number) {
    const clampedZoom = Math.min(8, Math.max(0.25, nextZoom));
    if (clampedZoom === viewZoom) {
      return;
    }
    const { x, y } = viewportCoordinates(clientX, clientY);
    const cursorRatio = Math.min(1, Math.max(0, (x - padding.left) / plotWidth));
    const cursorRatioY = Math.min(1, Math.max(0, (y - padding.top) / plotHeight));
    const cursorS = sForX(x);
    const cursorR = rForY(y);
    const nextVisibleRangeS = domainRangeS / clampedZoom;
    const nextVisibleRangeR = domainRangeR / clampedZoom;
    const nextCenterS = cursorS + (0.5 - cursorRatio) * nextVisibleRangeS;
    const nextCenterR = cursorR + (cursorRatioY - 0.5) * nextVisibleRangeR;
    setViewZoom(clampedZoom);
    setViewCenterOffsetS(clampCenterOffsetS(nextCenterS - domainCenterS, clampedZoom));
    setViewCenterOffsetR(clampCenterOffsetR(nextCenterR - domainCenterR, clampedZoom));
  }

  function applyPan(clientX: number, clientY: number, plotCssWidth: number, plotCssHeight: number) {
    if (!panStart) {
      return;
    }
    const deltaXS = ((clientX - panStart.clientX) / Math.max(1, plotCssWidth)) * visibleRangeS;
    const deltaYR = ((clientY - panStart.clientY) / Math.max(1, plotCssHeight)) * visibleRangeR;
    setViewCenterOffsetS(clampCenterOffsetS(panStart.centerOffsetS - deltaXS));
    setViewCenterOffsetR(clampCenterOffsetR(panStart.centerOffsetR + deltaYR));
  }

  const measurement =
    measurementAnchors.length === 2
      ? {
          a: measurementAnchors[0],
          b: measurementAnchors[1],
          ds: measurementAnchors[1].point.s_mm - measurementAnchors[0].point.s_mm,
          dr: measurementAnchors[1].point.r_mm - measurementAnchors[0].point.r_mm,
          distance: distance(measurementAnchors[0].point, measurementAnchors[1].point),
        }
      : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    renderPlanningWebgl(canvas, {
      viewWidth,
      viewHeight,
      padding,
      plotWidth,
      plotHeight,
      minS,
      maxS,
      minR,
      maxR,
      stockStartS,
      stockEndS,
      stockRadius: project.stock.diameter_mm / 2,
      selectedObjectId,
      protectedIntervals,
      spans,
      planningRegions,
      xForS,
      yForR,
      rectForRadius,
      isGearFeature,
      moduleForItem,
      gridMinorS,
      gridMinorD,
      toolpaths,
    });
  }, [
    viewZoom,
    viewCenterOffsetS,
    viewCenterOffsetR,
    project,
    selectedObjectId,
    spans,
    protectedIntervals,
    planningRegions,
    minS,
    maxS,
    minR,
    maxR,
    gridMinorS,
    gridMinorD,
    toolpaths,
  ]);

  return (
    <div className="planning-editor">
      <div className="editor-toolbar">
        <span>{editorMode === "measure" ? "Measure anchors" : "Edit geometry"} / {viewZoom.toFixed(1)}x</span>
        <div className="viewport-controls" aria-label="Viewport controls">
          <button type="button" onClick={() => panView(-1, 0)} title="Pan left" aria-label="Pan left">
            <ArrowLeft aria-hidden="true" />
          </button>
          <button type="button" onClick={() => panView(1, 0)} title="Pan right" aria-label="Pan right">
            <ArrowRight aria-hidden="true" />
          </button>
          <button type="button" onClick={() => panView(0, 1)} title="Pan up" aria-label="Pan up">
            <ArrowUp aria-hidden="true" />
          </button>
          <button type="button" onClick={() => panView(0, -1)} title="Pan down" aria-label="Pan down">
            <ArrowDown aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setZoom(viewZoom / 1.5)} disabled={viewZoom <= 0.25} title="Zoom out" aria-label="Zoom out">
            <ZoomOut aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setZoom(viewZoom * 1.5)} disabled={viewZoom >= 8} title="Zoom in" aria-label="Zoom in">
            <ZoomIn aria-hidden="true" />
          </button>
          <button type="button" onClick={fitView} title="Fit stack" aria-label="Fit stack">
            <Maximize2 aria-hidden="true" />
            Fit
          </button>
          <button type="button" onClick={onResetMeasurement} disabled={measurementAnchors.length === 0}>
            <Crosshair aria-hidden="true" />
            Clear
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="planning-webgl-viewport"
        role="img"
        aria-label="WebGL 2D shaft and planning editor"
        onWheel={(event) => {
          event.preventDefault();
          zoomToClientPoint(event.clientX, event.clientY, viewZoom * (event.deltaY > 0 ? 1 / 1.2 : 1.2));
        }}
        onPointerDown={(event) => {
          if (!event.shiftKey || event.button !== 0) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanStart({
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            centerOffsetS: viewCenterOffsetS,
            centerOffsetR: viewCenterOffsetR,
          });
        }}
        onPointerMove={(event) => {
          if (!panStart || panStart.pointerId !== event.pointerId || event.buttons !== 1) {
            return;
          }
          const viewportBounds = event.currentTarget.getBoundingClientRect();
          applyPan(
            event.clientX,
            event.clientY,
            viewportBounds.width * (plotWidth / viewWidth),
            viewportBounds.height * (plotHeight / viewHeight),
          );
        }}
        onPointerUp={(event) => {
          if (panStart?.pointerId === event.pointerId) {
            setPanStart(null);
          }
        }}
        onPointerCancel={() => setPanStart(null)}
      >
        <canvas
          ref={canvasRef}
          className="planning-webgl-canvas"
          width={viewWidth}
          height={viewHeight}
          data-renderer="webgl"
          data-grid="dynamic-model-space"
          data-grid-minor-s={gridMinorS}
          data-grid-minor-d={gridMinorD}
          aria-hidden="true"
        />
        <div
          className={panStart ? "viewport-background panning" : "viewport-background"}
          style={viewportStyle(padding.left, padding.top, plotWidth, plotHeight, viewWidth, viewHeight)}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            setPanStart({
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
              centerOffsetS: viewCenterOffsetS,
              centerOffsetR: viewCenterOffsetR,
            });
          }}
          onPointerMove={(event) => {
            if (!panStart || panStart.pointerId !== event.pointerId || event.buttons !== 1) {
              return;
            }
            const backgroundBounds = event.currentTarget.getBoundingClientRect();
            applyPan(event.clientX, event.clientY, backgroundBounds.width, backgroundBounds.height);
          }}
          onPointerUp={(event) => {
            if (panStart?.pointerId === event.pointerId) {
              setPanStart(null);
            }
          }}
          onPointerCancel={() => setPanStart(null)}
        />
        {stockStartS >= minS && stockStartS <= maxS ? (
          <div
            className="datum-marker"
            style={viewportStyle(xForS(stockStartS), padding.top, 1, plotHeight, viewWidth, viewHeight)}
          >
            <span>datum</span>
          </div>
        ) : null}

        {(() => {
          const stockRadius = project.stock.diameter_mm / 2;
          const stockRect = rectForRadius(stockRadius);
          return (
            <button
              type="button"
              aria-label="Select stock"
              style={viewportStyle(xForS(stockStartS), stockRect.y, xForS(stockEndS) - xForS(stockStartS), stockRect.height, viewWidth, viewHeight)}
              className={selectedObjectId === project.stock.id ? "stock-rect selected" : "stock-rect"}
              onClick={() => onSelect(project.stock.id)}
            />
          );
        })()}

        {protectedIntervals.map((interval) => {
          const visibleStartS = Math.max(minS, interval.start_s_mm);
          const visibleEndS = Math.min(maxS, interval.end_s_mm);
          if (visibleEndS <= visibleStartS) {
            return null;
          }
          return (
            <button
              key={interval.id}
              type="button"
              aria-label={`Select protected interval ${interval.id}`}
              style={viewportStyle(xForS(visibleStartS), padding.top, xForS(visibleEndS) - xForS(visibleStartS), plotHeight, viewWidth, viewHeight)}
              className={selectedObjectId === interval.id ? "protected selected" : "protected"}
              onClick={() => onSelect(interval.id)}
            >
              <span className="protected-label">
                {interval.purpose}
              </span>
            </button>
          );
        })}

        {spans.map((span) => {
          const radius = radiusForItem(span.item);
          const gearFeature = isGearFeature(span.item);
          const rootRadius = gearFeature
            ? Math.max(radius * 0.62, radius - moduleForItem(span.item) * 1.25)
            : radius;
          const featureRect = rectForRadius(rootRadius);
          const xStart = xForS(span.startS);
          const xEnd = xForS(span.endS);
          const featureWidth = xEnd - xStart;
          const hitWidth = Math.max(featureWidth, 10);
          const hitX = xStart - Math.max(0, hitWidth - featureWidth) / 2;
          return (
            <div
              key={span.item.id}
              className="feature-overlay"
              style={viewportStyle(hitX, padding.top, hitWidth, plotHeight, viewWidth, viewHeight)}
            >
              <button
                type="button"
                aria-label={`Select ${span.item.name} hit area`}
                className="profile-hit"
                onClick={() => onSelect(span.item.id)}
              />
              <button
                type="button"
                aria-label={`Select ${span.item.name}`}
                style={viewportStyle(xStart - hitX, featureRect.y - padding.top, featureWidth, featureRect.height, hitWidth, plotHeight)}
                className={[
                  selectedObjectId === span.item.id ? "profile selected" : "profile",
                  gearFeature ? "gear-profile" : "solid-profile",
                ].join(" ")}
                onClick={() => onSelect(span.item.id)}
              />
              {gearFeature ? (
                <>
                  <span
                    className={selectedObjectId === span.item.id ? "gear-teeth selected" : "gear-teeth"}
                    aria-hidden="true"
                  />
                  <span
                    className={selectedObjectId === span.item.id ? "gear-teeth selected" : "gear-teeth"}
                    aria-hidden="true"
                  />
                  <span
                    className="tooth-count-label"
                    style={pointOverlayStyle(xStart + 5 - hitX, yForR(-rootRadius) - 18 - padding.top, hitWidth, plotHeight)}
                  >
                    {toothCountForItem(span.item)} teeth
                  </span>
                </>
              ) : null}
              <span
                className="feature-label"
                style={pointOverlayStyle((xForS(span.startS) + xForS(span.endS)) / 2 - hitX, yForR(radius) - 20 - padding.top, hitWidth, plotHeight)}
              >
                {span.item.name}
              </span>
              {[
                { id: `${span.item.id}:start`, label: `${span.item.name} start`, point: { s_mm: span.startS, r_mm: radius } },
                { id: `${span.item.id}:end`, label: `${span.item.name} end`, point: { s_mm: span.endS, r_mm: radius } },
              ].map((anchor) => (
                <button
                  type="button"
                  key={anchor.id}
                  aria-label={`Measure ${anchor.label}`}
                  style={handleStyle(xForS(anchor.point.s_mm) - hitX, yForR(anchor.point.r_mm) - padding.top, 10, hitWidth, plotHeight)}
                  className="measure-anchor"
                  onClick={() => onMeasureAnchor(anchor)}
                />
              ))}
            </div>
          );
        })}

        <div
          className="shaft-axis"
          style={viewportStyle(padding.left, yForR(0), plotWidth, 1, viewWidth, viewHeight)}
        />

        {planningRegions.map((region) => {
          const bounds = regionBounds(region);
          return (
            <div key={region.id} className="planning-region-layer">
              <button
                type="button"
                aria-label={`Select planning region ${region.name}`}
                style={polygonHitStyle(region.polygon, xForS, yForR, viewWidth, viewHeight)}
                className={selectedObjectId === region.id ? "region-polygon selected" : "region-polygon"}
                onClick={() => onSelect(region.id)}
              />
              {bounds && isAxisAlignedRectangle(region) ? (
                <AxisAlignedHandles
                  region={region}
                  bounds={bounds}
                  xForS={xForS}
                  yForR={yForR}
                  eventPoint={eventPoint}
                  viewWidth={viewWidth}
                  viewHeight={viewHeight}
                  onSelect={onSelect}
                  onResize={onResizeAxisAlignedRegion}
                />
              ) : null}
              {region.polygon.map((point, vertexIndex) => (
                <RegionVertexHandle
                  key={`${region.id}-${vertexIndex}`}
                  region={region}
                  vertexIndex={vertexIndex}
                  point={point}
                  xForS={xForS}
                  yForR={yForR}
                  eventPoint={eventPoint}
                  viewWidth={viewWidth}
                  viewHeight={viewHeight}
                  onSelect={onSelect}
                  onMove={(regionId, vertexIndex, point) =>
                    onMoveRegionVertex(regionId, vertexIndex, snapRegionVertex(region, vertexIndex, point))
                  }
                  onDelete={onDeleteRegionVertex}
                  onMeasureAnchor={onMeasureAnchor}
                />
              ))}
              {region.polygon.map((point, edgeIndex) => {
                const next = region.polygon[(edgeIndex + 1) % region.polygon.length];
                const midpoint = {
                  s_mm: (point.s_mm + next.s_mm) / 2,
                  r_mm: (point.r_mm + next.r_mm) / 2,
                };
                return (
                  <button
                    type="button"
                    key={`${region.id}-edge-${edgeIndex}`}
                    aria-label={`Add vertex on ${region.name} edge ${edgeIndex + 1}`}
                    title="Double-click to add a polygon vertex"
                    style={lineOverlayStyle(
                      xForS(point.s_mm),
                      yForR(point.r_mm),
                      xForS(next.s_mm),
                      yForR(next.r_mm),
                      viewWidth,
                      viewHeight,
                    )}
                    className="edge-add-handle"
                    onClick={() => onSelect(region.id)}
                    onDoubleClick={() => {
                      onSelect(region.id);
                      onAddRegionVertex(region.id, edgeIndex, midpoint);
                    }}
                  />
                );
              })}
            </div>
          );
        })}

        {measurement ? (
          <div className="measurement-overlay">
            <div
              className="measurement-line"
              style={lineOverlayStyle(
                xForS(measurement.a.point.s_mm),
                yForR(measurement.a.point.r_mm),
                xForS(measurement.b.point.s_mm),
                yForR(measurement.b.point.r_mm),
                viewWidth,
                viewHeight,
              )}
            />
            <span
              style={pointOverlayStyle(
                (xForS(measurement.a.point.s_mm) + xForS(measurement.b.point.s_mm)) / 2,
                (yForR(measurement.a.point.r_mm) + yForR(measurement.b.point.r_mm)) / 2 - 20,
                viewWidth,
                viewHeight,
              )}
            >
              d {formatMm(measurement.distance)} / ds {formatMm(measurement.ds)} / dr {formatMm(measurement.dr)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="measurement-readout">
        {measurementAnchors.length === 0
          ? "No measurement anchors selected"
          : measurementAnchors.map((anchor) => `${anchor.label}: s ${formatMm(anchor.point.s_mm)}, r ${formatMm(anchor.point.r_mm)}`).join(" | ")}
      </div>
    </div>
  );
}

type ViewportPadding = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function viewportStyle(x: number, y: number, width: number, height: number, viewWidth: number, viewHeight: number): CSSProperties {
  return {
    left: `${(x / viewWidth) * 100}%`,
    top: `${(y / viewHeight) * 100}%`,
    width: `${(width / viewWidth) * 100}%`,
    height: `${(height / viewHeight) * 100}%`,
  };
}

function pointOverlayStyle(x: number, y: number, viewWidth: number, viewHeight: number): CSSProperties {
  return {
    left: `${(x / viewWidth) * 100}%`,
    top: `${(y / viewHeight) * 100}%`,
  };
}

function handleStyle(x: number, y: number, size: number, viewWidth: number, viewHeight: number): CSSProperties {
  return {
    left: `${((x - size / 2) / viewWidth) * 100}%`,
    top: `${((y - size / 2) / viewHeight) * 100}%`,
    width: `${(size / viewWidth) * 100}%`,
    height: `${(size / viewHeight) * 100}%`,
  };
}

function polygonHitStyle(
  polygon: PointSr[],
  xForS: (sMm: number) => number,
  yForR: (rMm: number) => number,
  viewWidth: number,
  viewHeight: number,
): CSSProperties {
  const xs = polygon.map((point) => xForS(point.s_mm));
  const ys = polygon.map((point) => yForR(point.r_mm));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return viewportStyle(minX, minY, Math.max(8, maxX - minX), Math.max(8, maxY - minY), viewWidth, viewHeight);
}

function lineOverlayStyle(x1: number, y1: number, x2: number, y2: number, viewWidth: number, viewHeight: number): CSSProperties {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return {
    left: `${(x1 / viewWidth) * 100}%`,
    top: `${(y1 / viewHeight) * 100}%`,
    width: `${(length / viewWidth) * 100}%`,
    transform: `rotate(${angle}rad)`,
  };
}

function niceGridStep(rangeMm: number, pixelSize: number, targetPixels: number) {
  const rawStep = Math.max(0.0001, rangeMm / Math.max(1, pixelSize / targetPixels));
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function gridLines(min: number, max: number, minorStep: number) {
  const lines: Array<{ value: number; major: boolean }> = [];
  const safeStep = Math.max(0.0001, minorStep);
  const first = Math.floor(min / safeStep) * safeStep;
  const epsilon = safeStep * 0.001;
  for (let value = first; value <= max + epsilon; value += safeStep) {
    if (value < min - epsilon) {
      continue;
    }
    const unitIndex = Math.round(value / safeStep);
    lines.push({ value: Math.abs(value) < epsilon ? 0 : value, major: unitIndex % 5 === 0 });
  }
  return lines;
}

function renderPlanningWebgl(
  canvas: HTMLCanvasElement,
  context: {
    viewWidth: number;
    viewHeight: number;
    padding: ViewportPadding;
    plotWidth: number;
    plotHeight: number;
    minS: number;
    maxS: number;
    minR: number;
    maxR: number;
    stockStartS: number;
    stockEndS: number;
    stockRadius: number;
    selectedObjectId: string | null;
    protectedIntervals: NonNullable<HobgoblinProject["setup"]["protected_intervals"]>;
    spans: ReturnType<typeof stackSpans>;
    planningRegions: PlanningRegion[];
    xForS: (sMm: number) => number;
    yForR: (rMm: number) => number;
    rectForRadius: (radiusMm: number) => { y: number; height: number };
    isGearFeature: (item: StackItem) => boolean;
    moduleForItem: (item: StackItem) => number;
    gridMinorS: number;
    gridMinorD: number;
    toolpaths: GeneratedToolpath[];
  },
) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) {
    return;
  }
  gl.shaderSource(vertexShader, "attribute vec2 a_position; void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }");
  gl.shaderSource(fragmentShader, "precision mediump float; uniform vec4 u_color; void main(){ gl_FragColor = u_color; }");
  gl.compileShader(vertexShader);
  gl.compileShader(fragmentShader);
  const program = gl.createProgram();
  if (!program) {
    return;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.useProgram(program);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const colorLocation = gl.getUniformLocation(program, "u_color");
  const buffer = gl.createBuffer();
  if (!buffer || !colorLocation) {
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const toClip = (x: number, y: number) => [
    (x / context.viewWidth) * 2 - 1,
    1 - (y / context.viewHeight) * 2,
  ];
  const draw = (vertices: number[], color: [number, number, number, number], mode = gl.TRIANGLES) => {
    gl.uniform4f(colorLocation, color[0], color[1], color[2], color[3]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    gl.drawArrays(mode, 0, vertices.length / 2);
  };
  const rectVertices = (x: number, y: number, width: number, height: number) => {
    const p1 = toClip(x, y);
    const p2 = toClip(x + width, y);
    const p3 = toClip(x, y + height);
    const p4 = toClip(x + width, y + height);
    return [...p1, ...p3, ...p2, ...p2, ...p3, ...p4];
  };
  const lineRect = (x: number, y: number, width: number, height: number, color: [number, number, number, number]) => {
    draw(rectVertices(x, y, width, height), color);
  };
  const shadedRect = (
    x: number,
    y: number,
    width: number,
    height: number,
    colors: Array<[number, number, number, number]>,
  ) => {
    const bands = colors.length;
    for (let index = 0; index < bands; index += 1) {
      lineRect(x, y + (height * index) / bands, width, height / bands + 0.5, colors[index]);
    }
  };
  const polygonVertices = (points: Array<[number, number]>) => {
    if (points.length < 3) {
      return [];
    }
    const first = points[0];
    const vertices: number[] = [];
    for (let index = 1; index < points.length - 1; index += 1) {
      vertices.push(...toClip(first[0], first[1]), ...toClip(points[index][0], points[index][1]), ...toClip(points[index + 1][0], points[index + 1][1]));
    }
    return vertices;
  };
  const drawStroke = (points: Array<[number, number]>, color: [number, number, number, number], width = 1.5) => {
    for (let index = 0; index < points.length - 1; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[index + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (length <= 0.001) {
        continue;
      }
      const nx = (-dy / length) * width / 2;
      const ny = (dx / length) * width / 2;
      draw([
        ...toClip(x1 - nx, y1 - ny),
        ...toClip(x1 + nx, y1 + ny),
        ...toClip(x2 - nx, y2 - ny),
        ...toClip(x2 - nx, y2 - ny),
        ...toClip(x1 + nx, y1 + ny),
        ...toClip(x2 + nx, y2 + ny),
      ], color);
    }
  };
  const toothVertices = (xStart: number, xEnd: number, outerRadius: number, rootRadius: number, side: 1 | -1) => {
    const toothCount = Math.max(6, Math.min(44, Math.round((xEnd - xStart) / 6)));
    const pitch = (xEnd - xStart) / toothCount;
    const vertices: number[] = [];
    const rootY = context.yForR(side * rootRadius);
    const outerY = context.yForR(side * outerRadius);
    for (let index = 0; index < toothCount; index += 1) {
      const x0 = xStart + pitch * index;
      const x1 = x0 + pitch * 0.24;
      const xm = x0 + pitch * 0.5;
      const x2 = x0 + pitch * 0.76;
      vertices.push(...toClip(x1, rootY), ...toClip(xm, outerY), ...toClip(x2, rootY));
    }
    return vertices;
  };

  lineRect(context.padding.left, context.padding.top, context.plotWidth, context.plotHeight, [0.98, 0.99, 0.97, 1]);
  for (const line of gridLines(context.minS, context.maxS, context.gridMinorS)) {
    const x = context.xForS(line.value);
    if (x < context.padding.left - 1 || x > context.padding.left + context.plotWidth + 1) {
      continue;
    }
    lineRect(
      x,
      context.padding.top,
      line.major ? 1.25 : 0.75,
      context.plotHeight,
      line.major ? [0.82, 0.87, 0.86, 1] : [0.91, 0.94, 0.93, 1],
    );
  }
  for (const line of gridLines(context.minR * 2, context.maxR * 2, context.gridMinorD)) {
    const y = context.yForR(line.value / 2);
    if (y < context.padding.top - 1 || y > context.padding.top + context.plotHeight + 1) {
      continue;
    }
    lineRect(
      context.padding.left,
      y,
      context.plotWidth,
      line.major ? 1.25 : 0.75,
      line.major ? [0.82, 0.87, 0.86, 1] : [0.91, 0.94, 0.93, 1],
    );
  }

  if (context.stockStartS >= context.minS && context.stockStartS <= context.maxS) {
    lineRect(context.xForS(context.stockStartS), context.padding.top, 1.5, context.plotHeight, [0.54, 0.35, 0.13, 1]);
  }
  for (const interval of context.protectedIntervals) {
    const visibleStartS = Math.max(context.minS, interval.start_s_mm);
    const visibleEndS = Math.min(context.maxS, interval.end_s_mm);
    if (visibleEndS <= visibleStartS) {
      continue;
    }
    lineRect(context.xForS(visibleStartS), context.padding.top, context.xForS(visibleEndS) - context.xForS(visibleStartS), context.plotHeight, [0.82, 0.44, 0.32, interval.id === context.selectedObjectId ? 0.36 : 0.2]);
  }

  const stockRect = context.rectForRadius(context.stockRadius);
  const stockX = context.xForS(context.stockStartS);
  const stockWidth = context.xForS(context.stockEndS) - context.xForS(context.stockStartS);
  shadedRect(stockX, stockRect.y, stockWidth, stockRect.height, [
    [0.96, 0.89, 0.75, 1],
    [0.9, 0.71, 0.42, 1],
    [0.77, 0.54, 0.25, 1],
    [0.9, 0.71, 0.42, 1],
    [0.98, 0.93, 0.82, 1],
  ]);
  drawStroke([
    [stockX, stockRect.y],
    [stockX + stockWidth, stockRect.y],
    [stockX + stockWidth, stockRect.y + stockRect.height],
    [stockX, stockRect.y + stockRect.height],
    [stockX, stockRect.y],
  ], context.selectedObjectId?.startsWith("stock.") ? [0.73, 0.45, 0.16, 1] : [0.75, 0.48, 0.2, 1], 1.5);

  for (const span of context.spans) {
    const radius = radiusForItem(span.item);
    const gearFeature = context.isGearFeature(span.item);
    const rootRadius = gearFeature
      ? Math.max(radius * 0.62, radius - context.moduleForItem(span.item) * 1.25)
      : radius;
    const featureRect = context.rectForRadius(rootRadius);
    const xStart = context.xForS(span.startS);
    const xEnd = context.xForS(span.endS);
    const colorBands: Array<[number, number, number, number]> = gearFeature
      ? [
          [0.78, 0.88, 0.84, 1],
          [0.58, 0.75, 0.69, 1],
          [0.39, 0.58, 0.53, 1],
          [0.58, 0.75, 0.69, 1],
          [0.85, 0.93, 0.9, 1],
        ]
      : [
          [0.88, 0.94, 0.92, 1],
          [0.7, 0.82, 0.79, 1],
          [0.5, 0.65, 0.62, 1],
          [0.7, 0.82, 0.79, 1],
          [0.93, 0.97, 0.95, 1],
        ];
    shadedRect(xStart, featureRect.y, xEnd - xStart, featureRect.height, colorBands);
    const outlineColor: [number, number, number, number] = span.item.id === context.selectedObjectId
      ? [0.17, 0.44, 0.33, 1]
      : gearFeature
        ? [0.35, 0.48, 0.45, 1]
        : [0.4, 0.47, 0.48, 1];
    drawStroke([
      [xStart, featureRect.y],
      [xEnd, featureRect.y],
      [xEnd, featureRect.y + featureRect.height],
      [xStart, featureRect.y + featureRect.height],
      [xStart, featureRect.y],
    ], outlineColor, span.item.id === context.selectedObjectId ? 2.5 : 1.5);
    if (gearFeature) {
      const toothColor: [number, number, number, number] = span.item.id === context.selectedObjectId
        ? [0.49, 0.76, 0.64, 1]
        : [0.6, 0.78, 0.72, 1];
      for (const side of [1, -1] as const) {
        draw(toothVertices(xStart, xEnd, radius, rootRadius, side), toothColor);
      }
    }
  }

  for (const generated of context.toolpaths) {
    const span = context.spans.find((candidate) => candidate.item.id === generated.feature_id);
    if (!span) {
      continue;
    }
    const featureRadius = radiusForItem(span.item);
    let previous: { x: number | null; r: number | null } = { x: null, r: null };
    for (const move of generated.path.path.moves) {
      const x = typeof move.x_mm === "number" ? move.x_mm : previous.x;
      const z = typeof move.z_mm === "number" ? move.z_mm : null;
      const r = z === null ? previous.r : Math.max(0, featureRadius + z);
      const cutting = move.type === "linear_cut";
      if (cutting && previous.x !== null && previous.r !== null && x !== null && r !== null) {
        drawStroke(
          [
            [context.xForS(previous.x), context.yForR(previous.r)],
            [context.xForS(x), context.yForR(r)],
          ],
          [0.78, 0.23, 0.15, 0.9],
          2,
        );
        drawStroke(
          [
            [context.xForS(previous.x), context.yForR(-previous.r)],
            [context.xForS(x), context.yForR(-r)],
          ],
          [0.78, 0.23, 0.15, 0.55],
          1.5,
        );
      }
      previous = { x, r };
    }
  }

  for (const region of context.planningRegions) {
    const points = region.polygon.map((point) => [context.xForS(point.s_mm), context.yForR(point.r_mm)] as [number, number]);
    const fillColor: [number, number, number, number] = region.id === context.selectedObjectId ? [0.49, 0.76, 0.64, 0.28] : [0.27, 0.52, 0.68, 0.18];
    draw(polygonVertices(points), fillColor);
    drawStroke([...points, points[0]], region.id === context.selectedObjectId ? [0.17, 0.44, 0.33, 0.85] : [0.25, 0.5, 0.65, 0.75], 2);
  }
  lineRect(context.padding.left, context.yForR(0), context.plotWidth, 1.5, [0.32, 0.39, 0.4, 1]);
}

function RegionVertexHandle({
  region,
  vertexIndex,
  point,
  xForS,
  yForR,
  eventPoint,
  viewWidth,
  viewHeight,
  onSelect,
  onMove,
  onDelete,
  onMeasureAnchor,
}: {
  region: PlanningRegion;
  vertexIndex: number;
  point: PointSr;
  xForS: (sMm: number) => number;
  yForR: (rMm: number) => number;
  eventPoint: (event: React.PointerEvent<HTMLElement>) => PointSr;
  viewWidth: number;
  viewHeight: number;
  onSelect: (objectId: string) => void;
  onMove: (regionId: string, vertexIndex: number, point: PointSr) => void;
  onDelete: (regionId: string, vertexIndex: number) => void;
  onMeasureAnchor: (anchor: MeasurementAnchor) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${region.name} vertex ${vertexIndex + 1}`}
      title={region.polygon.length <= 3 ? "Planning polygons need at least three vertices" : "Double-click to remove this polygon vertex"}
      style={handleStyle(xForS(point.s_mm), yForR(point.r_mm), 14, viewWidth, viewHeight)}
      className={region.polygon.length <= 3 ? "vertex-handle locked" : "vertex-handle"}
      onClick={() => {
        onSelect(region.id);
        onMeasureAnchor({
          id: `${region.id}:v${vertexIndex}`,
          label: `${region.name} v${vertexIndex + 1}`,
          point,
        });
      }}
      onDoubleClick={() => {
        if (region.polygon.length > 3) {
          onDelete(region.id, vertexIndex);
        }
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onSelect(region.id);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) {
          onMove(region.id, vertexIndex, eventPoint(event));
        }
      }}
    />
  );
}

function AxisAlignedHandles({
  region,
  bounds,
  xForS,
  yForR,
  eventPoint,
  viewWidth,
  viewHeight,
  onSelect,
  onResize,
}: {
  region: PlanningRegion;
  bounds: RegionBounds;
  xForS: (sMm: number) => number;
  yForR: (rMm: number) => number;
  eventPoint: (event: React.PointerEvent<HTMLElement>) => PointSr;
  viewWidth: number;
  viewHeight: number;
  onSelect: (objectId: string) => void;
  onResize: (regionId: string, bounds: RegionBounds) => void;
}) {
  const handles = [
    { id: "left", x: xForS(bounds.minS), y: yForR((bounds.minR + bounds.maxR) / 2) },
    { id: "right", x: xForS(bounds.maxS), y: yForR((bounds.minR + bounds.maxR) / 2) },
    { id: "top", x: xForS((bounds.minS + bounds.maxS) / 2), y: yForR(bounds.maxR) },
    { id: "bottom", x: xForS((bounds.minS + bounds.maxS) / 2), y: yForR(bounds.minR) },
  ];
  return (
    <>
      {handles.map((handle) => (
        <button
          type="button"
          key={`${region.id}-${handle.id}`}
          aria-label={`Resize ${region.name} ${handle.id}`}
          style={handleStyle(handle.x, handle.y, 12, viewWidth, viewHeight)}
          className="axis-handle"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onSelect(region.id);
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) {
              return;
            }
            const point = eventPoint(event);
            const next = { ...bounds };
            if (handle.id === "left") {
              next.minS = Math.min(point.s_mm, bounds.maxS - 0.1);
            }
            if (handle.id === "right") {
              next.maxS = Math.max(point.s_mm, bounds.minS + 0.1);
            }
            if (handle.id === "top") {
              next.maxR = Math.max(point.r_mm, bounds.minR + 0.1);
            }
            if (handle.id === "bottom") {
              next.minR = Math.min(point.r_mm, bounds.maxR - 0.1);
            }
            onResize(region.id, next);
          }}
        />
      ))}
    </>
  );
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="field-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value);
          if (Number.isFinite(nextValue)) {
            onChange(nextValue);
          }
        }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="readonly-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReferenceField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const values = Array.from(new Set([value, ...options].filter(Boolean)));
  if (values.length > 0) {
    return <SelectField label={label} value={value} options={values} onChange={onChange} />;
  }
  return <TextField label={label} value={value} onChange={onChange} />;
}

function FeatureInspector({
  feature,
  interval,
  diagnostics,
  toolOptions,
  onUpdate,
  onDelete,
  canDelete,
}: {
  feature: StackItem;
  interval: FeaturePosition | null;
  diagnostics: ValidationDiagnostic[];
  toolOptions: string[];
  onUpdate: (patch: Partial<StackItem>) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Feature">
        <ReadonlyField label="Type" value={featureTypeLabel(feature.type)} />
        <ReadonlyField label="ID" value={feature.id} />
        {interval ? (
          <ReadonlyField label="Position s" value={`${formatMm(interval.start_s_mm)}-${formatMm(interval.end_s_mm)}`} />
        ) : null}
        <TextField label="Name" value={feature.name} onChange={(name) => onUpdate({ name })} />
        <NumberField label="Length mm" value={feature.length_mm} onChange={(length_mm) => onUpdate({ length_mm })} />
      </FieldGroup>
      <FeatureTypeFields feature={feature} toolOptions={toolOptions} onUpdate={onUpdate} />
      <FieldGroup title="Actions">
        <button type="button" className="danger-action" onClick={onDelete} disabled={!canDelete}>
          <Trash2 aria-hidden="true" />
          Delete feature
        </button>
        {!canDelete ? <p className="field-hint">The stack must contain at least one feature.</p> : null}
      </FieldGroup>
      {diagnostics.length > 0 ? (
        <div className="selection-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <p key={`${diagnostic.message}-${index}`}>{diagnostic.message}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LibraryInspector({
  library,
  tab,
  selectedMachineId,
  selectedToolId,
  selectedMaterialId,
  libraryJson,
  onTabChange,
  onSelectMachine,
  onSelectTool,
  onSelectMaterial,
  onUpdateMachine,
  onUpdateTool,
  onAddTool,
  onUpdateMaterial,
  onLibraryJsonChange,
  onExport,
  onImport,
}: {
  library: LibraryConfig;
  tab: LibraryTab;
  selectedMachineId: string;
  selectedToolId: string;
  selectedMaterialId: string;
  libraryJson: string;
  onTabChange: (tab: LibraryTab) => void;
  onSelectMachine: (id: string) => void;
  onSelectTool: (id: string) => void;
  onSelectMaterial: (id: string) => void;
  onUpdateMachine: (profileId: string, updater: (profile: MachineProfile) => MachineProfile) => void;
  onUpdateTool: (toolId: string, updater: (tool: ToolDefinition) => ToolDefinition) => void;
  onAddTool: (type: ToolType) => void;
  onUpdateMaterial: (materialId: string, updater: (material: MaterialDefinition) => MaterialDefinition) => void;
  onLibraryJsonChange: (value: string) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const selectedMachine = library.machineProfiles.find((profile) => profile.id === selectedMachineId) ?? library.machineProfiles[0] ?? null;
  const selectedTool = library.tools.find((tool) => tool.id === selectedToolId) ?? library.tools[0] ?? null;
  const selectedMaterial = library.materials.find((material) => material.id === selectedMaterialId) ?? library.materials[0] ?? null;
  return (
    <div className="inspector-content">
      <div className="library-tabs" role="tablist" aria-label="Library editor sections">
        {[
          ["machine", "Machines"],
          ["tools", "Tools"],
          ["materials", "Materials"],
          ["exchange", "Import/export"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? "active" : ""}
            onClick={() => onTabChange(value as LibraryTab)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "machine" && selectedMachine ? (
        <MachineLibraryEditor
          profile={selectedMachine}
          options={library.machineProfiles.map((profile) => profile.id)}
          onSelect={onSelectMachine}
          onUpdate={(updater) => onUpdateMachine(selectedMachine.id, updater)}
        />
      ) : null}
      {tab === "tools" && selectedTool ? (
        <ToolLibraryEditor
          tool={selectedTool}
          options={library.tools.map((tool) => tool.id)}
          onSelect={onSelectTool}
          onUpdate={(updater) => onUpdateTool(selectedTool.id, updater)}
          onAddTool={onAddTool}
        />
      ) : null}
      {tab === "materials" && selectedMaterial ? (
        <MaterialLibraryEditor
          material={selectedMaterial}
          options={library.materials.map((material) => material.id)}
          onSelect={onSelectMaterial}
          onUpdate={(updater) => onUpdateMaterial(selectedMaterial.id, updater)}
        />
      ) : null}
      {tab === "exchange" ? (
        <LibraryExchangeEditor
          libraryJson={libraryJson}
          onLibraryJsonChange={onLibraryJsonChange}
          onExport={onExport}
          onImport={onImport}
        />
      ) : null}
    </div>
  );
}

function MachineLibraryEditor({
  profile,
  options,
  onSelect,
  onUpdate,
}: {
  profile: MachineProfile;
  options: string[];
  onSelect: (id: string) => void;
  onUpdate: (updater: (profile: MachineProfile) => MachineProfile) => void;
}) {
  return (
    <>
      <FieldGroup title="Machine profile">
        <ReferenceField label="Profile" value={profile.id} options={options} onChange={onSelect} />
        <ReadonlyField label="ID" value={profile.id} />
        <TextField label="Name" value={profile.name} onChange={(name) => onUpdate((current) => ({ ...current, name }))} />
        <SelectField
          label="Postprocessor"
          value={profile.postprocessor}
          options={["carvera_air"]}
          onChange={(postprocessor) => onUpdate((current) => ({ ...current, postprocessor }))}
        />
      </FieldGroup>
      <FieldGroup title="Axis mapping">
        <SelectField label="Shaft axis" value={profile.axis_mapping.shaft_axis} options={["X", "Y", "Z"]} onChange={(shaft_axis) => onUpdate((current) => ({ ...current, axis_mapping: { ...current.axis_mapping, shaft_axis } }))} />
        <SelectField label="Virtual rack axis" value={profile.axis_mapping.virtual_rack_axis} options={["X", "Y", "Z"]} onChange={(virtual_rack_axis) => onUpdate((current) => ({ ...current, axis_mapping: { ...current.axis_mapping, virtual_rack_axis } }))} />
        <SelectField label="Radial axis" value={profile.axis_mapping.radial_axis} options={["X", "Y", "Z"]} onChange={(radial_axis) => onUpdate((current) => ({ ...current, axis_mapping: { ...current.axis_mapping, radial_axis } }))} />
        <SelectField label="Rotary axis" value={profile.axis_mapping.rotary_axis} options={["A", "B", "C"]} onChange={(rotary_axis) => onUpdate((current) => ({ ...current, axis_mapping: { ...current.axis_mapping, rotary_axis } }))} />
        <NumberField label="Rotary sign" value={profile.axis_mapping.rotary_sign} onChange={(rotary_sign) => onUpdate((current) => ({ ...current, axis_mapping: { ...current.axis_mapping, rotary_sign } }))} />
      </FieldGroup>
      <FieldGroup title="Machine limits">
        <NumberField label="Max stock dia mm" value={profile.limits.max_stock_diameter_mm} onChange={(max_stock_diameter_mm) => onUpdate((current) => ({ ...current, limits: { ...current.limits, max_stock_diameter_mm } }))} />
        <NumberField label="Max stock length mm" value={profile.limits.max_stock_length_mm} onChange={(max_stock_length_mm) => onUpdate((current) => ({ ...current, limits: { ...current.limits, max_stock_length_mm } }))} />
        <NumberField label="Travel X mm" value={profile.limits.travel_x_mm} onChange={(travel_x_mm) => onUpdate((current) => ({ ...current, limits: { ...current.limits, travel_x_mm } }))} />
        <NumberField label="Travel Y mm" value={profile.limits.travel_y_mm} onChange={(travel_y_mm) => onUpdate((current) => ({ ...current, limits: { ...current.limits, travel_y_mm } }))} />
        <NumberField label="Travel Z mm" value={profile.limits.travel_z_mm} onChange={(travel_z_mm) => onUpdate((current) => ({ ...current, limits: { ...current.limits, travel_z_mm } }))} />
        <NumberField label="Max spindle RPM" value={profile.limits.max_spindle_rpm} step={100} onChange={(max_spindle_rpm) => onUpdate((current) => ({ ...current, limits: { ...current.limits, max_spindle_rpm } }))} />
      </FieldGroup>
    </>
  );
}

function ToolLibraryEditor({
  tool,
  options,
  onSelect,
  onUpdate,
  onAddTool,
}: {
  tool: ToolDefinition;
  options: string[];
  onSelect: (id: string) => void;
  onUpdate: (updater: (tool: ToolDefinition) => ToolDefinition) => void;
  onAddTool: (type: ToolType) => void;
}) {
  return (
    <>
      <FieldGroup title="Tool">
        <ReferenceField label="Tool" value={tool.id} options={options} onChange={onSelect} />
        <ReadonlyField label="ID" value={tool.id} />
        <TextField label="Name" value={tool.name} onChange={(name) => onUpdate((current) => ({ ...current, name }))} />
        <SelectField
          label="Type"
          value={tool.type}
          options={["v_cutter", "cylindrical_cutter"]}
          onChange={(type) => onUpdate((current) => ({ ...current, type: type as ToolType }))}
        />
      </FieldGroup>
      {tool.type === "v_cutter" ? (
        <FieldGroup title="V cutter geometry">
          <NumberField label="Included angle deg" value={tool.included_angle_deg ?? 60} onChange={(included_angle_deg) => onUpdate((current) => ({ ...current, included_angle_deg }))} />
          <NumberField label="Tip flat mm" value={tool.tip_flat_width_mm ?? 0} onChange={(tip_flat_width_mm) => onUpdate((current) => ({ ...current, tip_flat_width_mm }))} />
          <NumberField label="Max cut dia mm" value={tool.max_cut_diameter_mm ?? 0} onChange={(max_cut_diameter_mm) => onUpdate((current) => ({ ...current, max_cut_diameter_mm }))} />
        </FieldGroup>
      ) : (
        <FieldGroup title="Cylindrical cutter geometry">
          <NumberField label="Diameter mm" value={tool.diameter_mm ?? 0} onChange={(diameter_mm) => onUpdate((current) => ({ ...current, diameter_mm }))} />
          <NumberField label="Corner radius mm" value={tool.corner_radius_mm ?? 0} onChange={(corner_radius_mm) => onUpdate((current) => ({ ...current, corner_radius_mm }))} />
          <NumberField label="Cutting length mm" value={tool.cutting_length_mm ?? 0} onChange={(cutting_length_mm) => onUpdate((current) => ({ ...current, cutting_length_mm }))} />
        </FieldGroup>
      )}
      <FieldGroup title="Holder and reach">
        <NumberField label="Flute length mm" value={tool.flute_length_mm} onChange={(flute_length_mm) => onUpdate((current) => ({ ...current, flute_length_mm }))} />
        <NumberField label="Shank dia mm" value={tool.shank_diameter_mm} onChange={(shank_diameter_mm) => onUpdate((current) => ({ ...current, shank_diameter_mm }))} />
        <NumberField label="Stickout mm" value={tool.stickout_mm} onChange={(stickout_mm) => onUpdate((current) => ({ ...current, stickout_mm }))} />
        <NumberField label="Holder dia mm" value={tool.holder_diameter_mm ?? 0} onChange={(holder_diameter_mm) => onUpdate((current) => ({ ...current, holder_diameter_mm }))} />
        <NumberField label="Holder length mm" value={tool.holder_length_mm ?? 0} onChange={(holder_length_mm) => onUpdate((current) => ({ ...current, holder_length_mm }))} />
      </FieldGroup>
      <FieldGroup title="Add tool">
        <div className="inline-actions">
          <button type="button" onClick={() => onAddTool("v_cutter")}>Add V-cutter</button>
          <button type="button" onClick={() => onAddTool("cylindrical_cutter")}>Add cylindrical</button>
        </div>
      </FieldGroup>
    </>
  );
}

function MaterialLibraryEditor({
  material,
  options,
  onSelect,
  onUpdate,
}: {
  material: MaterialDefinition;
  options: string[];
  onSelect: (id: string) => void;
  onUpdate: (updater: (material: MaterialDefinition) => MaterialDefinition) => void;
}) {
  return (
    <>
      <FieldGroup title="Material">
        <ReferenceField label="Material" value={material.id} options={options} onChange={onSelect} />
        <ReadonlyField label="ID" value={material.id} />
        <TextField label="Name" value={material.name} onChange={(name) => onUpdate((current) => ({ ...current, name }))} />
      </FieldGroup>
      {material.recipes.map((recipe, index) => (
        <FieldGroup key={`${material.id}-recipe-${index}`} title={`Recipe ${index + 1}`}>
          <SelectField
            label="Tool class"
            value={recipe.tool_class}
            options={["v_cutter", "cylindrical_cutter"]}
            onChange={(tool_class) => onUpdate((current) => ({
              ...current,
              recipes: current.recipes.map((candidate, candidateIndex) =>
                candidateIndex === index ? { ...candidate, tool_class: tool_class as ToolType } : candidate,
              ),
            }))}
          />
          <TextField label="Operation" value={recipe.operation} onChange={(operation) => onUpdate((current) => ({ ...current, recipes: current.recipes.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, operation } : candidate) }))} />
          <TextField label="Engagement" value={recipe.engagement} onChange={(engagement) => onUpdate((current) => ({ ...current, recipes: current.recipes.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, engagement } : candidate) }))} />
          <NumberField label="Feed mm/min" value={recipe.feed_mm_min} onChange={(feed_mm_min) => onUpdate((current) => ({ ...current, recipes: current.recipes.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, feed_mm_min } : candidate) }))} />
          <NumberField label="Spindle RPM" value={recipe.spindle_rpm} step={100} onChange={(spindle_rpm) => onUpdate((current) => ({ ...current, recipes: current.recipes.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, spindle_rpm } : candidate) }))} />
          <NumberField label="Radial DOC mm" value={recipe.radial_depth_per_pass_mm} onChange={(radial_depth_per_pass_mm) => onUpdate((current) => ({ ...current, recipes: current.recipes.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, radial_depth_per_pass_mm } : candidate) }))} />
        </FieldGroup>
      ))}
    </>
  );
}

function LibraryExchangeEditor({
  libraryJson,
  onLibraryJsonChange,
  onExport,
  onImport,
}: {
  libraryJson: string;
  onLibraryJsonChange: (value: string) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  return (
    <FieldGroup title="Library JSON">
      <textarea
        className="library-json"
        aria-label="Library JSON"
        value={libraryJson}
        onChange={(event) => onLibraryJsonChange(event.target.value)}
      />
      <div className="inline-actions">
        <button type="button" onClick={onExport}>Refresh export</button>
        <button type="button" onClick={onImport}>Import JSON</button>
      </div>
    </FieldGroup>
  );
}

function FeatureTypeFields({
  feature,
  toolOptions,
  onUpdate,
}: {
  feature: StackItem;
  toolOptions: string[];
  onUpdate: (patch: Partial<StackItem>) => void;
}) {
  if (feature.type === "cylindrical_section") {
    const machining = objectValue(feature.machining);
    return (
      <>
        <FieldGroup title="Cylinder">
          <NumberField label="Radius mm" value={numberValue(feature.radius_mm)} onChange={(radius_mm) => onUpdate({ radius_mm })} />
        </FieldGroup>
        <FieldGroup title="Machining tools">
          <ReferenceField
            label="Roughing tool"
            value={stringValue(machining.roughing_tool_id)}
            options={toolOptions}
            onChange={(roughing_tool_id) => onUpdate({ machining: { ...machining, roughing_tool_id } })}
          />
          <ReferenceField
            label="Finishing tool"
            value={stringValue(machining.finishing_tool_id)}
            options={toolOptions}
            onChange={(finishing_tool_id) => onUpdate({ machining: { ...machining, finishing_tool_id } })}
          />
        </FieldGroup>
      </>
    );
  }
  if (feature.type === "eccentric_section") {
    return (
      <FieldGroup title="Eccentric">
        <NumberField label="Radius mm" value={numberValue(feature.radius_mm)} onChange={(radius_mm) => onUpdate({ radius_mm })} />
        <NumberField label="Offset Y mm" value={numberValue(feature.offset_y_mm)} onChange={(offset_y_mm) => onUpdate({ offset_y_mm })} />
        <NumberField label="Offset Z mm" value={numberValue(feature.offset_z_mm)} onChange={(offset_z_mm) => onUpdate({ offset_z_mm })} />
      </FieldGroup>
    );
  }
  if (feature.type === "spur_gear") {
    return <SpurGearFields gear={feature} toolOptions={toolOptions} onUpdate={(patch) => onUpdate(patch)} title="Spur gear" />;
  }
  if (feature.type === "helical_gear") {
    const spur = objectValue(feature.spur);
    return (
      <>
        <FieldGroup title="Helix">
          <NumberField label="Helix angle deg" value={numberValue(feature.helix_angle_deg)} onChange={(helix_angle_deg) => onUpdate({ helix_angle_deg })} />
          <SelectField label="Hand" value={stringValue(feature.hand, "right")} options={["left", "right"]} onChange={(hand) => onUpdate({ hand })} />
        </FieldGroup>
        <SpurGearFields
          title="Nested spur geometry"
          gear={spur}
          toolOptions={toolOptions}
          onUpdate={(patch) => onUpdate({ spur: { ...spur, ...patch } })}
        />
      </>
    );
  }
  if (feature.type === "herringbone_gear") {
    const left = objectValue(feature.left);
    const right = objectValue(feature.right);
    const leftSpur = objectValue(left.spur);
    const rightSpur = objectValue(right.spur);
    return (
      <>
        <FieldGroup title="Herringbone">
          <NumberField label="Center relief mm" value={numberValue(feature.center_relief_width_mm)} onChange={(center_relief_width_mm) => onUpdate({ center_relief_width_mm })} />
          <NumberField
            label="Left helix deg"
            value={numberValue(left.helix_angle_deg, 15)}
            onChange={(helix_angle_deg) => onUpdate({ left: { ...left, helix_angle_deg, spur: leftSpur } })}
          />
          <SelectField
            label="Left hand"
            value={stringValue(left.hand, "left")}
            options={["left", "right"]}
            onChange={(hand) => onUpdate({ left: { ...left, hand, spur: leftSpur } })}
          />
          <NumberField
            label="Right helix deg"
            value={numberValue(right.helix_angle_deg, 15)}
            onChange={(helix_angle_deg) => onUpdate({ right: { ...right, helix_angle_deg, spur: rightSpur } })}
          />
          <SelectField
            label="Right hand"
            value={stringValue(right.hand, "right")}
            options={["left", "right"]}
            onChange={(hand) => onUpdate({ right: { ...right, hand, spur: rightSpur } })}
          />
        </FieldGroup>
        <SpurGearFields
          title="Left spur geometry"
          gear={leftSpur}
          toolOptions={toolOptions}
          onUpdate={(patch) => onUpdate({ left: { ...left, spur: { ...leftSpur, ...patch } } })}
        />
        <SpurGearFields
          title="Right spur geometry"
          gear={rightSpur}
          toolOptions={toolOptions}
          onUpdate={(patch) => onUpdate({ right: { ...right, spur: { ...rightSpur, ...patch } } })}
        />
      </>
    );
  }
  return <ReadonlyField label="Geometry" value="Unsupported feature form" />;
}

function SpurGearFields({
  title,
  gear,
  toolOptions,
  onUpdate,
}: {
  title: string;
  gear: Record<string, unknown>;
  toolOptions: string[];
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const moduleMm = numberValue(gear.module_mm);
  const toothCount = numberValue(gear.tooth_count);
  const addendumCoeff = numberValue(gear.addendum_coeff, 1);
  const dedendumCoeff = numberValue(gear.dedendum_coeff, 1.25);
  const profileShift = numberValue(gear.profile_shift);
  const pitchDiameter = moduleMm * toothCount;
  const outsideDiameter = pitchDiameter + 2 * moduleMm * (addendumCoeff + profileShift);
  const rootDiameter = Math.max(0, pitchDiameter - 2 * moduleMm * (dedendumCoeff - profileShift));
  return (
    <FieldGroup title={title}>
      <NumberField label="Module mm" value={numberValue(gear.module_mm)} onChange={(module_mm) => onUpdate({ module_mm })} />
      <NumberField label="Teeth" value={numberValue(gear.tooth_count)} step={1} onChange={(tooth_count) => onUpdate({ tooth_count: Math.max(1, Math.round(tooth_count)) })} />
      <NumberField label="Pressure angle deg" value={numberValue(gear.pressure_angle_deg, 20)} onChange={(pressure_angle_deg) => onUpdate({ pressure_angle_deg })} />
      <NumberField label="Profile shift" value={numberValue(gear.profile_shift)} onChange={(profile_shift) => onUpdate({ profile_shift })} />
      <NumberField label="Addendum coeff" value={numberValue(gear.addendum_coeff, 1)} onChange={(addendum_coeff) => onUpdate({ addendum_coeff })} />
      <NumberField label="Dedendum coeff" value={numberValue(gear.dedendum_coeff, 1.25)} onChange={(dedendum_coeff) => onUpdate({ dedendum_coeff })} />
      <NumberField label="Backlash mm" value={numberValue(gear.backlash_mm)} onChange={(backlash_mm) => onUpdate({ backlash_mm })} />
      <NumberField label="Phase deg" value={numberValue(gear.phase_deg)} onChange={(phase_deg) => onUpdate({ phase_deg })} />
      <ReadonlyField label="Pitch diameter" value={formatMm(pitchDiameter)} />
      <ReadonlyField label="Root diameter" value={formatMm(rootDiameter)} />
      <ReadonlyField label="Outside diameter" value={formatMm(outsideDiameter)} />
      <ReadonlyField label="Outside radius" value={formatMm(radiusForItem(gear as StackItem))} />
      <ToolFields gear={gear} toolOptions={toolOptions} onUpdate={onUpdate} />
    </FieldGroup>
  );
}

function ToolFields({
  gear,
  toolOptions,
  onUpdate,
}: {
  gear: Record<string, unknown>;
  toolOptions: string[];
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const machining = objectValue(gear.machining);
  return (
    <>
      <ReferenceField
        label="OD tool"
        value={stringValue(machining.od_tool_id)}
        options={toolOptions}
        onChange={(od_tool_id) => onUpdate({ machining: { ...machining, od_tool_id } })}
      />
      <ReferenceField
        label="V tool"
        value={stringValue(machining.v_tool_id)}
        options={toolOptions}
        onChange={(v_tool_id) => onUpdate({ machining: { ...machining, v_tool_id } })}
      />
      <ReferenceField
        label="Root tool"
        value={stringValue(machining.root_tool_id)}
        options={toolOptions}
        onChange={(root_tool_id) => onUpdate({ machining: { ...machining, root_tool_id } })}
      />
    </>
  );
}

function RegionInspector({
  region,
  onUpdate,
  onDelete,
  onAddVertexAfter,
  onUpdateBounds,
  onDeleteVertex,
}: {
  region: PlanningRegion;
  onUpdate: (patch: Partial<PlanningRegion>) => void;
  onDelete: () => void;
  onAddVertexAfter: (vertexIndex: number) => void;
  onUpdateBounds: (bounds: RegionBounds) => void;
  onDeleteVertex: (vertexIndex: number) => void;
}) {
  const bounds = regionBounds(region);
  return (
    <div className="inspector-content">
      <FieldGroup title="Planning region">
        <ReadonlyField label="ID" value={region.id} />
        <TextField label="Name" value={region.name} onChange={(name) => onUpdate({ name })} />
        <TextField label="Purpose" value={region.purpose} onChange={(purpose) => onUpdate({ purpose })} />
        <NumberField label="Stage" value={region.stage} step={1} onChange={(stage) => onUpdate({ stage: Math.round(stage) })} />
        <ReadonlyField label="Shape" value={isAxisAlignedRectangle(region) ? "Axis-aligned rectangle" : "Polygon"} />
      </FieldGroup>
      {bounds && isAxisAlignedRectangle(region) ? (
        <FieldGroup title="Bounds">
          <NumberField label="Start s mm" value={bounds.minS} onChange={(minS) => onUpdateBounds({ ...bounds, minS })} />
          <NumberField label="End s mm" value={bounds.maxS} onChange={(maxS) => onUpdateBounds({ ...bounds, maxS })} />
          <NumberField label="Inner r mm" value={bounds.minR} onChange={(minR) => onUpdateBounds({ ...bounds, minR })} />
          <NumberField label="Outer r mm" value={bounds.maxR} onChange={(maxR) => onUpdateBounds({ ...bounds, maxR })} />
        </FieldGroup>
      ) : null}
      <div className="vertex-table">
        {region.polygon.map((point, index) => (
          <div key={`${region.id}-${index}`} className="vertex-row">
            <span>v{index + 1}</span>
            <span>s {point.s_mm.toFixed(3)}</span>
            <span>r {point.r_mm.toFixed(3)}</span>
            <button type="button" onClick={() => onAddVertexAfter(index)} title={`Add vertex after v${index + 1}`}>
              <CirclePlus aria-hidden="true" />
              Add
            </button>
            <button type="button" onClick={() => onDeleteVertex(index)}>
              Delete
            </button>
          </div>
        ))}
      </div>
      <FieldGroup title="Actions">
        <button type="button" className="danger-action" onClick={onDelete}>
          <Trash2 aria-hidden="true" />
          Delete planning region
        </button>
      </FieldGroup>
    </div>
  );
}

function ProtectedIntervalInspector({
  interval,
  onUpdate,
  onDelete,
}: {
  interval: NonNullable<HobgoblinProject["setup"]["protected_intervals"]>[number];
  onUpdate: (patch: { start_s_mm?: number; end_s_mm?: number; purpose?: string }) => void;
  onDelete: () => void;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Protected interval">
        <ReadonlyField label="ID" value={interval.id} />
        <TextField label="Purpose" value={interval.purpose} onChange={(purpose) => onUpdate({ purpose })} />
        <NumberField label="Start s mm" value={interval.start_s_mm} onChange={(start_s_mm) => onUpdate({ start_s_mm })} />
        <NumberField label="End s mm" value={interval.end_s_mm} onChange={(end_s_mm) => onUpdate({ end_s_mm })} />
      </FieldGroup>
      <FieldGroup title="Actions">
        <button type="button" className="danger-action" onClick={onDelete}>
          <Trash2 aria-hidden="true" />
          Delete protected interval
        </button>
      </FieldGroup>
    </div>
  );
}

function StockInspector({
  stock,
  materialOptions,
  onUpdate,
}: {
  stock: HobgoblinProject["stock"];
  materialOptions: string[];
  onUpdate: (patch: Partial<HobgoblinProject["stock"]>) => void;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Stock">
        <ReadonlyField label="ID" value={stock.id} />
        <NumberField label="Diameter mm" value={stock.diameter_mm} onChange={(diameter_mm) => onUpdate({ diameter_mm })} />
        <NumberField label="Length mm" value={stock.length_mm} onChange={(length_mm) => onUpdate({ length_mm })} />
        <ReferenceField label="Material" value={stock.material_id} options={materialOptions} onChange={(material_id) => onUpdate({ material_id })} />
      </FieldGroup>
    </div>
  );
}

function SetupInspector({
  setup,
  machineOptions,
  onUpdate,
}: {
  setup: HobgoblinProject["setup"];
  machineOptions: string[];
  onUpdate: (patch: Partial<HobgoblinProject["setup"]>) => void;
}) {
  const workholding = setup.workholding ?? defaultWorkholding();
  const tailstock = workholding.tailstock;
  const updateWorkholding = (patch: Partial<NonNullable<HobgoblinProject["setup"]["workholding"]>>) =>
    onUpdate({ workholding: { ...workholding, ...patch } });
  const updateTailstock = (patch: Partial<NonNullable<HobgoblinProject["setup"]["workholding"]>["tailstock"]>) =>
    updateWorkholding({ tailstock: { ...tailstock, ...patch } });
  return (
    <div className="inspector-content">
      <FieldGroup title="Setup">
        <ReadonlyField label="ID" value={setup.id} />
        <TextField label="Name" value={setup.name} onChange={(name) => onUpdate({ name })} />
        <ReferenceField label="Machine" value={setup.machine_profile_id} options={machineOptions} onChange={(machine_profile_id) => onUpdate({ machine_profile_id })} />
      </FieldGroup>
      <FieldGroup title="Workholding">
        <SelectField
          label="Held side"
          value={workholding.held_side}
          options={["left", "right"]}
          onChange={(held_side) => updateWorkholding({ held_side: held_side as "left" | "right" })}
        />
        <SelectField
          label="Tailstock"
          value={tailstock.enabled ? "enabled" : "disabled"}
          options={["enabled", "disabled"]}
          onChange={(value) => updateTailstock({ enabled: value === "enabled" })}
        />
        <NumberField
          label="Tailstock start s"
          value={tailstock.protected_start_s_mm ?? 0}
          onChange={(protected_start_s_mm) => updateTailstock({ protected_start_s_mm })}
        />
        <NumberField
          label="Tailstock end s"
          value={tailstock.protected_end_s_mm ?? 0}
          onChange={(protected_end_s_mm) => updateTailstock({ protected_end_s_mm })}
        />
      </FieldGroup>
    </div>
  );
}

function ProjectInspector({
  project,
  onUpdate,
}: {
  project: HobgoblinProject;
  onUpdate: (patch: Partial<HobgoblinProject["project"]>) => void;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Project">
        <ReadonlyField label="ID" value={project.project.id} />
        <TextField label="Name" value={project.project.name} onChange={(name) => onUpdate({ name })} />
        <ReadonlyField label="Units" value={project.unit_system} />
        <ReadonlyField label="Machine" value={project.setup.machine_profile_id} />
      </FieldGroup>
    </div>
  );
}

function libraryDiagnostics(project: HobgoblinProject, library: LibraryConfig): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const machineIds = new Set(library.machineProfiles.map((profile) => profile.id));
  const materialIds = new Set(library.materials.map((material) => material.id));
  const toolIds = new Set(library.tools.map((tool) => tool.id));
  if (!machineIds.has(project.setup.machine_profile_id)) {
    diagnostics.push({
      severity: "error",
      object_id: project.setup.id,
      message: `Machine profile ${project.setup.machine_profile_id} is not in the edited library`,
    });
  }
  if (!materialIds.has(project.stock.material_id)) {
    diagnostics.push({
      severity: "error",
      object_id: project.stock.id,
      message: `Material ${project.stock.material_id} is not in the edited library`,
    });
  }
  for (const toolId of project.library_refs?.tool_ids ?? []) {
    if (!toolIds.has(toolId)) {
      diagnostics.push({
        severity: "error",
        object_id: project.project.id,
        message: `Tool ${toolId} is listed in project library refs but is not in the edited library`,
      });
    }
  }
  for (const item of project.stack) {
    for (const toolId of toolIdsForStackItem(item)) {
      if (!toolIds.has(toolId)) {
        diagnostics.push({
          severity: "error",
          object_id: item.id,
          message: `Tool ${toolId} is not in the edited library`,
        });
      }
    }
  }
  return diagnostics;
}

function generateBrowserToolpathPreview(project: HobgoblinProject): ToolpathGenerationResponse {
  const spans = stackSpans(project);
  const operations: OperationSummary[] = [];
  for (const region of project.planning_regions ?? []) {
    operations.push({
      id: `op.region.${region.id}.${region.purpose}`,
      feature_id: null,
      region_id: region.id,
      kind: `${region.purpose}_region`,
      stage: region.stage,
    });
  }
  for (const span of spans) {
    operations.push({
      id: `op.feature.${span.item.id}.${isGearStackItem(span.item) ? "generated_shaping" : "finish"}`,
      feature_id: span.item.id,
      region_id: null,
      kind: isGearStackItem(span.item) ? "browser_spur_shaping_preview" : "cylindrical_finish_surface",
      stage: isGearStackItem(span.item) ? 120 : 100,
    });
  }
  const spurSpan = spans.find((span) => span.item.type === "spur_gear");
  if (!spurSpan) {
    return {
      diagnostics: [{
        severity: "warning",
        object_id: project.project.id,
        message: "Browser preview generation currently needs a spur gear feature",
      }],
      operations,
      paths: [],
    };
  }

  const radius = radiusForItem(spurSpan.item);
  const moves: AbstractMove[] = [];
  const layerDepths = [0.25, 0.5, 0.75, 1.0];
  const previewStepCount = Math.max(8, Math.min(32, toothCountForStackItem(spurSpan.item)));
  for (const [layerIndex, depth] of layerDepths.entries()) {
    for (let step = 0; step < previewStepCount; step += 1) {
      const ratio = step / Math.max(1, previewStepCount - 1);
      const rackY = (ratio - 0.5) * Math.max(2, radius * 0.8);
      const aDeg = ratio * 360;
      const zMm = -depth;
      moves.push(
        { type: "rapid", x_mm: spurSpan.startS - 1, y_mm: rackY, z_mm: 5, a_deg: aDeg },
        { type: "rapid", x_mm: spurSpan.startS - 1, y_mm: rackY, z_mm: zMm, a_deg: aDeg },
        {
          type: "linear_cut",
          x_mm: spurSpan.endS + 1,
          y_mm: rackY,
          z_mm: zMm,
          a_deg: aDeg,
          feed_mm_min: 100 + layerIndex * 20,
        },
        { type: "rapid", x_mm: spurSpan.endS + 1, y_mm: rackY, z_mm: 5, a_deg: aDeg },
      );
    }
  }
  return {
    diagnostics: [{
      severity: "warning",
      object_id: spurSpan.item.id,
      message: "Browser mode shows synthetic path preview data; run the Tauri desktop shell to generate paths with the Rust planner",
    }],
    operations,
    paths: [{
      feature_id: spurSpan.item.id,
      path: {
        path: {
          id: `path.${spurSpan.item.id}.browser_preview`,
          operation_id: `op.feature.${spurSpan.item.id}.browser_preview`,
          moves,
        },
        debug_steps: [],
        adaptive_rack_stepping: { source: "browser_preview" },
      },
    }],
  };
}

function isGearStackItem(item: StackItem) {
  return item.type === "spur_gear" || item.type === "helical_gear" || item.type === "herringbone_gear";
}

function toothCountForStackItem(item: StackItem): number {
  const direct = typeof item.tooth_count === "number" ? item.tooth_count : null;
  const spur = typeof item.spur === "object" && item.spur !== null ? (item.spur as Record<string, unknown>) : null;
  const nested = typeof spur?.tooth_count === "number" ? spur.tooth_count : null;
  return Math.max(6, Math.min(48, Math.round(direct ?? nested ?? 18)));
}

function toolIdsForStackItem(item: StackItem): string[] {
  const ids = new Set<string>();
  collectToolIds(item, ids);
  return [...ids];
}

function collectToolIds(value: unknown, ids: Set<string>) {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("_tool_id") && typeof child === "string") {
      ids.add(child);
      continue;
    }
    collectToolIds(child, ids);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function createDefaultProject(): HobgoblinProject {
  return {
    schema_version: 0,
    unit_system: "metric",
    project: {
      id: "project.untitled",
      name: "Untitled shaft",
      datum: {
        kind: "user_defined",
        s_offset_mm: 0,
      },
    },
    setup: {
      id: "setup.single_carvera",
      name: "Single Carvera setup",
      machine_profile_id: defaultMachineId,
      workholding: defaultWorkholding(),
      protected_intervals: [
        {
          id: "protect.left_chuck",
          purpose: "chuck_grip",
          start_s_mm: -18,
          end_s_mm: 0,
        },
      ],
    },
    stock: {
      id: "stock.default",
      diameter_mm: 16,
      length_mm: 80,
      material_id: defaultMaterialId,
    },
    stack: [
      {
        id: "feature.journal",
        name: "Journal",
        length_mm: 40,
        type: "cylindrical_section",
        radius_mm: 4,
        machining: {
          roughing_tool_id: defaultEndmillId,
          finishing_tool_id: defaultEndmillId,
        },
      },
    ],
    planning_regions: [
      {
        id: "region.initial_rough",
        name: "Initial roughing envelope",
        stage: 10,
        purpose: "roughing",
        allowed_feature_ids: ["feature.journal"],
        polygon: [
          { s_mm: 0, r_mm: 8 },
          { s_mm: 72, r_mm: 8 },
          { s_mm: 72, r_mm: 5 },
          { s_mm: 0, r_mm: 5 },
        ],
      },
    ],
    library_refs: {
      machine_profile_id: defaultMachineId,
      material_id: defaultMaterialId,
      tool_ids: [defaultVCutterId, defaultEndmillId],
    },
  };
}

function defaultWorkholding(): NonNullable<HobgoblinProject["setup"]["workholding"]> {
  return {
    held_side: "left",
    tailstock: {
      enabled: false,
      protected_start_s_mm: null,
      protected_end_s_mm: null,
    },
  };
}

function DiagnosticsList({
  diagnostics,
  selectedObjectId,
  onSelect,
}: {
  diagnostics: ValidationDiagnostic[];
  selectedObjectId: string | null;
  onSelect: (objectId: string) => void;
}) {
  if (diagnostics.length === 0) {
    return <div className="diagnostic-empty">Validation passed with no diagnostics.</div>;
  }
  return (
    <div className="diagnostic-list">
      {diagnostics.map((diagnostic, index) => (
        <button
          type="button"
          key={`${diagnostic.message}-${index}`}
          className={
            diagnostic.object_id === selectedObjectId
              ? `diagnostic ${diagnostic.severity} selected`
              : `diagnostic ${diagnostic.severity}`
          }
          onClick={() => diagnostic.object_id && onSelect(diagnostic.object_id)}
        >
          <span>{diagnostic.severity}</span>
          <strong>{diagnostic.object_id ?? "project"}</strong>
          <p>{diagnostic.message}</p>
        </button>
      ))}
    </div>
  );
}

function ToolpathSummary({
  result,
  onSelect,
}: {
  result: ToolpathGenerationResponse;
  onSelect: (objectId: string) => void;
}) {
  return (
    <div className="toolpath-summary" aria-label="Generated toolpaths">
      <div>
        <strong>Toolpaths</strong>
        <span>{result.operations.length} operations / {result.paths.length} paths</span>
      </div>
      {result.diagnostics.length > 0 ? (
        <div className="toolpath-diagnostics">
          {result.diagnostics.map((diagnostic, index) => (
            <button
              type="button"
              key={`${diagnostic.message}-${index}`}
              onClick={() => diagnostic.object_id && onSelect(diagnostic.object_id)}
            >
              {diagnostic.severity}: {diagnostic.message}
            </button>
          ))}
        </div>
      ) : null}
      <div className="toolpath-grid">
        {result.operations.slice(0, 6).map((operation) => (
          <button
            type="button"
            key={operation.id}
            onClick={() => operation.feature_id && onSelect(operation.feature_id)}
          >
            <span>{operation.kind}</span>
            <strong>{operation.id}</strong>
            <small>stage {operation.stage}</small>
          </button>
        ))}
      </div>
      <div className="toolpath-paths">
        {result.paths.map((path) => (
          <button type="button" key={path.path.path.id} onClick={() => onSelect(path.feature_id)}>
            <strong>{path.path.path.id}</strong>
            <span>{path.path.path.moves.length} moves</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShaftModel3D({
  project,
  selectedObjectId,
  toolpaths,
  onSelect,
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
  toolpaths: GeneratedToolpath[];
  onSelect: (objectId: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cameraState = useRef({
    theta: -0.7,
    phi: 1.1,
    distance: Math.max(project.stock.length_mm * 1.35, project.stock.diameter_mm * 5),
    target: new THREE.Vector3(project.stock.length_mm / 2, 0, 0),
  });
  const dragState = useRef<{
    pointerId: number;
    x: number;
    y: number;
    mode: "orbit" | "pan";
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    mount.textContent = "";
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0xf7faf4, 1);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.domElement.className = "shaft-3d-canvas";
    renderer.domElement.dataset.renderer = "three-webgl";
    renderer.domElement.dataset.selectedObject = selectedObjectId ?? "";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a756f, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(-40, 50, 70);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9fc5b4, 1.0);
    fillLight.position.set(60, -30, -45);
    scene.add(fillLight);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickables: THREE.Object3D[] = [];

    const stockStart = project.project.datum.s_offset_mm;
    const stockLength = project.stock.length_mm;
    const stockRadius = project.stock.diameter_mm / 2;
    const stockMaterial = new THREE.MeshStandardMaterial({
      color: project.stock.id === selectedObjectId ? 0xf0bf6b : 0xd9a44c,
      transparent: true,
      opacity: project.stock.id === selectedObjectId ? 0.44 : 0.28,
      roughness: 0.72,
      metalness: 0.12,
    });
    const stockMesh = cylinderAlongX(stockLength, stockRadius, 72, stockMaterial);
    stockMesh.position.x = stockStart + stockLength / 2;
    stockMesh.name = project.stock.id;
    stockMesh.userData.featureId = project.stock.id;
    scene.add(stockMesh);
    pickables.push(stockMesh);

    const spans = stackSpans(project);
    for (const span of spans) {
      const radius = Math.max(0.1, radiusForItem(span.item));
      const spurGear = span.item.type === "spur_gear";
      const featureMaterial = new THREE.MeshStandardMaterial({
        color: span.item.id === selectedObjectId ? 0x7ec4a5 : spurGear ? 0x67a893 : 0x8fbeb2,
        roughness: 0.48,
        metalness: 0.34,
      });
      const rootRadius = spurGear
        ? Math.max(radius * 0.72, radius - moduleForStackItem(span.item) * 1.25)
        : radius;
      const featureMesh = cylinderAlongX(span.endS - span.startS, rootRadius, 72, featureMaterial);
      featureMesh.position.x = (span.startS + span.endS) / 2;
      featureMesh.userData.featureId = span.item.id;
      scene.add(featureMesh);
      pickables.push(featureMesh);

      if (spurGear) {
        const toothCount = toothCountForStackItem(span.item);
        const toothDepth = Math.max(0.18, radius - rootRadius);
        const toothWidth = Math.max(0.08, (2 * Math.PI * radius) / toothCount * 0.46);
        const toothGeometry = new THREE.BoxGeometry(span.endS - span.startS, toothWidth, toothDepth);
        for (let index = 0; index < toothCount; index += 1) {
          const angle = (index / toothCount) * Math.PI * 2;
          const tooth = new THREE.Mesh(toothGeometry, featureMaterial);
          tooth.position.set(
            (span.startS + span.endS) / 2,
            Math.cos(angle) * (rootRadius + toothDepth / 2),
            Math.sin(angle) * (rootRadius + toothDepth / 2),
          );
          tooth.rotation.x = -angle;
          tooth.userData.featureId = span.item.id;
          scene.add(tooth);
          pickables.push(tooth);
        }
      }
    }

    for (const interval of project.setup.protected_intervals ?? []) {
      const length = Math.max(0.1, interval.end_s_mm - interval.start_s_mm);
      const protectedMesh = cylinderAlongX(
        length,
        stockRadius * 1.04,
        48,
        new THREE.MeshStandardMaterial({
          color: 0xd97c5e,
          transparent: true,
          opacity: 0.2,
          roughness: 0.6,
        }),
      );
      protectedMesh.position.x = (interval.start_s_mm + interval.end_s_mm) / 2;
      scene.add(protectedMesh);
    }

    const pathMaterial = new THREE.LineBasicMaterial({ color: 0xd04a35 });
    for (const generated of toolpaths) {
      const span = spans.find((candidate) => candidate.item.id === generated.feature_id);
      if (!span) {
        continue;
      }
      const radius = radiusForItem(span.item);
      let previous: THREE.Vector3 | null = null;
      let currentX = span.startS;
      for (const move of generated.path.path.moves) {
        if (typeof move.x_mm === "number") {
          currentX = move.x_mm;
        }
        const depth = typeof move.z_mm === "number" ? Math.abs(move.z_mm) : 0;
        const a = typeof move.a_deg === "number" ? THREE.MathUtils.degToRad(move.a_deg) : 0;
        const point = new THREE.Vector3(
          currentX,
          Math.cos(a) * Math.max(0.1, radius - depth),
          Math.sin(a) * Math.max(0.1, radius - depth),
        );
        if (move.type === "linear_cut" && previous) {
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([previous, point]), pathMaterial));
        }
        previous = point;
      }
    }

    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(stockStart - stockLength * 0.08, 0, 0),
        new THREE.Vector3(stockStart + stockLength * 1.08, 0, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0x46555a }),
    );
    scene.add(axis);

    const updateSize = () => {
      const bounds = mount.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const applyCamera = () => {
      const state = cameraState.current;
      const sinPhi = Math.sin(state.phi);
      camera.position.set(
        state.target.x + Math.cos(state.theta) * sinPhi * state.distance,
        state.target.y + Math.cos(state.phi) * state.distance,
        state.target.z + Math.sin(state.theta) * sinPhi * state.distance,
      );
      camera.lookAt(state.target);
    };
    const render = () => {
      updateSize();
      applyCamera();
      renderer.render(scene, camera);
    };
    render();
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(mount);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.current.distance = Math.min(800, Math.max(8, cameraState.current.distance * (event.deltaY > 0 ? 1.12 : 0.88)));
      render();
    };
    const onPointerDown = (event: PointerEvent) => {
      renderer.domElement.setPointerCapture(event.pointerId);
      dragState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        mode: event.shiftKey || event.button === 1 ? "pan" : "orbit",
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.mode === "pan") {
        const panScale = cameraState.current.distance * 0.0018;
        cameraState.current.target.x -= dx * panScale;
        cameraState.current.target.y += dy * panScale;
      } else {
        cameraState.current.theta -= dx * 0.008;
        cameraState.current.phi = Math.min(Math.PI - 0.08, Math.max(0.12, cameraState.current.phi + dy * 0.008));
      }
      render();
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = dragState.current;
      if (drag?.pointerId === event.pointerId) {
        dragState.current = null;
      }
    };
    const onClick = (event: MouseEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      const hit = hits.find((candidate) => candidate.object.userData.featureId !== project.stock.id) ?? hits[0];
      const featureId = hit?.object.userData.featureId;
      if (typeof featureId === "string") {
        onSelect(featureId);
      }
    };

    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("click", onClick);

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    };
  }, [project, selectedObjectId, toolpaths, onSelect]);

  return (
    <div className="shaft-3d-viewer" role="img" aria-label="3D WebGL shaft model preview">
      <div ref={mountRef} className="shaft-3d-mount" />
    </div>
  );
}

function cylinderAlongX(length: number, radius: number, segments: number, material: THREE.Material) {
  const geometry = new THREE.CylinderGeometry(radius, radius, Math.max(0.1, length), segments, 1, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

function moduleForStackItem(item: StackItem): number {
  const direct = typeof item.module_mm === "number" ? item.module_mm : null;
  const spur = typeof item.spur === "object" && item.spur !== null ? (item.spur as Record<string, unknown>) : null;
  const nested = typeof spur?.module_mm === "number" ? spur.module_mm : null;
  return Math.max(0.05, direct ?? nested ?? Math.max(0.1, radiusForItem(item) * 0.08));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function fileNameFromPathLabel(pathLabel: string): string {
  return pathLabel.split(/[\\/]/).pop() || "project.hobgoblin.json";
}
