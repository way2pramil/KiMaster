//! Core layer — pure Rust domain logic. Zero Tauri imports allowed here.
//! All types here must be serializable and free of side effects.

pub mod crdt;
pub mod kicad;
pub mod math;
