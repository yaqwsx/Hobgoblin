import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileDown,
  FileUp,
  FolderOpen,
  HardDrive,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  featureTypeLabel,
  parseProjectSource,
  validateProjectInBrowser,
  type HobgoblinProject,
  type StackItem,
} from "./project";
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

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectPath, setProjectPath] = useState(samplePath);
  const [savePath, setSavePath] = useState(samplePath);
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [status, setStatus] = useState("No project loaded");

  const selectedFeature = useMemo(() => {
    if (!loaded || !selectedObjectId) {
      return null;
    }
    return loaded.project.stack.find((item) => item.id === selectedObjectId) ?? null;
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
        <div className="toolbar" aria-label="Project controls">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <FileUp aria-hidden="true" />
            Open
          </button>
          <button type="button" onClick={openFromPath}>
            <FolderOpen aria-hidden="true" />
            Load Path
          </button>
          <button type="button" onClick={loadSampleProject}>
            <FileDown aria-hidden="true" />
            Sample
          </button>
          <button type="button" onClick={saveProject} disabled={!loaded}>
            <Save aria-hidden="true" />
            Save
          </button>
          <button type="button" onClick={revalidate} disabled={!loaded}>
            <CheckCircle2 aria-hidden="true" />
            Validate
          </button>
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
            <ShaftPreview
              project={loaded.project}
              selectedObjectId={selectedObjectId}
              onSelect={setSelectedObjectId}
            />
          ) : (
            <EmptyPanel message="The shaft preview appears here after loading a project." />
          )}
        </section>

        <aside className="inspector" aria-label="Inspector">
          <PanelHeader title="Inspector" subtitle={selectedObjectId ?? "Nothing selected"} />
          {loaded && selectedFeature ? (
            <FeatureInspector feature={selectedFeature} diagnostics={diagnosticsForSelection} />
          ) : loaded ? (
            <ProjectInspector project={loaded.project} selectedObjectId={selectedObjectId} />
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

function EmptyPanel({ message }: { message: string }) {
  return <div className="empty-panel">{message}</div>;
}

function FeatureTree({
  project,
  selectedObjectId,
  diagnostics,
  onSelect,
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
  diagnostics: ValidationDiagnostic[];
  onSelect: (objectId: string) => void;
}) {
  return (
    <div className="tree-list">
      <button
        type="button"
        className={selectedObjectId === project.stock.id ? "tree-item selected" : "tree-item"}
        onClick={() => onSelect(project.stock.id)}
      >
        <span className="tree-title">{project.stock.id}</span>
        <span>{project.stock.material_id}</span>
      </button>
      {project.stack.map((item) => {
        const hasDiagnostics = diagnostics.some((diagnostic) => diagnostic.object_id === item.id);
        return (
          <button
            type="button"
            key={item.id}
            className={selectedObjectId === item.id ? "tree-item selected" : "tree-item"}
            onClick={() => onSelect(item.id)}
          >
            <span className="tree-title">
              {hasDiagnostics ? <AlertTriangle aria-hidden="true" /> : null}
              {item.name}
            </span>
            <span>{featureTypeLabel(item.type)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ShaftPreview({
  project,
  selectedObjectId,
  onSelect,
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
  onSelect: (objectId: string) => void;
}) {
  const totalLength = project.stock.length_mm;
  return (
    <div className="shaft-preview">
      <div className="shaft-axis">
        {project.stack.map((item) => {
          const width = `${Math.max(4, (item.length_mm / totalLength) * 100)}%`;
          return (
            <button
              type="button"
              key={item.id}
              style={{ width }}
              className={selectedObjectId === item.id ? "shaft-segment selected" : "shaft-segment"}
              onClick={() => onSelect(item.id)}
              title={`${item.name}: ${item.length_mm} mm`}
            >
              <span>{item.name}</span>
            </button>
          );
        })}
      </div>
      <div className="planning-strip">
        {(project.planning_regions ?? []).map((region) => (
          <button
            type="button"
            key={region.id}
            className="planning-region"
            onClick={() => onSelect(region.id)}
          >
            {region.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeatureInspector({
  feature,
  diagnostics,
}: {
  feature: StackItem;
  diagnostics: ValidationDiagnostic[];
}) {
  return (
    <div className="inspector-content">
      <dl>
        <dt>Type</dt>
        <dd>{featureTypeLabel(feature.type)}</dd>
        <dt>Length</dt>
        <dd>{feature.length_mm.toFixed(3)} mm</dd>
        <dt>ID</dt>
        <dd>{feature.id}</dd>
      </dl>
      <pre>{JSON.stringify(feature, null, 2)}</pre>
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

function ProjectInspector({
  project,
  selectedObjectId,
}: {
  project: HobgoblinProject;
  selectedObjectId: string | null;
}) {
  const selectedRegion = (project.planning_regions ?? []).find(
    (region) => region.id === selectedObjectId,
  );
  return (
    <div className="inspector-content">
      {selectedRegion ? (
        <dl>
          <dt>Region</dt>
          <dd>{selectedRegion.name}</dd>
          <dt>Stage</dt>
          <dd>{selectedRegion.stage}</dd>
          <dt>Purpose</dt>
          <dd>{selectedRegion.purpose}</dd>
        </dl>
      ) : (
        <dl>
          <dt>Project</dt>
          <dd>{project.project.id}</dd>
          <dt>Machine</dt>
          <dd>{project.setup.machine_profile_id}</dd>
          <dt>Stock</dt>
          <dd>{project.stock.id}</dd>
        </dl>
      )}
    </div>
  );
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
