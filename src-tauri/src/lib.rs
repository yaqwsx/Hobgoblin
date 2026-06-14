use hobgoblin_core::{
    validate_project, Project, Severity, SpurGear, StackInterval, StackItemKind, ValidationReport,
};
use hobgoblin_planner::{
    build_initial_operation_graph, generate_spur_shaping_path, OperationGraph, SpurShapingConfig,
    SpurShapingPath,
};
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

#[derive(Debug, Serialize)]
struct ToolpathGenerationResponse {
    diagnostics: Vec<ValidationDiagnostic>,
    operations: Vec<OperationSummaryResponse>,
    paths: Vec<ToolpathResponse>,
}

#[derive(Debug, Serialize)]
struct OperationSummaryResponse {
    id: String,
    feature_id: Option<String>,
    region_id: Option<String>,
    kind: String,
    stage: u32,
}

#[derive(Debug, Serialize)]
struct ToolpathResponse {
    feature_id: String,
    path: SpurShapingPath,
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

#[tauri::command]
fn generate_toolpaths_from_source(source: String) -> Result<ToolpathGenerationResponse, String> {
    let project = parse_project_source(&source)?;
    let validation = validate_project(&project);
    if validation
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error)
    {
        return Ok(ToolpathGenerationResponse {
            diagnostics: report_to_response(validation).diagnostics,
            operations: Vec::new(),
            paths: Vec::new(),
        });
    }

    let graph = build_initial_operation_graph(&project);
    let operations = operation_summaries(&graph);
    let mut paths = Vec::new();
    if let Some((feature_id, face_start_s_mm, face_width_mm, gear)) =
        first_spur_gear_feature(&project)
    {
        let generated = generate_spur_shaping_path(
            format!("op.feature.{feature_id}.generated_shaping"),
            &feature_id,
            &gear,
            face_start_s_mm,
            face_width_mm,
            &SpurShapingConfig {
                depth_layers: vec![0.25, 0.5, 0.75, 1.0],
                ..SpurShapingConfig::default()
            },
        )
        .map_err(|error| error.to_string())?;
        paths.push(ToolpathResponse {
            feature_id,
            path: generated,
        });
    }

    Ok(ToolpathGenerationResponse {
        diagnostics: Vec::new(),
        operations,
        paths,
    })
}

fn parse_project_source(source: &str) -> Result<Project, String> {
    serde_json::from_str(source).map_err(|error| format!("failed to parse project JSON: {error}"))
}

fn operation_summaries(graph: &OperationGraph) -> Vec<OperationSummaryResponse> {
    graph
        .nodes
        .iter()
        .map(|node| OperationSummaryResponse {
            id: node.id.clone(),
            feature_id: node.feature_id.clone(),
            region_id: node.region_id.clone(),
            kind: format!("{:?}", node.kind),
            stage: node.stage,
        })
        .collect()
}

fn first_spur_gear_feature(project: &Project) -> Option<(String, f64, f64, SpurGear)> {
    let mut start_s_mm = project.project.datum.s_offset_mm;
    for item in &project.stack {
        let face_start_s_mm = start_s_mm;
        start_s_mm += item.length_mm;
        if let StackItemKind::SpurGear {
            module_mm,
            tooth_count,
            pressure_angle_deg,
            profile_shift,
            addendum_coeff,
            dedendum_coeff,
            backlash_mm,
            phase_deg,
            machining,
        } = &item.kind
        {
            return Some((
                item.id.clone(),
                face_start_s_mm,
                item.length_mm,
                SpurGear {
                    module_mm: *module_mm,
                    tooth_count: *tooth_count,
                    pressure_angle_deg: *pressure_angle_deg,
                    profile_shift: *profile_shift,
                    addendum_coeff: *addendum_coeff,
                    dedendum_coeff: *dedendum_coeff,
                    backlash_mm: *backlash_mm,
                    phase_deg: *phase_deg,
                    machining: machining.clone(),
                },
            ));
        }
    }
    None
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_project_from_path,
            save_project_to_path,
            validate_project_source,
            generate_toolpaths_from_source
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Hobgoblin desktop shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_toolpaths_from_sample_project_source() {
        let source = include_str!("../../examples/projects/simple_spur_stack.hobgoblin.json");
        let result = generate_toolpaths_from_source(source.to_string())
            .expect("sample toolpath generation succeeds");

        assert!(
            result.diagnostics.is_empty(),
            "sample should generate without diagnostics"
        );
        assert!(result
            .operations
            .iter()
            .any(|operation| operation.id == "op.feature.feature.spur_20t.left_flank"));
        assert_eq!(result.paths.len(), 1);
        let generated = &result.paths[0];
        assert_eq!(generated.feature_id, "feature.spur_20t");
        assert!(generated.path.path.moves.len() > 100);
        assert!(
            generated
                .path
                .path
                .moves
                .iter()
                .any(|movement| matches!(movement, hobgoblin_post::AbstractMove::LinearCut { .. })),
            "generated path should contain cutting moves"
        );
    }
}
