import {
  AlertTriangle,
  Box,
  CheckCircle2,
  CirclePlus,
  Cog,
  Crosshair,
  Database,
  FileDown,
  FileUp,
  FolderOpen,
  HardDrive,
  Layers,
  ListTree,
  MousePointer2,
  MoveDown,
  MoveUp,
  Save,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  isTauriRuntime,
  loadProjectFromPath,
  saveProjectToPath,
  validateProjectSource,
  type ValidationDiagnostic,
  type ValidationResponse,
} from "./tauri";

interface LoadedProject {
  source: string;
  project: HobgoblinProject;
  validation: ValidationResponse;
  pathLabel: string;
}

const samplePath = "examples/projects/simple_spur_stack.hobgoblin.json";
type EditorMode = "select" | "measure";
type MeasurementAnchor = {
  id: string;
  label: string;
  point: PointSr;
};
type MoveDirection = "up" | "down";

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectPath, setProjectPath] = useState(samplePath);
  const [savePath, setSavePath] = useState(samplePath);
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [status, setStatus] = useState("No project loaded");
  const [editorMode, setEditorMode] = useState<EditorMode>("select");
  const [measurementAnchors, setMeasurementAnchors] = useState<MeasurementAnchor[]>([]);

  const selectedFeature = useMemo(() => {
    if (!loaded || !selectedObjectId) {
      return null;
    }
    return loaded.project.stack.find((item) => item.id === selectedObjectId) ?? null;
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sample") === "1") {
      void loadSampleProject();
    }
  }, []);

  async function openFromPath() {
    if (!isTauriRuntime()) {
      setStatus("Path loading is available in the desktop runtime");
      return;
    }
    try {
      const response = await loadProjectFromPath(projectPath);
      applyLoadedSource(response.source, response.validation, projectPath);
      setSavePath(projectPath);
      setStatus(`Loaded ${projectPath}`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function loadSampleProject() {
    if (isTauriRuntime()) {
      try {
        const response = await loadProjectFromPath(samplePath);
        applyLoadedSource(response.source, response.validation, samplePath);
        setProjectPath(samplePath);
        setSavePath(samplePath);
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
      applyLoadedSource(source, validation, samplePath);
      setProjectPath(samplePath);
      setSavePath(samplePath);
      setStatus(`Loaded ${samplePath}`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function openFromFile(file: File) {
    try {
      const source = await file.text();
      const validation = await validateSource(source);
      applyLoadedSource(source, validation, file.name);
      setStatus(`Loaded ${file.name}`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function saveProject() {
    if (!loaded) {
      setStatus("No project is loaded");
      return;
    }
    if (isTauriRuntime()) {
      try {
        await saveProjectToPath(savePath, loaded.source);
        setStatus(`Saved ${savePath}`);
      } catch (error) {
        setStatus(errorMessage(error));
      }
      return;
    }

    const blob = new Blob([loaded.source], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = savePath.split(/[\\/]/).pop() || "project.hobgoblin.json";
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

  async function validateSource(source: string) {
    if (isTauriRuntime()) {
      return validateProjectSource(source);
    }
    return validateProjectInBrowser(source);
  }

  function applyLoadedSource(source: string, validation: ValidationResponse, pathLabel: string) {
    const parsed = parseProjectSource(source);
    setLoaded({
      source,
      project: parsed.project,
      validation,
      pathLabel,
    });
    setSelectedObjectId(parsed.project.stack[0]?.id ?? parsed.project.stock.id);
    setMeasurementAnchors([]);
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
      : validateProjectInBrowser(source);
    setLoaded((current) =>
      current
        ? {
            ...current,
            source,
            project,
            validation,
          }
        : current,
    );
    setStatus(statusMessage);
    if (isDesktopRuntime) {
      void validateProjectSource(source)
        .then((nextValidation) => {
          setLoaded((current) =>
            current?.source === source ? { ...current, validation: nextValidation } : current,
          );
          setStatus(`${statusMessage}; validation refreshed`);
        })
        .catch((error) => {
          setStatus(errorMessage(error));
        });
    }
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
            <CommandButton icon={<FileUp aria-hidden="true" />} label="Open" onClick={() => fileInputRef.current?.click()} />
            <CommandButton icon={<FolderOpen aria-hidden="true" />} label="Path" onClick={openFromPath} />
            <CommandButton icon={<FileDown aria-hidden="true" />} label="Sample" onClick={loadSampleProject} />
            <CommandButton icon={<Save aria-hidden="true" />} label="Save" onClick={saveProject} disabled={!loaded} />
          </CommandGroup>
          <CommandGroup label="Create">
            <CommandButton icon={<Box aria-hidden="true" />} label="Cylinder" onClick={() => addStackItem("cylindrical_section")} disabled={!loaded} />
            <CommandButton icon={<Cog aria-hidden="true" />} label="Spur" onClick={() => addStackItem("spur_gear")} disabled={!loaded} />
            <CommandButton icon={<Cog aria-hidden="true" />} label="Helical" onClick={() => addStackItem("helical_gear")} disabled={!loaded} />
            <CommandButton icon={<Layers aria-hidden="true" />} label="Herringbone" onClick={() => addStackItem("herringbone_gear")} disabled={!loaded} />
            <CommandButton icon={<CirclePlus aria-hidden="true" />} label="Eccentric" onClick={() => addStackItem("eccentric_section")} disabled={!loaded} />
            <CommandButton icon={<Layers aria-hidden="true" />} label="Region" onClick={addPlanningRegion} disabled={!loaded} />
            <CommandButton icon={<ListTree aria-hidden="true" />} label="Protect" onClick={addProtectedInterval} disabled={!loaded} />
          </CommandGroup>
          <CommandGroup label="Inspect">
            <CommandButton icon={<CheckCircle2 aria-hidden="true" />} label="Validate" onClick={revalidate} disabled={!loaded} />
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

      <section className="pathbar" aria-label="Project file paths">
        <label>
          <span>Load path</span>
          <input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
        </label>
        <label>
          <span>Save path</span>
          <input value={savePath} onChange={(event) => setSavePath(event.target.value)} />
        </label>
        <div className="runtime-pill">
          <Database aria-hidden="true" />
          {isTauriRuntime() ? "Rust kernel connected" : "Browser preview"}
        </div>
      </section>

      <section className="workspace">
        <aside className="feature-tree" aria-label="Feature tree">
          <PanelHeader title="Features" subtitle={loaded?.pathLabel ?? "No file"} />
          {loaded ? (
            <FeatureTree
              project={loaded.project}
              selectedObjectId={selectedObjectId}
              diagnostics={loaded.validation.diagnostics}
              onSelect={setSelectedObjectId}
              onMoveStackItem={moveStackItem}
            />
          ) : (
            <EmptyPanel message="Open a project file to inspect the shaft stack." />
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
            <PlanningEditor
              project={loaded.project}
              selectedObjectId={selectedObjectId}
              editorMode={editorMode}
              measurementAnchors={measurementAnchors}
              onSelect={setSelectedObjectId}
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
          ) : (
            <EmptyPanel message="The shaft preview appears here after loading a project." />
          )}
        </section>

        <aside className="inspector" aria-label="Inspector">
          <PanelHeader title="Inspector" subtitle={selectedObjectId ?? "Nothing selected"} />
          {loaded && selectedFeature ? (
            <FeatureInspector
              feature={selectedFeature}
              diagnostics={diagnosticsForSelection}
              onUpdate={(patch) => updateFeature(selectedFeature.id, patch)}
            />
          ) : loaded && selectedRegion ? (
            <RegionInspector
              region={selectedRegion}
              onUpdate={(patch) => updatePlanningRegion(selectedRegion.id, (region) => ({ ...region, ...patch }))}
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
            />
          ) : loaded && selectedObjectId === loaded.project.stock.id ? (
            <StockInspector stock={loaded.project.stock} onUpdate={updateStock} />
          ) : loaded && selectedObjectId === loaded.project.setup.id ? (
            <SetupInspector setup={loaded.project.setup} onUpdate={updateSetup} />
          ) : loaded ? (
            <ProjectInspector project={loaded.project} onUpdate={updateProjectMetadata} />
          ) : (
            <EmptyPanel message="Select a feature or diagnostic to inspect its data." />
          )}
        </aside>
      </section>

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
          onSelect={setSelectedObjectId}
        />
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
    <div className="command-group">
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
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title ?? label} aria-label={label}>
      {icon}
      <span>{label}</span>
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
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
  diagnostics: ValidationDiagnostic[];
  onSelect: (objectId: string) => void;
  onMoveStackItem: (itemId: string, direction: MoveDirection) => void;
}) {
  const protectedIntervals = project.setup.protected_intervals ?? [];
  const planningRegions = project.planning_regions ?? [];
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
            <Wrench aria-hidden="true" />
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
            <Box aria-hidden="true" />
            {project.stock.id}
          </span>
          <span>{project.stock.diameter_mm.toFixed(2)} x {project.stock.length_mm.toFixed(2)} mm</span>
      </button>
      </div>
      <div className="tree-section">
        <span>Gear stack</span>
      {project.stack.map((item, index) => {
        const hasDiagnostics = diagnostics.some((diagnostic) => diagnostic.object_id === item.id);
        return (
          <div
            key={item.id}
            className={selectedObjectId === item.id ? "tree-item tree-item-with-actions selected" : "tree-item tree-item-with-actions"}
          >
            <button type="button" className="tree-item-main" onClick={() => onSelect(item.id)}>
              <span className="tree-title">
                {hasDiagnostics ? <AlertTriangle aria-hidden="true" /> : <Cog aria-hidden="true" />}
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
            </div>
          </div>
        );
      })}
      </div>
      <div className="tree-section">
        <span>Planning regions</span>
        {planningRegions.map((region) => (
          <button
            type="button"
            key={region.id}
            className={selectedObjectId === region.id ? "tree-item selected" : "tree-item"}
            onClick={() => onSelect(region.id)}
          >
            <span className="tree-title">
              <Layers aria-hidden="true" />
              {region.name}
            </span>
            <span>{region.purpose} / stage {region.stage}</span>
          </button>
        ))}
      </div>
      <div className="tree-section">
        <span>Protected intervals</span>
        {protectedIntervals.map((interval) => (
          <button
            type="button"
            key={interval.id}
            className={selectedObjectId === interval.id ? "tree-item selected" : "tree-item"}
            onClick={() => onSelect(interval.id)}
          >
            <span className="tree-title">
              <ListTree aria-hidden="true" />
              {interval.id}
            </span>
            <span>{interval.purpose} / {interval.start_s_mm.toFixed(2)}-{interval.end_s_mm.toFixed(2)} mm</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanningEditor({
  project,
  selectedObjectId,
  editorMode,
  measurementAnchors,
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
  onSelect: (objectId: string) => void;
  onMeasureAnchor: (anchor: MeasurementAnchor) => void;
  onResetMeasurement: () => void;
  onMoveRegionVertex: (regionId: string, vertexIndex: number, point: PointSr) => void;
  onAddRegionVertex: (regionId: string, edgeIndex: number, point: PointSr) => void;
  onDeleteRegionVertex: (regionId: string, vertexIndex: number) => void;
  onResizeAxisAlignedRegion: (regionId: string, bounds: RegionBounds) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
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
  const minS = Math.min(
    stockStartS,
    ...spans.map((span) => span.startS),
    ...protectedIntervals.map((interval) => interval.start_s_mm),
    ...planningRegions.flatMap((region) => region.polygon.map((point) => point.s_mm)),
  );
  const maxS = Math.max(
    stockEndS,
    ...spans.map((span) => span.endS),
    ...protectedIntervals.map((interval) => interval.end_s_mm),
    ...planningRegions.flatMap((region) => region.polygon.map((point) => point.s_mm)),
  );
  const sRange = Math.max(1, maxS - minS);
  const maxR = Math.max(1, maxProfileRadius);
  const viewWidth = 1000;
  const viewHeight = 420;
  const padding = { left: 56, right: 24, top: 24, bottom: 50 };
  const plotWidth = viewWidth - padding.left - padding.right;
  const plotHeight = viewHeight - padding.top - padding.bottom;

  const xForS = (sMm: number) => padding.left + ((sMm - minS) / sRange) * plotWidth;
  const yForR = (rMm: number) => padding.top + (1 - rMm / maxR) * plotHeight;
  const sForX = (x: number) => minS + ((x - padding.left) / plotWidth) * sRange;
  const rForY = (y: number) => (1 - (y - padding.top) / plotHeight) * maxR;
  const clampPoint = (point: PointSr): PointSr => ({
    s_mm: Math.min(maxS, Math.max(minS, point.s_mm)),
    r_mm: Math.min(maxR, Math.max(0, point.r_mm)),
  });

  function eventPoint(event: React.PointerEvent<SVGElement>): PointSr {
    const svg = svgRef.current;
    if (!svg) {
      return { s_mm: minS, r_mm: 0 };
    }
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * viewWidth;
    const y = ((event.clientY - rect.top) / rect.height) * viewHeight;
    return clampPoint({ s_mm: sForX(x), r_mm: rForY(y) });
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

  return (
    <div className="planning-editor">
      <div className="editor-toolbar">
        <span>{editorMode === "measure" ? "Measure anchors" : "Edit geometry"}</span>
        <button type="button" onClick={onResetMeasurement} disabled={measurementAnchors.length === 0}>
          <Crosshair aria-hidden="true" />
          Clear
        </button>
      </div>
      <svg
        ref={svgRef}
        className="planning-svg"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label="2D shaft and planning editor"
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5ebe4" strokeWidth="1" />
          </pattern>
        </defs>
        <rect
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          fill="url(#grid)"
          stroke="#d2dbd4"
        />
        <line x1={padding.left} y1={yForR(0)} x2={padding.left + plotWidth} y2={yForR(0)} className="axis-line" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotHeight} className="axis-line" />
        <text x={padding.left} y={viewHeight - 12} className="axis-label">s / mm</text>
        <text x={12} y={padding.top + 14} className="axis-label">r / mm</text>

        <rect
          x={xForS(stockStartS)}
          y={yForR(project.stock.diameter_mm / 2)}
          width={xForS(stockEndS) - xForS(stockStartS)}
          height={yForR(0) - yForR(project.stock.diameter_mm / 2)}
          className="stock-rect"
          onClick={() => onSelect(project.stock.id)}
        />

        {protectedIntervals.map((interval) => {
          const visibleStartS = Math.max(minS, interval.start_s_mm);
          const visibleEndS = Math.min(maxS, interval.end_s_mm);
          if (visibleEndS <= visibleStartS) {
            return null;
          }
          return (
            <g key={interval.id} onClick={() => onSelect(interval.id)}>
              <rect
                x={xForS(visibleStartS)}
                y={padding.top}
                width={xForS(visibleEndS) - xForS(visibleStartS)}
                height={plotHeight}
                className={selectedObjectId === interval.id ? "protected selected" : "protected"}
              />
              <text x={xForS(visibleStartS) + 4} y={padding.top + 16} className="protected-label">
                {interval.purpose}
              </text>
            </g>
          );
        })}

        {spans.map((span) => {
          const radius = radiusForItem(span.item);
          return (
            <g key={span.item.id}>
              <rect
                x={xForS(span.startS)}
                y={yForR(radius)}
                width={xForS(span.endS) - xForS(span.startS)}
                height={yForR(0) - yForR(radius)}
                className={selectedObjectId === span.item.id ? "profile selected" : "profile"}
                onClick={() => onSelect(span.item.id)}
              />
              <text x={(xForS(span.startS) + xForS(span.endS)) / 2} y={yForR(radius) - 7} className="feature-label">
                {span.item.name}
              </text>
              {[
                { id: `${span.item.id}:start`, label: `${span.item.name} start`, point: { s_mm: span.startS, r_mm: radius } },
                { id: `${span.item.id}:end`, label: `${span.item.name} end`, point: { s_mm: span.endS, r_mm: radius } },
              ].map((anchor) => (
                <circle
                  key={anchor.id}
                  cx={xForS(anchor.point.s_mm)}
                  cy={yForR(anchor.point.r_mm)}
                  r="5"
                  className="measure-anchor"
                  onClick={() => onMeasureAnchor(anchor)}
                />
              ))}
            </g>
          );
        })}

        {planningRegions.map((region) => {
          const bounds = regionBounds(region);
          const points = region.polygon.map((point) => `${xForS(point.s_mm)},${yForR(point.r_mm)}`).join(" ");
          return (
            <g key={region.id} className="planning-region-layer">
              <polygon
                points={points}
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
                  onSelect={onSelect}
                  onMove={onMoveRegionVertex}
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
                  <circle
                    key={`${region.id}-edge-${edgeIndex}`}
                    cx={xForS(midpoint.s_mm)}
                    cy={yForR(midpoint.r_mm)}
                    r="5"
                    className="edge-add-handle"
                    onClick={() => {
                      onSelect(region.id);
                      onAddRegionVertex(region.id, edgeIndex, midpoint);
                    }}
                  />
                );
              })}
            </g>
          );
        })}

        {measurement ? (
          <g className="measurement-overlay">
            <line
              x1={xForS(measurement.a.point.s_mm)}
              y1={yForR(measurement.a.point.r_mm)}
              x2={xForS(measurement.b.point.s_mm)}
              y2={yForR(measurement.b.point.r_mm)}
            />
            <text
              x={(xForS(measurement.a.point.s_mm) + xForS(measurement.b.point.s_mm)) / 2}
              y={(yForR(measurement.a.point.r_mm) + yForR(measurement.b.point.r_mm)) / 2 - 10}
            >
              d {formatMm(measurement.distance)} / ds {formatMm(measurement.ds)} / dr {formatMm(measurement.dr)}
            </text>
          </g>
        ) : null}
      </svg>
      <div className="measurement-readout">
        {measurementAnchors.length === 0
          ? "No measurement anchors selected"
          : measurementAnchors.map((anchor) => `${anchor.label}: s ${formatMm(anchor.point.s_mm)}, r ${formatMm(anchor.point.r_mm)}`).join(" | ")}
      </div>
    </div>
  );
}

function RegionVertexHandle({
  region,
  vertexIndex,
  point,
  xForS,
  yForR,
  eventPoint,
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
  eventPoint: (event: React.PointerEvent<SVGElement>) => PointSr;
  onSelect: (objectId: string) => void;
  onMove: (regionId: string, vertexIndex: number, point: PointSr) => void;
  onDelete: (regionId: string, vertexIndex: number) => void;
  onMeasureAnchor: (anchor: MeasurementAnchor) => void;
}) {
  return (
    <circle
      cx={xForS(point.s_mm)}
      cy={yForR(point.r_mm)}
      r="7"
      className="vertex-handle"
      onClick={() => {
        onSelect(region.id);
        onMeasureAnchor({
          id: `${region.id}:v${vertexIndex}`,
          label: `${region.name} v${vertexIndex + 1}`,
          point,
        });
      }}
      onDoubleClick={() => onDelete(region.id, vertexIndex)}
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
  onSelect,
  onResize,
}: {
  region: PlanningRegion;
  bounds: RegionBounds;
  xForS: (sMm: number) => number;
  yForR: (rMm: number) => number;
  eventPoint: (event: React.PointerEvent<SVGElement>) => PointSr;
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
        <rect
          key={`${region.id}-${handle.id}`}
          x={handle.x - 6}
          y={handle.y - 6}
          width="12"
          height="12"
          rx="2"
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

function FeatureInspector({
  feature,
  diagnostics,
  onUpdate,
}: {
  feature: StackItem;
  diagnostics: ValidationDiagnostic[];
  onUpdate: (patch: Partial<StackItem>) => void;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Feature">
        <ReadonlyField label="Type" value={featureTypeLabel(feature.type)} />
        <ReadonlyField label="ID" value={feature.id} />
        <TextField label="Name" value={feature.name} onChange={(name) => onUpdate({ name })} />
        <NumberField label="Length mm" value={feature.length_mm} onChange={(length_mm) => onUpdate({ length_mm })} />
      </FieldGroup>
      <FeatureTypeFields feature={feature} onUpdate={onUpdate} />
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

function FeatureTypeFields({
  feature,
  onUpdate,
}: {
  feature: StackItem;
  onUpdate: (patch: Partial<StackItem>) => void;
}) {
  if (feature.type === "cylindrical_section") {
    return (
      <FieldGroup title="Cylinder">
        <NumberField label="Radius mm" value={numberValue(feature.radius_mm)} onChange={(radius_mm) => onUpdate({ radius_mm })} />
      </FieldGroup>
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
    return <SpurGearFields gear={feature} onUpdate={(patch) => onUpdate(patch)} title="Spur gear" />;
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
          onUpdate={(patch) => onUpdate({ spur: { ...spur, ...patch } })}
        />
      </>
    );
  }
  if (feature.type === "herringbone_gear") {
    return (
      <FieldGroup title="Herringbone">
        <NumberField label="Center relief mm" value={numberValue(feature.center_relief_width_mm)} onChange={(center_relief_width_mm) => onUpdate({ center_relief_width_mm })} />
        <ReadonlyField label="Left/right gears" value="Edit nested geometry in a later detailed inspector" />
      </FieldGroup>
    );
  }
  return <ReadonlyField label="Geometry" value="Unsupported feature form" />;
}

function SpurGearFields({
  title,
  gear,
  onUpdate,
}: {
  title: string;
  gear: Record<string, unknown>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
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
      <ReadonlyField label="Outside radius" value={formatMm(radiusForItem(gear as StackItem))} />
    </FieldGroup>
  );
}

function RegionInspector({
  region,
  onUpdate,
  onUpdateBounds,
  onDeleteVertex,
}: {
  region: PlanningRegion;
  onUpdate: (patch: Partial<PlanningRegion>) => void;
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
            <button type="button" onClick={() => onDeleteVertex(index)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProtectedIntervalInspector({
  interval,
  onUpdate,
}: {
  interval: NonNullable<HobgoblinProject["setup"]["protected_intervals"]>[number];
  onUpdate: (patch: { start_s_mm?: number; end_s_mm?: number; purpose?: string }) => void;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Protected interval">
        <ReadonlyField label="ID" value={interval.id} />
        <TextField label="Purpose" value={interval.purpose} onChange={(purpose) => onUpdate({ purpose })} />
        <NumberField label="Start s mm" value={interval.start_s_mm} onChange={(start_s_mm) => onUpdate({ start_s_mm })} />
        <NumberField label="End s mm" value={interval.end_s_mm} onChange={(end_s_mm) => onUpdate({ end_s_mm })} />
      </FieldGroup>
    </div>
  );
}

function StockInspector({
  stock,
  onUpdate,
}: {
  stock: HobgoblinProject["stock"];
  onUpdate: (patch: Partial<HobgoblinProject["stock"]>) => void;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Stock">
        <ReadonlyField label="ID" value={stock.id} />
        <NumberField label="Diameter mm" value={stock.diameter_mm} onChange={(diameter_mm) => onUpdate({ diameter_mm })} />
        <NumberField label="Length mm" value={stock.length_mm} onChange={(length_mm) => onUpdate({ length_mm })} />
        <TextField label="Material" value={stock.material_id} onChange={(material_id) => onUpdate({ material_id })} />
      </FieldGroup>
    </div>
  );
}

function SetupInspector({
  setup,
  onUpdate,
}: {
  setup: HobgoblinProject["setup"];
  onUpdate: (patch: Partial<HobgoblinProject["setup"]>) => void;
}) {
  return (
    <div className="inspector-content">
      <FieldGroup title="Setup">
        <ReadonlyField label="ID" value={setup.id} />
        <TextField label="Name" value={setup.name} onChange={(name) => onUpdate({ name })} />
        <TextField label="Machine" value={setup.machine_profile_id} onChange={(machine_profile_id) => onUpdate({ machine_profile_id })} />
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

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
