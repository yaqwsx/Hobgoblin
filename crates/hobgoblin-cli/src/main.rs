use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use hobgoblin_core::{
    validate_project, validate_project_with_libraries, LibrarySet, MachineProfile, Material,
    Project, Severity, ToolLibrary,
};
use hobgoblin_planner::build_initial_operation_graph;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "hobgoblin")]
#[command(about = "Single-purpose CAM for geared shafts")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Validate {
        project: PathBuf,
        #[command(flatten)]
        libraries: LibraryArgs,
    },
    Plan {
        project: PathBuf,
        #[command(flatten)]
        libraries: LibraryArgs,
    },
}

#[derive(Debug, Clone, Default, Parser)]
struct LibraryArgs {
    #[arg(long = "machine")]
    machine_profiles: Vec<PathBuf>,
    #[arg(long = "tools")]
    tool_libraries: Vec<PathBuf>,
    #[arg(long = "material")]
    materials: Vec<PathBuf>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Validate { project, libraries } => validate(project, libraries),
        Command::Plan { project, libraries } => plan(project, libraries),
    }
}

fn read_project(path: PathBuf) -> Result<Project> {
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read project file '{}'", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("failed to parse project file '{}'", path.display()))
}

fn read_json_file<T: serde::de::DeserializeOwned>(path: &PathBuf, label: &str) -> Result<T> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read {label} file '{}'", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("failed to parse {label} file '{}'", path.display()))
}

fn read_libraries(args: &LibraryArgs) -> Result<Option<LibrarySet>> {
    if args.machine_profiles.is_empty()
        && args.tool_libraries.is_empty()
        && args.materials.is_empty()
    {
        return Ok(None);
    }

    let machine_profiles = args
        .machine_profiles
        .iter()
        .map(|path| read_json_file::<MachineProfile>(path, "machine profile"))
        .collect::<Result<Vec<_>>>()?;
    let tool_libraries = args
        .tool_libraries
        .iter()
        .map(|path| read_json_file::<ToolLibrary>(path, "tool library"))
        .collect::<Result<Vec<_>>>()?;
    let materials = args
        .materials
        .iter()
        .map(|path| read_json_file::<Material>(path, "material"))
        .collect::<Result<Vec<_>>>()?;

    Ok(Some(LibrarySet::from_parts(
        machine_profiles,
        tool_libraries,
        materials,
    )))
}

fn validate(path: PathBuf, libraries: LibraryArgs) -> Result<()> {
    let project = read_project(path)?;
    let libraries = read_libraries(&libraries)?;
    let report = match &libraries {
        Some(libraries) => validate_project_with_libraries(&project, libraries),
        None => validate_project(&project),
    };

    println!("stack intervals:");
    for interval in &report.intervals {
        println!(
            "  {}: {:.3} mm -> {:.3} mm",
            interval.item_id, interval.start_s_mm, interval.end_s_mm
        );
    }

    print_diagnostics(&report);

    if report.has_errors() {
        anyhow::bail!("validation failed");
    }

    Ok(())
}

fn print_diagnostics(report: &hobgoblin_core::ValidationReport) {
    if report.diagnostics.is_empty() {
        println!("validation passed with no diagnostics");
    } else {
        println!("diagnostics:");
        for diagnostic in &report.diagnostics {
            let severity = match diagnostic.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            };
            match &diagnostic.object_id {
                Some(object_id) => println!("  {severity} [{object_id}]: {}", diagnostic.message),
                None => println!("  {severity}: {}", diagnostic.message),
            }
        }
    }
}

fn plan(path: PathBuf, libraries: LibraryArgs) -> Result<()> {
    let project = read_project(path)?;
    let libraries = read_libraries(&libraries)?;
    let report = match &libraries {
        Some(libraries) => validate_project_with_libraries(&project, libraries),
        None => validate_project(&project),
    };
    if report.has_errors() {
        print_diagnostics(&report);
        anyhow::bail!("project has validation errors; refusing to plan");
    }

    let graph = build_initial_operation_graph(&project);
    println!("{}", serde_json::to_string_pretty(&graph)?);
    Ok(())
}
