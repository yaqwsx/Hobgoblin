use hobgoblin_core::{validate_project, Project, Severity, StackInterval, ValidationReport};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct ProjectLoadResponse {
    source: String,
    validation: ValidationResponse,
}

#[derive(Debug, Serialize)]
struct ValidationResponse {
    diagnostics: Vec<ValidationDiagnostic>,
    intervals: Vec<IntervalResponse>,
}

#[derive(Debug, Serialize)]
struct ValidationDiagnostic {
    severity: String,
    object_id: Option<String>,
    message: String,
}

#[derive(Debug, Serialize)]
struct IntervalResponse {
    item_id: String,
    start_s_mm: f64,
    end_s_mm: f64,
}

#[tauri::command]
fn load_project_from_path(path: String) -> Result<ProjectLoadResponse, String> {
    let source = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read project file '{path}': {error}"))?;
    let validation = validate_project_source(source.clone())?;
    Ok(ProjectLoadResponse { source, validation })
}

#[tauri::command]
fn save_project_to_path(path: String, source: String) -> Result<(), String> {
    parse_project_source(&source)?;
    std::fs::write(&path, source)
        .map_err(|error| format!("failed to write project file '{path}': {error}"))
}

#[tauri::command]
fn validate_project_source(source: String) -> Result<ValidationResponse, String> {
    let project = parse_project_source(&source)?;
    Ok(report_to_response(validate_project(&project)))
}

fn parse_project_source(source: &str) -> Result<Project, String> {
    serde_json::from_str(source).map_err(|error| format!("failed to parse project JSON: {error}"))
}

fn report_to_response(report: ValidationReport) -> ValidationResponse {
    ValidationResponse {
        diagnostics: report
            .diagnostics
            .into_iter()
            .map(|diagnostic| ValidationDiagnostic {
                severity: match diagnostic.severity {
                    Severity::Error => "error".to_string(),
                    Severity::Warning => "warning".to_string(),
                },
                object_id: diagnostic.object_id,
                message: diagnostic.message,
            })
            .collect(),
        intervals: report
            .intervals
            .into_iter()
            .map(interval_to_response)
            .collect(),
    }
}

fn interval_to_response(interval: StackInterval) -> IntervalResponse {
    IntervalResponse {
        item_id: interval.item_id,
        start_s_mm: interval.start_s_mm,
        end_s_mm: interval.end_s_mm,
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_project_from_path,
            save_project_to_path,
            validate_project_source
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Hobgoblin desktop shell");
}
