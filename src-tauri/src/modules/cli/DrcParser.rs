//! Serde types matching the KiCad 10.0.1 DRC JSON output schema.
//! Schema: https://schemas.kicad.org/drc.v1.json
//! These types were verified against actual `kicad-cli pcb drc --format json` output.

use serde::{Deserialize, Serialize};

/// Top-level DRC report as produced by `kicad-cli pcb drc --format json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrcReport {
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
    pub schematic_parity: Vec<DrcViolation>,
    #[serde(default)]
    pub unconnected_items: Vec<DrcViolation>,
    #[serde(default)]
    pub violations: Vec<DrcViolation>,
}

/// A check that was configured to be skipped in the board settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgnoredCheck {
    pub description: String,
    pub key: String,
}

/// A single DRC violation (clearance, courtyard, footprint mismatch, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrcViolation {
    pub description: String,
    #[serde(default)]
    pub items: Vec<DrcItem>,
    pub severity: String,
    #[serde(rename = "type")]
    pub violation_type: String,
}

/// A PCB item referenced in a violation (footprint, pad, zone, trace, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrcItem {
    pub description: String,
    pub pos: DrcPosition,
    pub uuid: String,
}

/// Board coordinate in mm (when coordinate_units == "mm").
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DrcPosition {
    pub x: f64,
    pub y: f64,
}

// ── Computed helpers ────────────────────────────────────────────────────────

impl DrcReport {
    /// Total violations + unconnected + parity issues.
    pub fn total_issues(&self) -> usize {
        self.violations.len() + self.unconnected_items.len() + self.schematic_parity.len()
    }

    /// Number of issues with severity == "error".
    pub fn error_count(&self) -> usize {
        self.all_violations().filter(|v| v.severity == "error").count()
    }

    /// Number of issues with severity == "warning".
    pub fn warning_count(&self) -> usize {
        self.all_violations().filter(|v| v.severity == "warning").count()
    }

    /// Iterate all violations (violations + unconnected + parity).
    pub fn all_violations(&self) -> impl Iterator<Item = &DrcViolation> {
        self.violations
            .iter()
            .chain(self.unconnected_items.iter())
            .chain(self.schematic_parity.iter())
    }
}

impl DrcViolation {
    pub fn is_error(&self) -> bool {
        self.severity == "error"
    }

    pub fn is_warning(&self) -> bool {
        self.severity == "warning"
    }

    /// First item position (if any).
    pub fn primary_position(&self) -> Option<DrcPosition> {
        self.items.first().map(|i| i.pos)
    }
}

/// Parse DRC JSON output from a file.
pub fn parse_drc_json(json_str: &str) -> Result<DrcReport, serde_json::Error> {
    serde_json::from_str(json_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_real_drc_output() {
        let json = r#"{
            "$schema": "https://schemas.kicad.org/drc.v1.json",
            "coordinate_units": "mm",
            "date": "2026-05-27T13:30:51",
            "ignored_checks": [],
            "included_severities": ["error", "warning"],
            "kicad_version": "10.0.1",
            "schematic_parity": [],
            "source": "test.kicad_pcb",
            "unconnected_items": [],
            "violations": [
                {
                    "description": "Clearance violation (0.5mm; actual 0.33mm)",
                    "items": [
                        {
                            "description": "Pad on F.Cu",
                            "pos": { "x": 139.49, "y": 97.97 },
                            "uuid": "1b1d0efc-e24f-43ce-b169-b3cc43e0a911"
                        }
                    ],
                    "severity": "error",
                    "type": "clearance"
                }
            ]
        }"#;

        let report = parse_drc_json(json).unwrap();
        assert_eq!(report.kicad_version, "10.0.1");
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.error_count(), 1);
        assert_eq!(report.warning_count(), 0);
        assert_eq!(report.violations[0].violation_type, "clearance");
    }
}
