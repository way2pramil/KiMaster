//! KiCad IPC API client — NNG named-pipe + Protocol Buffers.
//!
//! Callers import types directly from submodules:
//!   use crate::modules::kicad_ipc::IpcClient::IpcClient;
//!   use crate::modules::kicad_ipc::SchematicApi::SchematicApi;
//!   use crate::modules::kicad_ipc::IpcClient::{IpcError, IpcScanResult};

pub mod IpcClient;
pub mod SchematicApi;
pub mod SexprParser;
pub mod KicadFileParser;

// Re-export only names that DON'T clash with the submodule names.
pub use IpcClient::IpcError;
pub use IpcClient::IpcScanResult;

// ── Generated protobuf modules ────────────────────────────────────────────────
//
// prost-build emits one .rs file per proto package into OUT_DIR.
// Module layout must match the `super::` references the generated code uses:
//
//   kiapi.common.commands.rs  → uses  super::types::ItemHeader
//   kiapi.schematic.types.rs  → uses  super::super::common::types::Text
//
// Therefore:
//   proto::common          ← kiapi.common.rs       (ApiRequest, ApiResponse, ApiStatusCode)
//   proto::common::types   ← kiapi.common.types.rs (KIID, DocumentSpecifier, ItemHeader...)
//   proto::common::commands← kiapi.common.commands.rs (GetItems, BeginCommit...)
//   proto::schematic::types← kiapi.schematic.types.rs (SchematicSymbolInstance...)

pub mod proto {
    pub mod common {
        include!(concat!(env!("OUT_DIR"), "/kiapi.common.rs"));

        pub mod types {
            include!(concat!(env!("OUT_DIR"), "/kiapi.common.types.rs"));
        }

        pub mod commands {
            include!(concat!(env!("OUT_DIR"), "/kiapi.common.commands.rs"));
        }
    }

    pub mod schematic {
        pub mod types {
            include!(concat!(env!("OUT_DIR"), "/kiapi.schematic.types.rs"));
        }
    }
}
