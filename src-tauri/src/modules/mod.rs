//! Feature modules. Each module may use tokio, rusqlite, and IPC types.
//! Modules must never import from each other to prevent coupling.

pub mod bridge;
pub mod cli;
pub mod config;
pub mod git;
pub mod notes;
pub mod project;
pub mod uce;
