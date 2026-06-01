/**
 * PostProcessConfig — default values and localStorage persistence for the
 * Component Vault post-processing pipeline configuration.
 *
 * These settings are sent to the Rust backend with every "Add to Vault" call
 * so the generated KiCad files match the user's preferences.
 */

const STORAGE_KEY = 'kimaster_pp_config_v1';

export const DEFAULTS = {
  // ── Pin geometry ──────────────────────────────────────────────────────────
  pin_type:             'passive',   // 'passive' | 'unspecified' | 'keep'
  pin_length_mil:       200,         // 100 | 150 | 200 | 250 | 300
  pin_number_size_mil:  50,          // 30 | 40 | 50
  pin_name_size_mil:    50,          // 30 | 40 | 50

  // ── Symbol identity ───────────────────────────────────────────────────────
  symbol_name_source:   'mpn',       // 'mpn' | 'lcsc'
  footprint_naming:     'lcsc',      // 'lcsc' | 'package'

  // ── Fields to include (checkbox per field) ────────────────────────────────
  field_description:    true,
  field_datasheet:      true,
  field_manufacturer:   true,
  field_mpn:            true,
  field_package:        true,
  field_lcsc_part:      true,
  field_price:          true,
  field_stock:          true,
  field_dnp_status:     false,
  field_notes:          false,
};

/** Field metadata for the UI: key → { label, description } */
export const FIELD_META = {
  field_description:  { label: 'Description',  desc: 'Component description from EasyEDA' },
  field_datasheet:    { label: 'Datasheet',     desc: 'Datasheet URL' },
  field_manufacturer: { label: 'Manufacturer',  desc: 'Manufacturer name' },
  field_mpn:          { label: 'MPN',           desc: 'Manufacturer part number' },
  field_package:      { label: 'Package',       desc: 'Physical package name (e.g. SOT-23-6)' },
  field_lcsc_part:    { label: 'LCSC Part #',   desc: 'LCSC / EasyEDA component ID' },
  field_price:        { label: 'Price',         desc: 'LCSC unit price (USD)' },
  field_stock:        { label: 'Stock',         desc: 'LCSC stock count at time of import' },
  field_dnp_status:   { label: 'DNP Status',    desc: 'Do-not-populate marker (blank by default)' },
  field_notes:        { label: 'Note(s)',       desc: 'Free-text notes field (blank by default)' },
};

export function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* ignore quota errors */ }
}
