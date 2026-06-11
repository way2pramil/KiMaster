//! Thin Tauri IPC command layer. No business logic — delegates to modules/.
//! All public command functions are re-exported for registration in main.rs.

#![allow(non_snake_case)]

pub mod BridgeCommands;
pub mod IpcCommands;
pub mod CliCommands;
pub mod ExportCommands;
pub mod ExportProfileCommands;
pub mod GitCommands;
pub mod NotesCommands;
pub mod ProjectCommands;
pub mod UceCommands;
pub mod Pcb3dCommands;
pub mod CanvasCommands;
