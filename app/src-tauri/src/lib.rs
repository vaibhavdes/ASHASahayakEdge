mod edge;

use edge::{EdgeState, PointIn, QueryIn};
use serde_json::Value;
use tauri::{Manager, State};

type Res<T> = Result<T, String>;

#[tauri::command]
async fn edge_upsert(edge: State<'_, EdgeState>, shard: String, points: Vec<PointIn>) -> Res<usize> {
    edge.upsert(&shard, points)
}

#[tauri::command]
async fn edge_set_payload(edge: State<'_, EdgeState>, shard: String, id: String, patch: Value) -> Res<()> {
    edge.set_payload(&shard, &id, patch)
}

#[tauri::command]
async fn edge_delete(edge: State<'_, EdgeState>, shard: String, ids: Vec<String>) -> Res<()> {
    edge.delete(&shard, ids)
}

#[tauri::command]
async fn edge_query(edge: State<'_, EdgeState>, shard: String, query: QueryIn) -> Res<Value> {
    edge.query(&shard, query)
}

#[tauri::command]
async fn edge_similar(
    edge: State<'_, EdgeState>,
    shard: String,
    id: String,
    filter: Option<Value>,
    limit: usize,
) -> Res<Value> {
    edge.similar(&shard, &id, filter, limit)
}

#[tauri::command]
async fn edge_facet(
    edge: State<'_, EdgeState>,
    shard: String,
    key: String,
    filter: Option<Value>,
    limit: usize,
) -> Res<Value> {
    edge.facet(&shard, &key, filter, limit)
}

#[tauri::command]
async fn edge_count(edge: State<'_, EdgeState>, shard: String, filter: Option<Value>) -> Res<usize> {
    edge.count(&shard, filter)
}

#[tauri::command]
async fn edge_scroll(
    edge: State<'_, EdgeState>,
    shard: String,
    limit: usize,
    offset: Option<String>,
    filter: Option<Value>,
) -> Res<Value> {
    edge.scroll(&shard, limit, offset, filter)
}

#[tauri::command]
async fn edge_retrieve(edge: State<'_, EdgeState>, shard: String, ids: Vec<String>) -> Res<Value> {
    edge.retrieve(&shard, ids)
}

#[tauri::command]
async fn edge_info(edge: State<'_, EdgeState>, shard: String) -> Res<Value> {
    edge.info(&shard)
}

#[tauri::command]
async fn edge_optimize(edge: State<'_, EdgeState>, shard: String) -> Res<bool> {
    edge.optimize(&shard)
}

#[tauri::command]
async fn edge_reset(edge: State<'_, EdgeState>, shard: String) -> Res<()> {
    edge.reset(&shard)
}

#[tauri::command]
async fn edge_apply_snapshot(edge: State<'_, EdgeState>, shard: String, url: String, token: String) -> Res<Value> {
    edge.apply_snapshot(&shard, &url, &token)
}

#[tauri::command]
async fn edge_manifest(edge: State<'_, EdgeState>, shard: String) -> Res<Value> {
    edge.manifest(&shard)
}

#[tauri::command]
async fn store_get(edge: State<'_, EdgeState>, name: String) -> Res<Option<Value>> {
    edge.doc_get(&name)
}

#[tauri::command]
async fn store_set(edge: State<'_, EdgeState>, name: String, value: Value) -> Res<()> {
    edge.doc_set(&name, value)
}

#[tauri::command]
async fn store_clear(edge: State<'_, EdgeState>) -> Res<()> {
    edge.reset("state")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_voice::init())
        .setup(|app| {
            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_geolocation::init())?;
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(EdgeState::open(&dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            edge_upsert,
            edge_set_payload,
            edge_delete,
            edge_query,
            edge_similar,
            edge_facet,
            edge_count,
            edge_scroll,
            edge_retrieve,
            edge_info,
            edge_optimize,
            edge_reset,
            edge_apply_snapshot,
            edge_manifest,
            store_get,
            store_set,
            store_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sahayak Edge");
}
