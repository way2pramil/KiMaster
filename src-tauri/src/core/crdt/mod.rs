//! CRDT document wrappers — Phase 4.
//! This module will use the `yrs` crate for Conflict-free Replicated Data Types
//! enabling safe live modifications to KiCad files without locks.
//!
//! Stub for Phase 1. Implementation added in Phase 4.

/// Placeholder type — replaced by yrs::Doc in Phase 4.
#[derive(Debug, Default)]
pub struct CrdtDocument {
    _private: (),
}

impl CrdtDocument {
    pub fn new() -> Self {
        Self::default()
    }
}
