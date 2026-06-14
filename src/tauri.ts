import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type Severity = "error" | "warning";

export interface ValidationDiagnostic {
  severity: Severity;
  object_id: string | null;
  message: string;
}

export interface StackInterval {
  item_id: string;
  start_s_mm: number;
  end_s_mm: number;
}

export interface ValidationResponse {
  diagnostics: ValidationDiagnostic[];
  intervals: StackInterval[];
}

export interface ProjectLoadResponse {
  source: string;
  validation: ValidationResponse;
}

export interface AbstractMove {
  type: "rapid" | "linear_cut" | "spindle";
  x_mm?: number | null;
  y_mm?: number | null;
  z_mm?: number | null;
  a_deg?: number | null;
  feed_mm_min?: number;
  rpm?: number;
  clockwise?: boolean;
}

export interface AbstractPath {
  id: string;
  operation_id: string;
  moves: AbstractMove[];
}

export interface GeneratedToolpath {
  feature_id: string;
  path: {
    path: AbstractPath;
    debug_steps: unknown[];
    adaptive_rack_stepping?: unknown;
  };
}

export interface OperationSummary {
  id: string;
  feature_id: string | null;
  region_id: string | null;
  kind: string;
  stage: number;
}

export interface ToolpathGenerationResponse {
  diagnostics: ValidationDiagnostic[];
  operations: OperationSummary[];
  paths: GeneratedToolpath[];
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function validateProjectSource(source: string): Promise<ValidationResponse> {
  return invoke<ValidationResponse>("validate_project_source", { source });
}

export async function generateToolpathsFromSource(source: string): Promise<ToolpathGenerationResponse> {
  return invoke<ToolpathGenerationResponse>("generate_toolpaths_from_source", { source });
}

export async function loadProjectFromPath(path: string): Promise<ProjectLoadResponse> {
  return invoke<ProjectLoadResponse>("load_project_from_path", { path });
}

export async function saveProjectToPath(path: string, source: string): Promise<void> {
  return invoke<void>("save_project_to_path", { path, source });
}

export async function pickProjectOpenPath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Hobgoblin project", extensions: ["json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickProjectSavePath(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [{ name: "Hobgoblin project", extensions: ["json"] }],
  });
  return typeof selected === "string" ? selected : null;
}
