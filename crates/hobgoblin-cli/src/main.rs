use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use hobgoblin_core::{validate_project, Project, Severity};
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
    Validate { project: PathBuf },
    Plan { project: PathBuf },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Validate { project } => validate(project),
        Command::Plan { project } => plan(project),
    }
}

fn read_project(path: PathBuf) -> Result<Project> {
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read project file '{}'", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("failed to parse project file '{}'", path.display()))
}

fn validate(path: PathBuf) -> Result<()> {
    let project = read_project(path)?;
    let report = validate_project(&project);

    println!("stack intervals:");
    for interval in &report.intervals {
        println!(
            "  {}: {:.3} mm -> {:.3} mm",
            interval.item_id, interval.start_s_mm, interval.end_s_mm
        );
    }

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

    if report.has_errors() {
        anyhow::bail!("validation failed");
    }

    Ok(())
}

fn plan(path: PathBuf) -> Result<()> {
    let project = read_project(path)?;
    let report = validate_project(&project);
    if report.has_errors() {
        anyhow::bail!("project has validation errors; refusing to plan");
    }

    let graph = build_initial_operation_graph(&project);
    println!("{}", serde_json::to_string_pretty(&graph)?);
    Ok(())
}
