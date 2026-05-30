//! LcscClient — async HTTP fetcher for EasyEDA and JLCPCB component APIs.
//!
//! Two operations:
//!   - `search(keyword, page)` — POST JLCPCB search API → ranked result list
//!   - `fetch_component(lcsc_id)` — GET EasyEDA components endpoint → structured data packet
//!
//! Pure Rust, no Tauri imports. All errors use `anyhow::Error`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── API endpoints ─────────────────────────────────────────────────────────────

const EASYEDA_COMPONENT_API: &str =
    "https://easyeda.com/api/products/{}/components";

const JLCPCB_SEARCH_API: &str =
    "https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList";

/// EasyEDA 3D STEP model endpoint.
const EASYEDA_3D_MODEL_STEP_API: &str =
    "https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/{}";

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 KiMaster/1.0";

// ── Public Types ──────────────────────────────────────────────────────────────

/// A single JLCPCB search result entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub lcsc:         String,
    pub name:         String,
    pub mpn:          String,
    pub manufacturer: String,
    pub package:      String,
    pub description:  String,
    pub stock:        i64,
    pub price:        Option<f64>,
    pub part_type:    String,    // "Basic" | "Extended"
    pub datasheet:    String,
    pub category:     String,
}

/// Paginated search response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub total:   u64,
    pub results: Vec<SearchResult>,
}

/// Bounding box from EasyEDA symbol BBox dict.
#[derive(Debug, Clone, Serialize, Default)]
pub struct EdaSymBBox {
    pub x:      f64,
    pub y:      f64,
    pub width:  f64,
    pub height: f64,
}

/// Sub-symbol data for multi-unit components.
#[derive(Debug, Clone, Serialize)]
pub struct SubSymbolData {
    pub shapes:  Vec<String>,
    pub head_x:  f64,
    pub head_y:  f64,
    pub bbox:    EdaSymBBox,
}

/// Raw EasyEDA component data extracted from the API JSON.
///
/// The EasyEDA API returns `dataStr` as a **JSON object** containing:
///   - `head` — origin x/y and `c_para` metadata dict
///   - `shape` — array of tilde-delimited drawing element strings
///   - `BBox` — optional bounding box with x, y, width, height
///
/// This struct extracts those structured fields rather than treating
/// `dataStr` as a plain string.
#[derive(Debug, Clone, Serialize)]
pub struct EdaRawComponent {
    /// LCSC part number (e.g. "C49678").
    pub lcsc_id:       String,
    /// Human-readable component name from the API.
    pub title:         String,
    /// Datasheet URL.
    pub datasheet:     String,
    /// Package / footprint name from the API.
    pub package:       String,
    /// Manufacturer part number.
    pub mpn:           String,
    /// Manufacturer name.
    pub manufacturer:  String,
    /// LCSC part URL.
    pub lcsc_url:      String,
    /// UUID for the 3D model (may be empty).
    pub model_3d_uuid: String,

    // ── Symbol data ──────────────────────────────────────────────────────
    /// Shape array from result.dataStr.shape — each entry is one tilde-delimited record.
    pub sym_shapes:    Vec<String>,
    /// Canvas origin X from result.dataStr.head.x (raw EasyEDA pixels).
    pub sym_head_x:    f64,
    /// Canvas origin Y from result.dataStr.head.y (raw EasyEDA pixels).
    pub sym_head_y:    f64,
    /// BBox from result.dataStr.BBox (raw EasyEDA pixels).
    pub sym_bbox:      EdaSymBBox,
    /// Reference designator prefix from result.dataStr.head.c_para.pre (e.g. "U", "R", "C").
    pub sym_prefix:    String,

    // ── Footprint data ───────────────────────────────────────────────────
    /// Shape array from result.packageDetail.dataStr.shape.
    pub fp_shapes:     Vec<String>,
    /// Footprint origin X from result.packageDetail.dataStr.head.x (raw pixels).
    pub fp_head_x:     f64,
    /// Footprint origin Y from result.packageDetail.dataStr.head.y (raw pixels).
    pub fp_head_y:     f64,
    /// True if this is an SMD component (vs. through-hole).
    pub fp_is_smd:     bool,

    // ── Multi-unit symbol data ──────────────────────────────────────
    /// Sub-symbol data for multi-unit components. Empty for single-unit.
    pub sub_symbols:   Vec<SubSymbolData>,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Shared HTTP client with keep-alive and gzip support. Cheap to clone.
#[derive(Clone)]
pub struct LcscClient {
    http: reqwest::Client,
}

impl LcscClient {
    /// Construct a new client. Call once and share via `Arc` or `AppState`.
    pub fn new() -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .gzip(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        Ok(Self { http })
    }

    // ── Search ─────────────────────────────────────────────────────────────

    /// POST JLCPCB part search. Returns up to `page_size` results per page (max 100).
    pub async fn search(
        &self,
        keyword: &str,
        page:      u32,
        page_size: u32,
    ) -> anyhow::Result<SearchResponse> {
        let payload = serde_json::json!({
            "keyword":     keyword,
            "currentPage": page,
            "pageSize":    page_size.min(100),
        });

        let resp: Value = self
            .http
            .post(JLCPCB_SEARCH_API)
            .header("Content-Type", "application/json")
            .header("Origin",  "https://jlcpcb.com")
            .header("Referer", "https://jlcpcb.com/parts")
            .json(&payload)
            .send()
            .await?
            .json()
            .await?;

        let page_info = resp["data"]["componentPageInfo"].as_object()
            .ok_or_else(|| anyhow::anyhow!("Unexpected JLCPCB response structure"))?;

        let total = page_info
            .get("total")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let items = page_info
            .get("list")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let results = items
            .iter()
            .map(|item| {
                let prices = item["componentPrices"].as_array();
                let price  = prices
                    .and_then(|p| p.first())
                    .and_then(|p| p["productPrice"].as_f64());
                SearchResult {
                    lcsc:         item["componentCode"].as_str().unwrap_or("").to_string(),
                    name:         item["componentName"].as_str().unwrap_or("").to_string(),
                    mpn:          item["componentModelEn"].as_str().unwrap_or("").to_string(),
                    manufacturer: item["componentBrandEn"].as_str().unwrap_or("").to_string(),
                    package:      item["componentSpecificationEn"].as_str().unwrap_or("").to_string(),
                    description:  item["describe"].as_str().unwrap_or("").to_string(),
                    stock:        item["stockCount"].as_i64().unwrap_or(0),
                    price,
                    part_type:    if item["componentLibraryType"].as_str() == Some("base") {
                        "Basic".to_string()
                    } else {
                        "Extended".to_string()
                    },
                    datasheet:    item["dataManualUrl"].as_str().unwrap_or("").to_string(),
                    category:     item["componentTypeEn"].as_str().unwrap_or("").to_string(),
                }
            })
            .collect();

        Ok(SearchResponse { total, results })
    }

    // ── MPN resolution ──────────────────────────────────────────────────────

    /// Check whether an identifier looks like an LCSC part number (e.g. "C8734", "C1234567").
    /// Case-insensitive: both "C8734" and "c8734" are recognized.
    pub fn is_lcsc_id(id: &str) -> bool {
        let id = id.trim();
        id.len() >= 2
            && id.as_bytes()[0].to_ascii_uppercase() == b'C'
            && id[1..].chars().all(|c| c.is_ascii_digit())
    }

    /// Resolve an identifier to an LCSC part number.
    ///
    /// If the input already looks like an LCSC ID (e.g. "C8734" or "c8734"),
    /// return it normalized to uppercase.
    /// Otherwise, treat it as an MPN and search JLCPCB to find the best matching
    /// LCSC part number. Returns the LCSC code of the first result whose MPN
    /// matches case-insensitively, or the first result if no exact MPN match.
    pub async fn resolve_to_lcsc(&self, identifier: &str) -> anyhow::Result<String> {
        let id = identifier.trim();
        if Self::is_lcsc_id(id) {
            // Normalize to uppercase (EasyEDA API requires uppercase "C")
            return Ok(format!("C{}", &id[1..]));
        }

        // Search JLCPCB using the identifier as keyword (works for MPN, name, etc.)
        let resp = self.search(id, 1, 20).await?;
        if resp.results.is_empty() {
            anyhow::bail!("No components found for MPN/keyword: {id}");
        }

        // Prefer exact MPN match (case-insensitive)
        let id_upper = id.to_uppercase();
        if let Some(exact) = resp.results.iter().find(|r| r.mpn.to_uppercase() == id_upper) {
            return Ok(exact.lcsc.clone());
        }

        // Fallback: return first result
        Ok(resp.results[0].lcsc.clone())
    }

    // ── Fetch component ────────────────────────────────────────────────────

    /// GET EasyEDA component data for the given LCSC part number.
    /// Returns structured `EdaRawComponent` with properly extracted symbol + footprint data.
    pub async fn fetch_component(&self, lcsc_id: &str) -> anyhow::Result<EdaRawComponent> {
        let url = EASYEDA_COMPONENT_API.replace("{}", lcsc_id);

        let resp: Value = self
            .http
            .get(&url)
            .header("Referer", "https://easyeda.com/")
            .send()
            .await?
            .json()
            .await?;

        if resp["success"].as_bool() == Some(false) {
            anyhow::bail!("EasyEDA API returned success=false for {lcsc_id}");
        }

        let result = &resp["result"];
        if result.is_null() {
            anyhow::bail!("EasyEDA API: no result for {lcsc_id}");
        }

        // ── Symbol dataStr ─────────────────────────────────────────────────
        // The API returns dataStr as a JSON object with head/shape/BBox keys.
        // Try direct path first, then schematicSymbol path for multi-part packages.
        let sym_ds = Self::find_data_str_obj(result, &[
            &["dataStr"],
            &["schematicSymbol", "dataStr"],
        ]);

        let sym_shapes  = Self::extract_shapes(&sym_ds);
        let sym_head    = &sym_ds["head"];
        let sym_head_x  = Self::json_f64_str(sym_head, "x");
        let sym_head_y  = Self::json_f64_str(sym_head, "y");

        let bbox_obj    = &sym_ds["BBox"];
        let sym_bbox = EdaSymBBox {
            x:      Self::json_f64_str(bbox_obj, "x"),
            y:      Self::json_f64_str(bbox_obj, "y"),
            width:  Self::json_f64_str(bbox_obj, "width"),
            height: Self::json_f64_str(bbox_obj, "height"),
        };

        let c_para     = &sym_head["c_para"];
        let sym_prefix = c_para["pre"].as_str().unwrap_or("U").to_string();

        // ── Footprint dataStr ──────────────────────────────────────────────
        let fp_ds = Self::find_data_str_obj(result, &[
            &["packageDetail", "dataStr"],
        ]);

        let fp_shapes = Self::extract_shapes(&fp_ds);
        let fp_head   = &fp_ds["head"];
        let fp_head_x = Self::json_f64_str(fp_head, "x");
        let fp_head_y = Self::json_f64_str(fp_head, "y");

        // ── SMD detection ──────────────────────────────────────────────────
        // Priority: customData.jlcPara.assemblyProcess → SMT flag + title heuristic.
        let assembly = result["customData"]["jlcPara"]["assemblyProcess"]
            .as_str().unwrap_or("");
        let fp_is_smd = if !assembly.is_empty() {
            assembly.eq_ignore_ascii_case("SMT")
        } else {
            let smt_flag = result["SMT"].as_bool().unwrap_or(false)
                || result["SMT"].as_i64() == Some(1);
            let fp_title = result["packageDetail"]["title"].as_str().unwrap_or("");
            smt_flag && !fp_title.contains("-TH_")
        };

        // ── Component metadata ─────────────────────────────────────────────
        let title = Self::extract_str(result, &["title"])
            .or_else(|| Self::extract_str(result, &["name"]))
            .or_else(|| c_para["name"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| lcsc_id.to_string());

        let package = Self::extract_str(result, &["packageDetail", "title"])
            .or_else(|| Self::extract_str(result, &["package"]))
            .or_else(|| c_para["package"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();

        let datasheet = Self::extract_str(result, &["datasheet"])
            .unwrap_or_default();

        let lcsc_dict = &result["lcsc"];
        let lcsc_number = lcsc_dict["number"].as_str().unwrap_or(lcsc_id);
        let lcsc_url = format!("https://www.lcsc.com/product-detail/{lcsc_number}.html");

        let mpn = Self::extract_str(result, &["mpn"])
            .or_else(|| Self::extract_str(result, &["number"]))
            .or_else(|| c_para["Manufacturer Part"].as_str().map(|s| s.to_string()))
            .or_else(|| c_para["BOM_Manufacturer Part"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();

        let manufacturer = Self::extract_str(result, &["manufacturer"])
            .or_else(|| c_para["Manufacturer"].as_str().map(|s| s.to_string()))
            .or_else(|| c_para["BOM_Manufacturer"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();

        let model_3d_uuid = Self::extract_str(result, &["packageDetail", "uuid"])
            .or_else(|| Self::extract_str(result, &["uuid"]))
            .unwrap_or_default();

        // ── Multi-unit subparts ───────────────────────────────────────
        let sub_symbols = Self::extract_subparts(result);

        Ok(EdaRawComponent {
            lcsc_id:    lcsc_id.to_string(),
            title,
            datasheet,
            package,
            mpn,
            manufacturer,
            lcsc_url,
            model_3d_uuid,
            sym_shapes,
            sym_head_x,
            sym_head_y,
            sym_bbox,
            sym_prefix,
            fp_shapes,
            fp_head_x,
            fp_head_y,
            fp_is_smd,
            sub_symbols,
        })
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /// Navigate a JSON value by a chain of string keys, returning the leaf as a String.
    fn extract_str(v: &Value, keys: &[&str]) -> Option<String> {
        let mut cur = v;
        for k in keys {
            cur = cur.get(k)?;
        }
        cur.as_str().map(|s| s.to_string())
    }

    /// Try multiple JSON paths and return the first one that yields a JSON object.
    fn find_data_str_obj<'a>(result: &'a Value, paths: &[&[&str]]) -> &'a Value {
        for path in paths {
            let mut cur = result;
            let mut found = true;
            for key in *path {
                match cur.get(key) {
                    Some(v) => cur = v,
                    None => { found = false; break; }
                }
            }
            if found && cur.is_object() {
                return cur;
            }
        }
        // Return a static null reference
        &Value::Null
    }

    /// Extract the `shape` array from a dataStr JSON object → Vec<String>.
    fn extract_shapes(data_str_obj: &Value) -> Vec<String> {
        data_str_obj["shape"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Extract a numeric value from a JSON object field that may be stored as a string.
    /// EasyEDA API often stores numbers as JSON strings (e.g. `"x": "4000"`).
    fn json_f64_str(obj: &Value, key: &str) -> f64 {
        let field = &obj[key];
        // Try as number first, then as string
        field.as_f64()
            .or_else(|| field.as_i64().map(|i| i as f64))
            .or_else(|| field.as_str().and_then(|s| s.parse::<f64>().ok()))
            .unwrap_or(0.0)
    }

    // ── 3D Model ──────────────────────────────────────────────────────

    /// Fetch a 3D STEP model binary by UUID from the EasyEDA CDN.
    /// Returns `Ok(None)` if the UUID is empty or the model doesn't exist (404).
    pub async fn fetch_step_model(&self, uuid: &str) -> anyhow::Result<Option<Vec<u8>>> {
        if uuid.is_empty() { return Ok(None); }
        let url = EASYEDA_3D_MODEL_STEP_API.replace("{}", uuid);
        let resp = self.http
            .get(&url)
            .header("Referer", "https://easyeda.com/")
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let bytes = resp.error_for_status()?.bytes().await?;
        if bytes.is_empty() { return Ok(None); }
        Ok(Some(bytes.to_vec()))
    }

    /// Extract subpart symbol data from the API result.
    /// Returns a Vec of SubSymbolData for multi-unit components.
    fn extract_subparts(result: &Value) -> Vec<SubSymbolData> {
        let mut subs = Vec::new();

        // The API may have subparts at result.subparts or result.dataStr.subparts
        let subparts_val = if result["subparts"].is_array() {
            &result["subparts"]
        } else {
            return subs;
        };

        let subparts = match subparts_val.as_array() {
            Some(arr) => arr,
            None => return subs,
        };

        for sp in subparts {
            let ds = Self::find_data_str_obj(sp, &[&["dataStr"]]);
            if ds.is_null() { continue; }

            // Note: do NOT skip empty-shape subparts — they still contribute to
            // the unit count. The caller validates content after all units are collected.
            let shapes = Self::extract_shapes(ds);

            let head = &ds["head"];
            let head_x = Self::json_f64_str(head, "x");
            let head_y = Self::json_f64_str(head, "y");

            let bbox_obj = &ds["BBox"];
            let bbox = EdaSymBBox {
                x:      Self::json_f64_str(bbox_obj, "x"),
                y:      Self::json_f64_str(bbox_obj, "y"),
                width:  Self::json_f64_str(bbox_obj, "width"),
                height: Self::json_f64_str(bbox_obj, "height"),
            };

            subs.push(SubSymbolData { shapes, head_x, head_y, bbox });
        }

        subs
    }
}
