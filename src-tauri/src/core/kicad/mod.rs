//! KiCad file model types and parsers (pure domain — no I/O).

use serde::{Deserialize, Serialize};

/// Represents a KiCad project detected on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KiCadProject {
    pub project_file: String,
    pub name: String,
    pub pcb_file: Option<String>,
    pub schematic_file: Option<String>,
}

/// A single DRC violation as parsed from kicad-cli JSON output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrcViolation {
    pub rule: String,
    pub severity: DrcSeverity,
    pub description: String,
    pub position: Option<PcbPoint>,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DrcSeverity {
    Error,
    Warning,
    Ignore,
}

/// A 2-D point in KiCad internal units (nanometres).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PcbPoint {
    pub x: i64,
    pub y: i64,
}

impl PcbPoint {
    pub fn from_mm(x_mm: f64, y_mm: f64) -> Self {
        Self {
            x: (x_mm * 1_000_000.0) as i64,
            y: (y_mm * 1_000_000.0) as i64,
        }
    }

    pub fn to_mm(self) -> (f64, f64) {
        (self.x as f64 / 1_000_000.0, self.y as f64 / 1_000_000.0)
    }
}
