//! Qdrant Edge on the phone, the app's only database.
//!
//! `memory`: visit notes, never leaves the phone. `knowledge`: guidance and
//! alerts from the district, updated from snapshots. `state`: app records
//! (households, outbox, settings, activity) as payload-only points.
//! Memory and knowledge points have a "dense" vector (from the web view's
//! model) and a "bm25" sparse vector (built here).

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use qdrant_edge::bm25_embed::{EdgeBm25, EdgeBm25Config};
use qdrant_edge::external::ordered_float::OrderedFloat;
use qdrant_edge::external::uuid::Uuid;
use qdrant_edge::internal::{SnapshotManifest, clear_data, move_data};
use qdrant_edge::{
    CountRequestBuilder, CreateIndex, DecayKind, Distance, EdgeConfig, EdgeShard,
    EdgeSparseVectorParams, EdgeVectorParams, Expression, FacetRequestBuilder, FacetValue,
    FieldIndexOperations, Filter, Formula, Fusion, JsonPath, Mmr, Modifier, NamedQuery,
    PayloadFieldSchema, PointId, PointInsertOperations, PointOperations, PointStruct,
    PrefetchBuilder, QuantizationConfig, QueryEnum, QueryRequestBuilder, RecommendQuery,
    RetrieveRequestBuilder, ScoredPoint, ScoringQuery, ScrollRequestBuilder, SearchParams, UpdateOperation,
    Vector, VectorInternal, VectorStructInternal, Vectors, WalOptions, WithPayloadInterface,
    WithVector,
};
use serde::Deserialize;
use serde_json::{Value, json};

pub const DIM: usize = 384;
const DENSE: &str = "dense";
const SPARSE: &str = "bm25";
pub const SHARDS: [&str; 3] = ["memory", "knowledge", "state"];
const STATE: &str = "state";

fn payload_indexes(shard: &str) -> &'static [(&'static str, &'static str)] {
    match shard {
        "memory" => &[
            ("kind", "keyword"),
            ("village", "keyword"),
            ("ward", "keyword"),
            ("household_id", "keyword"),
            ("member_id", "keyword"),
            ("syndromes", "keyword"),
            ("activities", "keyword"),
            ("age_band", "keyword"),
            ("sync_class", "keyword"),
            ("sync_status", "keyword"),
            ("pregnant", "bool"),
            ("danger", "bool"),
            ("visit_at", "datetime"),
            ("loc", "geo"),
        ],
        STATE => &[("name", "keyword")],
        _ => &[
            ("kind", "keyword"),
            ("villages", "keyword"),
            ("severity", "keyword"),
            ("topic", "keyword"),
            ("published_at", "datetime"),
            ("expires_at", "datetime"),
        ],
    }
}

fn shard_config() -> Result<EdgeConfig, String> {
    let quantization: QuantizationConfig =
        serde_json::from_value(json!({"scalar": {"type": "int8", "quantile": 0.99}}))
            .map_err(|e| e.to_string())?;
    let dense = EdgeVectorParams::builder(DIM, Distance::Cosine)
        .on_disk(true)
        .quantization_config(quantization)
        .build();
    let sparse = EdgeSparseVectorParams {
        modifier: Some(Modifier::Idf),
        on_disk: Some(true),
        ..Default::default()
    };
    Ok(EdgeConfig::builder()
        .vector(DENSE, dense)
        .sparse_vector(SPARSE, sparse)
        .on_disk_payload(true)
        .wal_options(small_wal())
        .build())
}

fn small_wal() -> WalOptions {
    // Default WAL segment is 32 MiB per shard.
    WalOptions {
        segment_capacity: 4 * 1024 * 1024,
        ..Default::default()
    }
}

/// Records without vectors; a sparse slot is declared because a shard needs one vector config.
fn state_config() -> EdgeConfig {
    EdgeConfig::builder()
        .sparse_vector(SPARSE, EdgeSparseVectorParams::default())
        .on_disk_payload(true)
        .wal_options(small_wal())
        .build()
}

fn config_for(shard: &str) -> Result<EdgeConfig, String> {
    if shard == STATE { Ok(state_config()) } else { shard_config() }
}

/// Stable point id for a named record (FNV-1a).
fn doc_id(name: &str) -> PointId {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in name.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    PointId::NumId(h)
}

fn bm25_model() -> Result<EdgeBm25, String> {
    // No stemming: English stemmers mangle Hindi and Hinglish.
    let config: EdgeBm25Config = serde_json::from_value(json!({
        "tokenizer": "multilingual",
        "lowercase": true,
        "stemmer": {"type": "none"}
    }))
    .map_err(|e| e.to_string())?;
    EdgeBm25::new(config).map_err(|e| e.to_string())
}

pub struct EdgeState {
    root: PathBuf,
    shards: Mutex<HashMap<String, EdgeShard>>,
    bm25: EdgeBm25,
}


#[derive(Deserialize)]
pub struct PointIn {
    pub id: String,
    pub dense: Vec<f32>,
    pub text: String,
    pub payload: Value,
}

#[derive(Deserialize)]
pub struct Recency {
    /// Payload datetime field to decay on, e.g. "visit_at".
    pub key: String,
    pub now: String,
    /// Half-life in days: a point this old gets half the recency boost.
    pub half_life_days: f32,
    /// Share of the score driven by recency (0..1).
    pub weight: f32,
}

#[derive(Deserialize)]
pub struct QueryIn {
    pub dense: Vec<f32>,
    pub text: String,
    #[serde(default)]
    pub filter: Option<Value>,
    pub limit: usize,
    /// "hybrid" | "dense" | "sparse" | "diverse"
    pub mode: String,
    /// RRF weights for [dense, bm25].
    #[serde(default)]
    pub weights: Option<[f32; 2]>,
    #[serde(default)]
    pub recency: Option<Recency>,
    #[serde(default)]
    pub score_threshold: Option<f32>,
}


fn parse_id(id: &str) -> Result<PointId, String> {
    if let Ok(n) = id.parse::<u64>() {
        return Ok(PointId::NumId(n));
    }
    Uuid::parse_str(id)
        .map(PointId::Uuid)
        .map_err(|_| format!("point id must be a number or UUID: {id}"))
}

fn id_json(id: &PointId) -> Value {
    match id {
        PointId::NumId(n) => json!(n.to_string()),
        PointId::Uuid(u) => json!(u.to_string()),
    }
}

fn parse_filter(filter: Option<Value>) -> Result<Option<Filter>, String> {
    match filter {
        None | Some(Value::Null) => Ok(None),
        // Qdrant REST filter JSON.
        Some(v) => serde_json::from_value(v).map(Some).map_err(|e| format!("bad filter: {e}")),
    }
}

fn scored_json(points: Vec<ScoredPoint>) -> Value {
    Value::Array(
        points
            .into_iter()
            .map(|p| {
                json!({
                    "id": id_json(&p.id),
                    "score": p.score,
                    "payload": p.payload.map(|pl| Value::Object(pl.0)).unwrap_or(Value::Null),
                })
            })
            .collect(),
    )
}

/// ACORN keeps HNSW recall up under narrow combined filters ("pregnant, ward 3, this week").
fn filtered_params() -> Option<SearchParams> {
    serde_json::from_value(json!({"acorn": {"enable": true, "max_selectivity": 0.4}})).ok()
}

fn nearest(vector: VectorInternal, using: &str) -> ScoringQuery {
    ScoringQuery::Vector(QueryEnum::Nearest(NamedQuery {
        query: vector,
        using: Some(using.to_string()),
    }))
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else { return 0 };
    entries
        .flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() { dir_size(&p) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }
        })
        .sum()
}

impl EdgeState {
    pub fn open(root: &Path) -> Result<Self, String> {
        // Let the web view show its startup screen before first-run shard/index creation.
        Ok(Self {
            root: root.join("qdrant"),
            shards: Mutex::new(HashMap::new()),
            bm25: bm25_model()?,
        })
    }

    fn shard_path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn load_shard(&self, name: &str) -> Result<EdgeShard, String> {
        if !SHARDS.contains(&name) {
            return Err(format!("unknown shard: {name}"));
        }
        let path = self.shard_path(name);
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        let shard = EdgeShard::load(&path, Some(config_for(name)?)).map_err(|e| e.to_string())?;
        ensure_indexes(&shard, name)?;
        Ok(shard)
    }

    fn with_shard<T>(&self, name: &str, f: impl FnOnce(&EdgeShard) -> Result<T, String>) -> Result<T, String> {
        let mut shards = self.shards.lock().map_err(|e| e.to_string())?;
        if !shards.contains_key(name) {
            shards.insert(name.to_string(), self.load_shard(name)?);
        }
        let shard = shards.get(name).ok_or_else(|| format!("unknown shard: {name}"))?;
        f(shard)
    }

    // ------------------------------- writes -------------------------------

    pub fn upsert(&self, shard: &str, points: Vec<PointIn>) -> Result<usize, String> {
        let count = points.len();
        let mut batch = Vec::with_capacity(count);
        for p in points {
            if p.dense.len() != DIM {
                return Err(format!("dense vector must have {DIM} dims, got {}", p.dense.len()));
            }
            if !p.payload.is_object() {
                return Err("payload must be a JSON object".into());
            }
            let sparse = self.bm25.embed_document(&p.text);
            let vectors = Vectors::new_named([(DENSE, Vector::from(p.dense)), (SPARSE, Vector::from(sparse))]);
            batch.push(PointStruct::new(parse_id(&p.id)?, vectors, p.payload).into());
        }
        self.with_shard(shard, |s| {
            s.update(UpdateOperation::PointOperation(PointOperations::UpsertPoints(
                PointInsertOperations::PointsList(batch),
            )))
            .map_err(|e| e.to_string())?;
            s.flush().map_err(|e| e.to_string())
        })?;
        Ok(count)
    }

    pub fn set_payload(&self, shard: &str, id: &str, patch: Value) -> Result<(), String> {
        // Read-modify-write with the stored vectors.
        let pid = parse_id(id)?;
        self.with_shard(shard, |s| {
            let records = s
                .retrieve(
                    RetrieveRequestBuilder::new(vec![pid])
                        .with_payload(WithPayloadInterface::Bool(true))
                        .with_vector(WithVector::Bool(true))
                        .build(),
                )
                .map_err(|e| e.to_string())?;
            let Some(record) = records.into_iter().next() else {
                return Err(format!("point not found: {id}"));
            };
            let mut payload = record.payload.map(|p| p.0).unwrap_or_default();
            if let Value::Object(patch) = patch {
                for (k, v) in patch {
                    payload.insert(k, v);
                }
            }
            let Some(VectorStructInternal::Named(named)) = record.vector else {
                return Err("stored point has no named vectors".into());
            };
            let vectors = Vectors::new_named(named.into_iter().map(|(k, v)| (k, Vector(v))));
            s.update(UpdateOperation::PointOperation(PointOperations::UpsertPoints(
                PointInsertOperations::PointsList(vec![
                    PointStruct::new(pid, vectors, Value::Object(payload)).into(),
                ]),
            )))
            .map_err(|e| e.to_string())?;
            s.flush().map_err(|e| e.to_string())
        })
    }

    pub fn delete(&self, shard: &str, ids: Vec<String>) -> Result<(), String> {
        let ids = ids.iter().map(|i| parse_id(i)).collect::<Result<Vec<_>, _>>()?;
        self.with_shard(shard, |s| {
            s.update(UpdateOperation::PointOperation(PointOperations::DeletePoints { ids }))
                .map_err(|e| e.to_string())?;
            s.flush().map_err(|e| e.to_string())
        })
    }

    // ------------------------------- reads --------------------------------

    pub fn query(&self, shard: &str, q: QueryIn) -> Result<Value, String> {
        let filter = parse_filter(q.filter)?;
        let dense = VectorInternal::from(q.dense);
        let sparse = VectorInternal::from(self.bm25.embed_query(&q.text));
        let candidates = (q.limit * 4).max(30);

        let acorn = filter.as_ref().and_then(|_| filtered_params());
        let leaf = |query: ScoringQuery| {
            let mut b = PrefetchBuilder::new(candidates).query(query);
            if let Some(f) = &filter {
                b = b.filter(f.clone());
            }
            if let Some(p) = &acorn {
                b = b.params(p.clone());
            }
            b.build()
        };
        let fusion = || {
            let weights = q
                .weights
                .map(|[d, s]| vec![OrderedFloat(d), OrderedFloat(s)]);
            PrefetchBuilder::new(candidates)
                .add_prefetch(leaf(nearest(dense.clone(), DENSE)))
                .add_prefetch(leaf(nearest(sparse.clone(), SPARSE)))
                .query(ScoringQuery::Fusion(Fusion::Rrf { k: 60, weights }))
                .build()
        };

        let single = match q.mode.as_str() {
            "dense" => Some(nearest(dense.clone(), DENSE)),
            "sparse" => Some(nearest(sparse.clone(), SPARSE)),
            "hybrid" | "diverse" => None,
            other => return Err(format!("unknown search mode: {other}")),
        };

        let mut request = QueryRequestBuilder::new(q.limit).with_payload(WithPayloadInterface::Bool(true));
        if let Some(t) = q.score_threshold {
            request = request.score_threshold(t);
        }

        // Single-stage: keep the natural score so callers can threshold on cosine.
        if q.mode != "diverse" && q.recency.is_none() {
            request = match single {
                Some(query) => {
                    let mut r = request.query(query);
                    if let Some(f) = &filter {
                        r = r.filter(f.clone());
                    }
                    if let Some(p) = &acorn {
                        r = r.params(p.clone());
                    }
                    r
                }
                None => {
                    let weights = q.weights.map(|[d, s]| vec![OrderedFloat(d), OrderedFloat(s)]);
                    request
                        .add_prefetch(leaf(nearest(dense.clone(), DENSE)))
                        .add_prefetch(leaf(nearest(sparse.clone(), SPARSE)))
                        .query(ScoringQuery::Fusion(Fusion::Rrf { k: 60, weights }))
                }
            };
            let points = self.with_shard(shard, |s| s.query(request.build()).map_err(|e| e.to_string()))?;
            return Ok(scored_json(points));
        }

        // Two-stage: relevance candidates first, then re-score them.
        let base = match single {
            Some(query) => leaf(query),
            None => fusion(),
        };
        let root = if q.mode == "diverse" {
            ScoringQuery::Mmr(Mmr {
                vector: dense.clone(),
                using: DENSE.to_string(),
                lambda: OrderedFloat(0.7),
                candidates_limit: candidates,
            })
        } else {
            let r = q.recency.as_ref().expect("checked above");
            // score * ((1 - w) + w * exp_decay(age)); datetime scale is in seconds.
            let decay = Expression::Decay {
                kind: DecayKind::Exp,
                x: Box::new(Expression::DatetimeKey(
                    r.key.parse::<JsonPath>().map_err(|_| format!("bad key: {}", r.key))?,
                )),
                target: Some(Box::new(Expression::Datetime(r.now.clone()))),
                midpoint: Some(0.5),
                scale: Some(r.half_life_days * 86_400.0),
            };
            let boost = Expression::Sum(vec![
                Expression::Constant(1.0 - r.weight),
                Expression::Mult(vec![Expression::Constant(r.weight), decay]),
            ]);
            let formula = Formula {
                formula: Expression::Mult(vec![Expression::Variable("$score".into()), boost]),
                defaults: HashMap::new(),
            };
            ScoringQuery::Formula(formula.try_into().map_err(|e: qdrant_edge::OperationError| e.to_string())?)
        };

        let request = request.add_prefetch(base).query(root);
        let points = self.with_shard(shard, |s| s.query(request.build()).map_err(|e| e.to_string()))?;
        Ok(scored_json(points))
    }

    /// Recommend by the stored vector of an existing point.
    pub fn similar(&self, shard: &str, id: &str, filter: Option<Value>, limit: usize) -> Result<Value, String> {
        let pid = parse_id(id)?;
        let mut combined = json!({"must_not": [{"has_id": [id_json(&pid)]}]});
        if let Some(f) = filter.filter(|f| !f.is_null()) {
            combined["must"] = json!([f]);
        }
        let filter = parse_filter(Some(combined))?;
        self.with_shard(shard, |s| {
            let records = s
                .retrieve(
                    RetrieveRequestBuilder::new(vec![pid])
                        .with_vector(WithVector::Bool(true))
                        .build(),
                )
                .map_err(|e| e.to_string())?;
            let vector = records
                .into_iter()
                .next()
                .and_then(|r| match r.vector {
                    Some(VectorStructInternal::Named(mut named)) => named.remove(DENSE),
                    _ => None,
                })
                .ok_or_else(|| format!("no dense vector for point {id}"))?;
            let mut request = QueryRequestBuilder::new(limit)
                .query(ScoringQuery::Vector(QueryEnum::RecommendBestScore(NamedQuery {
                    query: RecommendQuery::new(vec![vector], vec![]),
                    using: Some(DENSE.to_string()),
                })))
                .with_payload(WithPayloadInterface::Bool(true));
            if let Some(f) = filter {
                request = request.filter(f);
            }
            s.query(request.build()).map(scored_json).map_err(|e| e.to_string())
        })
    }

    pub fn facet(&self, shard: &str, key: &str, filter: Option<Value>, limit: usize) -> Result<Value, String> {
        let filter = parse_filter(filter)?;
        let key: JsonPath = key.parse().map_err(|_| format!("bad key: {key}"))?;
        self.with_shard(shard, |s| {
            let mut req = FacetRequestBuilder::new(key).limit(limit).exact(true);
            if let Some(f) = filter {
                req = req.filter(f);
            }
            let response = s.facet(req.build()).map_err(|e| e.to_string())?;
            Ok(Value::Array(
                response
                    .hits
                    .into_iter()
                    .map(|hit| {
                        let value = match hit.value {
                            FacetValue::Keyword(k) => json!(k),
                            FacetValue::Int(i) => json!(i),
                            FacetValue::Bool(b) => json!(b),
                            FacetValue::Uuid(u) => json!(Uuid::from_u128(u).to_string()),
                        };
                        json!({"value": value, "count": hit.count})
                    })
                    .collect(),
            ))
        })
    }

    pub fn count(&self, shard: &str, filter: Option<Value>) -> Result<usize, String> {
        let filter = parse_filter(filter)?;
        self.with_shard(shard, |s| {
            let mut req = CountRequestBuilder::new().exact(true);
            if let Some(f) = filter {
                req = req.filter(f);
            }
            s.count(req.build()).map_err(|e| e.to_string())
        })
    }

    pub fn scroll(&self, shard: &str, limit: usize, offset: Option<String>, filter: Option<Value>) -> Result<Value, String> {
        let filter = parse_filter(filter)?;
        let offset = offset.map(|o| parse_id(&o)).transpose()?;
        self.with_shard(shard, |s| {
            let mut req = ScrollRequestBuilder::new()
                .limit(limit)
                .with_payload(WithPayloadInterface::Bool(true));
            if let Some(o) = offset {
                req = req.offset(o);
            }
            if let Some(f) = filter {
                req = req.filter(f);
            }
            let (records, next) = s.scroll(req.build()).map_err(|e| e.to_string())?;
            let points: Vec<Value> = records
                .into_iter()
                .map(|r| {
                    json!({
                        "id": id_json(&r.id),
                        "payload": r.payload.map(|p| Value::Object(p.0)).unwrap_or(Value::Null),
                    })
                })
                .collect();
            Ok(json!({"points": points, "next": next.as_ref().map(id_json)}))
        })
    }

    pub fn retrieve(&self, shard: &str, ids: Vec<String>) -> Result<Value, String> {
        let ids = ids.iter().map(|i| parse_id(i)).collect::<Result<Vec<_>, _>>()?;
        self.with_shard(shard, |s| {
            let records = s
                .retrieve(
                    RetrieveRequestBuilder::new(ids)
                        .with_payload(WithPayloadInterface::Bool(true))
                        .build(),
                )
                .map_err(|e| e.to_string())?;
            Ok(Value::Array(
                records
                    .into_iter()
                    .map(|r| {
                        json!({
                            "id": id_json(&r.id),
                            "payload": r.payload.map(|p| Value::Object(p.0)).unwrap_or(Value::Null),
                        })
                    })
                    .collect(),
            ))
        })
    }

    pub fn info(&self, shard: &str) -> Result<Value, String> {
        let disk = dir_size(&self.shard_path(shard));
        self.with_shard(shard, |s| {
            let info = s.info().map_err(|e| e.to_string())?;
            let indexes: Vec<String> = info.payload_schema.keys().map(|k| k.to_string()).collect();
            Ok(json!({
                "shard": shard,
                "points": info.points_count,
                "indexed_vectors": info.indexed_vectors_count,
                "segments": info.segments_count,
                "payload_indexes": indexes,
                "disk_bytes": disk,
                "vectors": {"dense": {"size": DIM, "distance": "cosine", "quantization": "int8"}, "bm25": {"modifier": "idf"}},
            }))
        })
    }

    pub fn optimize(&self, shard: &str) -> Result<bool, String> {
        self.with_shard(shard, |s| s.optimize().map_err(|e| e.to_string()))
    }

    // --------------------------- lifecycle / sync -------------------------

    /// Wipe a shard (demo reset).
    pub fn reset(&self, shard: &str) -> Result<(), String> {
        if !SHARDS.contains(&shard) {
            return Err(format!("unknown shard: {shard}"));
        }
        let mut shards = self.shards.lock().map_err(|e| e.to_string())?;
        drop(shards.remove(shard));
        let path = self.shard_path(shard);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
        let fresh = self.load_shard(shard)?;
        shards.insert(shard.to_string(), fresh);
        Ok(())
    }

    /// Download and apply a snapshot: full replaces the shard, partial merges changed segments.
    pub fn apply_snapshot(&self, shard: &str, url: &str) -> Result<Value, String> {
        self.with_shard(shard, |_| Ok(()))?;
        let tmp_root = self.root.join("tmp");
        fs::create_dir_all(&tmp_root).map_err(|e| e.to_string())?;
        let file = tmp_root.join(format!("{shard}.snapshot"));
        download(url, &file)?;

        let unpack = tempfile::Builder::new().tempdir_in(&tmp_root).map_err(|e| e.to_string())?;
        EdgeShard::unpack_snapshot(&file, unpack.path()).map_err(|e| e.to_string())?;
        let incoming = SnapshotManifest::load_from_snapshot(unpack.path(), None).map_err(|e| e.to_string())?;
        let path = self.shard_path(shard);

        let mut shards = self.shards.lock().map_err(|e| e.to_string())?;
        let current = shards.remove(shard).ok_or_else(|| format!("unknown shard: {shard}"))?;
        let full = incoming.is_empty();
        let result = if full {
            drop(current);
            clear_data(&path)
                .and_then(|_| move_data(unpack.path(), &path))
                .map_err(|e| e.to_string())
                .and_then(|_| EdgeShard::load(&path, None).map_err(|e| e.to_string()))
        } else {
            let manifest = current.snapshot_manifest().map_err(|e| e.to_string())?;
            drop(current);
            EdgeShard::recover_partial_snapshot(&path, &manifest, unpack.path(), &incoming)
                .map_err(|e| e.to_string())
        };
        let restored = match result {
            Ok(s) => s,
            Err(e) => {
                // Never leave the app without a knowledge shard.
                shards.insert(shard.to_string(), self.load_shard(shard)?);
                return Err(e);
            }
        };
        ensure_indexes(&restored, shard)?;
        let points = restored.info().map(|i| i.points_count).unwrap_or(0);
        shards.insert(shard.to_string(), restored);
        let _ = fs::remove_file(&file);
        Ok(json!({"mode": if full { "full" } else { "partial" }, "points": points}))
    }

}

impl EdgeState {
    // ------------------------- app records ("state") -------------------------

    pub fn doc_get(&self, name: &str) -> Result<Option<Value>, String> {
        let records = self.with_shard(STATE, |s| {
            s.retrieve(
                RetrieveRequestBuilder::new(vec![doc_id(name)])
                    .with_payload(WithPayloadInterface::Bool(true))
                    .build(),
            )
            .map_err(|e| e.to_string())
        })?;
        Ok(records.into_iter().next().and_then(|r| r.payload).and_then(|p| p.0.get("value").cloned()))
    }

    pub fn doc_set(&self, name: &str, value: Value) -> Result<(), String> {
        let valid = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if !valid {
            return Err(format!("invalid record name: {name}"));
        }
        let point = PointStruct::new(
            doc_id(name),
            Vectors::new_named(std::iter::empty::<(String, Vector)>()),
            json!({"name": name, "value": value}),
        );
        self.with_shard(STATE, |s| {
            s.update(UpdateOperation::PointOperation(PointOperations::UpsertPoints(
                PointInsertOperations::PointsList(vec![point.into()]),
            )))
            .map_err(|e| e.to_string())?;
            s.flush().map_err(|e| e.to_string())
        })
    }

    /// Segment manifest, sent to the cloud to request a partial snapshot.
    pub fn manifest(&self, shard: &str) -> Result<Value, String> {
        self.with_shard(shard, |s| {
            let manifest = s.snapshot_manifest().map_err(|e| e.to_string())?;
            serde_json::to_value(manifest).map_err(|e| e.to_string())
        })
    }
}

fn ensure_indexes(shard: &EdgeShard, name: &str) -> Result<(), String> {
    let existing: Vec<String> = shard
        .info()
        .map(|i| i.payload_schema.keys().map(|k| k.to_string()).collect())
        .unwrap_or_default();
    for (field, kind) in payload_indexes(name) {
        if existing.iter().any(|e| e == field) {
            continue;
        }
        let schema: PayloadFieldSchema = serde_json::from_value(json!(kind)).map_err(|e| e.to_string())?;
        let field_name: JsonPath = field.parse().map_err(|_| format!("bad field: {field}"))?;
        shard
            .update(UpdateOperation::FieldIndexOperation(FieldIndexOperations::CreateIndex(
                CreateIndex { field_name, field_schema: Some(schema) },
            )))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn download(url: &str, dest: &Path) -> Result<(), String> {
    let response = ureq::get(url).call().map_err(|e| format!("download failed: {e}"))?;
    let mut reader = response.into_body().into_reader();
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    std::io::copy(&mut reader, &mut file).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}
