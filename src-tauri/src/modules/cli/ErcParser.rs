//! Serde types matching the KiCad 10.0.1 ERC JSON output schema.
//! Schema: https://schemas.kicad.org/erc.v1.json
//! Verified against actual `kicad-cli sch erc --format json` output.

use serde::{Deserialize, Serialize};
use super::DrcParser::{DrcViolation, IgnoredCheck};

/// Top-level ERC report as produced by `kicad-cli sch erc --format json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErcReport {
    #[serde(rename = "$schema", default)]
    pub schema: String,
    pub coordinate_units: String,
    pub date: String,
    pub kicad_version: String,
    pub source: String,
    #[serde(default)]
    pub ignored_checks: Vec<IgnoredCheck>,
    #[serde(default)]
    pub included_severities: Vec<String>,
    #[serde(default)]
    pub sheets: Vec<ErcSheet>,
}

/// A schematic sheet with its ERC violations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErcSheet {
    pub path: String,
    pub uuid_path: String,
    #[serde(default)]
    pub violations: Vec<DrcViolation>,
}

// ── Computed helpers ────────────────────────────────────────────────────────

impl ErcReport {
    /// Total violations across all sheets.
    pub fn total_violations(&self) -> usize {
        self.sheets.iter().map(|s| s.violations.len()).sum()
    }

    /// Number of error-severity violations across all sheets.
    pub fn error_count(&self) -> usize {
        self.all_violations().filter(|v| v.severity == "error").count()
    }

    /// Number of warning-severity violations across all sheets.
    pub fn warning_count(&self) -> usize {
        self.all_violations().filter(|v| v.severity == "warning").count()
    }

    /// Iterate all violations across every sheet.
    pub fn all_violations(&self) -> impl Iterator<Item = &DrcViolation> {
        self.sheets.iter().flat_map(|s| s.violations.iter())
    }
}

/// Parse ERC JSON output from a string.
pub fn parse_erc_json(json_str: &str) -> Result<ErcReport, serde_json::Error> {
    serde_json::from_str(json_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_erc() {
        let json = r#"{
            "$schema": "https://schemas.kicad.org/erc.v1.json",
            "coordinate_units": "mm",
            "date": "2026-05-27T13:31:17",
            "ignored_checks": [],
            "included_severities": ["error", "warning", "exclusion"],
            "kicad_version": "10.0.1",
            "sheets": [
                { "path": "/", "uuid_path": "/abc-123", "violations": [] }
            ],
            "source": "test.kicad_sch"
        }"#;

        let report = parse_erc_json(json).unwrap();
        assert_eq!(report.total_violations(), 0);
        assert_eq!(report.sheets.len(), 1);
    }
}
