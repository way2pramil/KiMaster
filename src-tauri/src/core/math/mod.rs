//! PCB coordinate math and unit conversions.

/// KiCad internal unit: 1 IU = 1 nanometre.
pub const IU_PER_MM: f64 = 1_000_000.0;
pub const IU_PER_MIL: f64 = 25_400.0;

#[inline(always)]
pub fn mm_to_iu(mm: f64) -> i64 {
    (mm * IU_PER_MM).round() as i64
}

#[inline(always)]
pub fn iu_to_mm(iu: i64) -> f64 {
    iu as f64 / IU_PER_MM
}

#[inline(always)]
pub fn mil_to_iu(mil: f64) -> i64 {
    (mil * IU_PER_MIL).round() as i64
}

#[inline(always)]
pub fn iu_to_mil(iu: i64) -> f64 {
    iu as f64 / IU_PER_MIL
}

/// Manhattan distance between two IU points.
#[inline(always)]
pub fn manhattan_distance(ax: i64, ay: i64, bx: i64, by: i64) -> i64 {
    (ax - bx).abs() + (ay - by).abs()
}

/// Euclidean distance squared (avoids sqrt for comparison use).
#[inline(always)]
pub fn dist_squared(ax: i64, ay: i64, bx: i64, by: i64) -> i64 {
    let dx = ax - bx;
    let dy = ay - by;
    dx * dx + dy * dy
}
