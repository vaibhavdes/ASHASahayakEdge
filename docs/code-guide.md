# Code guide

How the code is organised, what each part does, and how a feature travels through it. Read the [README](../README.md) first for what the product does; this file is for finding your way around the code.

## The big picture

There are two programs and they share a small set of data files.

- **The Android app** (`app/`). A React UI running inside Tauri, with a Rust core that embeds **Qdrant Edge**. Everything the ASHA does works offline on the phone.
- **The district cloud** (`cloud/`). A FastAPI service on Google Cloud Run, with **Qdrant Cloud** as its only database, plus a one-page dashboard.
- **Shared data** (`data/`). Areas, the Hindi/Hinglish vocabulary and the starter guidance, read by both.

The phone talks to the cloud only through the sync API (`/v1/...`). The diagram in [architecture.svg](architecture.svg) shows the whole system on one page.

## Folder map

```
.
├── app/                      Android app (Tauri 2)
│   ├── src/                  React + TypeScript UI and app logic
│   │   ├── App.tsx           Shell: header, bottom tabs, screen routing, first-run checks
│   │   ├── screens/          One file per screen
│   │   ├── components/       Reusable UI pieces
│   │   └── lib/              App logic: storage, search, tagging, sync, language …
│   └── src-tauri/            Native side
│       ├── src/edge.rs       Qdrant Edge: the phone's only database
│       ├── src/lib.rs        Commands the UI can call (bridge to edge.rs)
│       ├── plugins/voice/    Our Kotlin plugin: Android speech-to-text and text-to-speech
│       └── tauri.conf.json   App id, window, bundle settings
├── cloud/                    District service
│   ├── app/                  FastAPI code (API, radar, storage)
│   ├── dashboard/index.html  District dashboard (single page, no build step)
│   ├── tests/                Backend test (two phones, empty workspace, radar, open access)
│   ├── Dockerfile, cloudbuild.yaml, deploy.sh   Build and deploy to Cloud Run
│   └── scripts/fetch_model.py   Optional model mirror (not used by the current app)
├── data/                     Files the app and cloud actually run on
│   ├── villages.json         Work areas with coordinates
│   ├── lexicon.json          Hindi/Hinglish terms, syndromes, signal wording
│   ├── knowledge.json        Starter guidance (protocols + approved answers)
│   └── normalize.py          Python twin of app/src/lib/normalize.ts
├── eval/                     Search benchmark (synthetic data, never loaded into the app)
├── docs/                     Architecture diagram, evaluator runbook, this guide
└── .github/workflows/android.yml   Builds the APK on every push to main
```

## The app

### How the layers fit

```
screens/ and components/      what the worker sees
        │  call
lib/*.ts                      app logic (memory, knowledge, households, sync …)
        │  call
lib/bridge.ts                 one interface to the device
        │  Tauri invoke            (in a desktop browser: an in-memory stand-in)
src-tauri/src/lib.rs          commands
        │
src-tauri/src/edge.rs         Qdrant Edge shards on the phone's disk
```

The AI model runs in a separate web worker (`lib/embed.worker.ts`) so the screen never freezes while it works.

### Screens (`app/src/screens/`)

| File | Screen | What it does |
|---|---|---|
| `Setup.tsx` | First run | Language, name, area (from GPS), registers the phone, downloads the model once, loads starter guidance |
| `Home.tsx` | Home | Greeting, sync status, "new from the district", unusual rise in the village, district alerts, today's visits, week summary, recent visits |
| `Households.tsx` | Families | List and search families; empty phone shows the start card |
| `AddFamily.tsx` | Add family | Family + first member (pregnant tick for women), optional GPS |
| `HouseholdDetail.tsx` | One family | Editable fields, members (mark pregnant), visit history, edit/delete a visit, similar past cases |
| `NewVisit.tsx` | Record a visit | Choose member, speak or type, live tags, save; danger result screen; "what is sent" preview |
| `Search.tsx` | Search | Patients tab (hybrid search with filter chips) and Guidance tab (ask a question, ask a doctor). `Guidance` is also opened from the 📖 header button |
| `Plans.tsx` | Visit lists | What a district alert or a local rise means for this village; the full "today" list |
| `Reports.tsx` | Reports | Weekly S-form and monthly summary, counted from visits; submit counts only |
| `Sync.tsx` | Sync | Network mode, sync button, queue by priority, conflicts to resolve |
| `Inspector.tsx` | Under the hood | Shard point counts, segments, indexes, first points, activity log, settings, voice setup |

### Components (`app/src/components/`)

| File | Purpose |
|---|---|
| `ui.tsx` | Buttons, cards, badges, segmented control, progress bar, the bilingual `Bi` label |
| `StartCard.tsx` | "Add family" / "Try with a sample family" for an empty phone |
| `TaskList.tsx` | A visit list (today's work, alert plans) with done ticks |
| `VoiceButton.tsx`, `VoiceSetup.tsx` | Speak-to-type button and the offline Hindi voice setup card |
| `ListenButton.tsx` | Reads guidance aloud |
| `SettingsCard.tsx` | Server address and name (in Under the hood) |

### App logic (`app/src/lib/`), grouped by job

**Storage and device**

| File | Purpose |
|---|---|
| `bridge.ts` | The single interface to the device: upsert, query, scroll, snapshot, store get/set. In a browser it swaps in a stand-in store so screens can be developed without a phone |
| `settings.ts` | Phone settings (name, area, token, language, sync state), kept in the `state` shard |
| `events.ts`, `hooks.ts` | Tiny change-notification system; `useData` reloads a screen when its topic changes |
| `filters.ts`, `types.ts` | Qdrant filter builders and shared types |

**Understanding notes**

| File | Purpose |
|---|---|
| `normalize.ts` | Adds canonical terms to a note ("bukhar" → fever), handles "bukhar nahi" negation, strips question framing. Must match `data/normalize.py` |
| `tagger.ts` | Tags a note with syndromes: lexicon rules first, then similarity to prototype sentences (skipped for routine notes) |
| `embedder.ts`, `embed.worker.ts` | Loads the multilingual MiniLM model (int8 ONNX) once and turns text into 384-number vectors |
| `queryParser.ts` | Turns "garbhvati mahila pichle hafte" into filters (pregnant, last 7 days) plus the remaining search words |

**Features**

| File | Purpose |
|---|---|
| `memory.ts` | Visits in the `memory` shard: add, edit, delete (with signal withdrawal), hybrid search, similar cases, week summary |
| `households.ts` | Family records with a version per field; create (incl. the sample family), edit, merge from the registry, resolve conflicts |
| `knowledge.ts` | The `knowledge` shard: guidance search, approved-answer matching with safety checks, alerts, ask-a-doctor |
| `starter.ts` | Loads the bundled guidance into an empty phone; knows which ids are built in |
| `plans.ts` | Builds visit lists from local records (danger follow-ups, fever, pregnancies, vaccines, alert plans) |
| `triage.ts` | This week vs the previous six in the village: the "unusual rise" card |
| `reports.ts` | Counts for the S-form and monthly summary |
| `policy.ts` | What may leave the phone and in what shape (builds the name-free signal) |
| `location.ts`, `villages.ts` | GPS, nearest work area, the area list |
| `voice.ts` | Speech in and out through the voice plugin (Web Speech in a browser) |
| `i18n.ts` | Hindi/English: `tr(hi, en)` returns the current language |
| `activity.ts`, `time.ts`, `nav.ts` | Activity log, date helpers, screen navigation |

**Sync**

| File | Purpose |
|---|---|
| `outbox.ts` | Queue of items to send, one per record id, highest priority first |
| `sync.ts` | One sync round: push the queue, pull alerts/family changes/answers, update guidance by snapshot (keeping alerts), acknowledge. Also tracks "new from the district" |
| `autosync.ts` | Runs sync when the app opens, when the network returns and every 10 minutes; optimises the shards once a day |

### Native side (`app/src-tauri/`)

- **`src/edge.rs`** opens three Qdrant Edge shards in the app's data folder:
  - `memory`: visits (dense vector + BM25, payload indexes). Never uploaded.
  - `knowledge`: guidance and alerts (dense + BM25). Replaced by district snapshots; read-only for the worker.
  - `state`: app records (settings, households, outbox, activity) as payload-only points, so there is no second database.

  It implements hybrid query (prefetch + weighted RRF, decay formula, MMR), similar cases, facets, count, scroll, optimise, reset, snapshot apply (full or partial) and the snapshot manifest.
- **`src/lib.rs`** exposes those as Tauri commands (`edge_query`, `edge_apply_snapshot`, `store_get` …) and registers the voice and geolocation plugins.
- **`plugins/voice/`** is our Tauri plugin. `VoicePlugin.kt` wraps Android's on-device speech recogniser and text-to-speech; `src/lib.rs` is its Rust side.

## The cloud

### API (`cloud/app/main.py`)

| Endpoint | Who calls it | Purpose |
|---|---|---|
| `GET/POST /v1/enroll` | App setup | Registers a phone and returns its own token (open enrollment, limited per network) |
| `POST /v1/sync/push` | App sync | Signals, family changes, reports, questions, withdrawals. Runs the radar afterwards |
| `GET /v1/sync/pull` | App sync | Alerts for the area, others' family changes, doctors' answers, guidance version |
| `POST /v1/sync/ack` | App sync | What the phone now holds (shown on the dashboard) |
| `GET /v1/knowledge/docs`, `/snapshot`, `POST /partial-snapshot`, `GET /snapshot-file/{name}` | App sync | Guidance as documents (fallback), full shard snapshot, or a partial snapshot built from the phone's manifest |
| `POST /v1/admin/knowledge` | Dashboard | Publish guidance (bumps the version) |
| `GET /v1/admin/questions`, `POST .../answer` | Dashboard | Field questions and doctors' answers |
| `GET /v1/dashboard/summary` | Dashboard | Everything the dashboard shows |
| `/dashboard/`, `/docs` | Browser | The dashboard page and the automatic API docs |

At startup it creates any missing collections and publishes the starter guidance when its version has changed.

### Other cloud modules

| File | Purpose |
|---|---|
| `config.py` | Settings from environment (Qdrant URL, collection prefix, open enrollment/dashboard, radar thresholds); loads `data/` files |
| `store.py` | Vector collections in Qdrant Cloud: `signals` (for the radar) and `knowledge` (same layout as the phone shard, source of snapshots) |
| `db.py` | Payload-only collections used like tables: `registry`, `alerts`, `devices`, `reports`, `questions`, `guidance_docs`, `meta`, `device_auth` |
| `registry.py` | Field-by-field merge of family changes; conflicts when two phones changed the same field |
| `outbreak.py` | The radar: weekly z-score per area and syndrome, new-area cluster rule, similar signals across areas (distance matrix), danger notices; alerts go to areas within 6 km |
| `embed.py` | Same embeddings as the phone (fastembed MiniLM) and the same BM25 as Qdrant Edge |
| `dashboard/index.html` | Map, live signals, radar table, alerts with delivery, devices, reports, questions, guidance form |

All collection names start with `COLLECTION_PREFIX` (`eval1_` on the live service).

## Follow a feature through the code

**Recording a visit**
1. `NewVisit.tsx` collects the note (typed, or via `VoiceButton` → `voice.ts` → `VoicePlugin.kt`).
2. `memory.addVisit` normalises it (`normalize.ts`), tags it (`tagger.ts`, with pregnancy/newborn/child context from the family) and embeds it (`embedder.ts`).
3. The visit is stored in the `memory` shard (`bridge.ts` → `edge.rs`).
4. If it has a syndrome, `policy.buildSignal` makes a name-free signal and `outbox.enqueue` queues it (urgent if danger).
5. For a danger sign, `knowledge.ask` finds guidance to show immediately.

**Searching visits**: `Search.tsx` → `queryParser.ts` (filters) → `memory.searchVisits` → hybrid query in `edge.rs`.

**Asking a guidance question**: `Search.tsx` (`Guidance`) → `knowledge.ask`: approved-answer match with safety checks, plus related protocols above a relevance floor.

**Sync**: `autosync.ts` or the Sync button → `sync.runSync` → `/v1/sync/push` (server stores signals, merges families in `registry.py`, runs `outbreak.scan`) → `/v1/sync/pull` → guidance update if the version is newer → `/v1/sync/ack`.

**District guidance to phones**: dashboard form → `POST /v1/admin/knowledge` (embedded and stored by `store.upsert_knowledge`, version +1) → phone's next pull sees a newer version → `sync.updateKnowledge` fetches a partial snapshot → `edge.rs` applies it → `receiveGuidance` lists the new items on Home.

**An outbreak alert**: signals arrive → `outbreak.scan` compares with history or applies the cluster rule → `create_alert` for the area and neighbours within 6 km → phones pull it → `knowledge.storeAlerts` → Home shows it → `plans.ts` turns it into "who to visit" from local records.

**Two phones editing one family**: each edit stores the field's base version (`households.editField`) → server accepts or reports a conflict (`registry.apply_changes`) → `Sync.tsx` lets the worker keep hers or take theirs.

**First run**: `Setup.tsx` → `location.nearestArea` → `/v1/enroll` → `embedder.loadModel` → `starter.loadStarterKnowledge` → first sync fetches the district's current guidance.

## Where to change common things

| To change | Edit |
|---|---|
| Work areas | `data/villages.json` |
| Hindi/Hinglish words, syndromes, danger rules | `data/lexicon.json` (both app and cloud read it) |
| Starter guidance | `data/knowledge.json`, and raise its `version` so the cloud republishes it |
| Screen text | the screen file; every label is `tr("हिंदी", "English")` |
| Sync interval | `EVERY_MS` in `app/src/lib/autosync.ts` |
| Answer matching thresholds | top of `app/src/lib/knowledge.ts` |
| AI tagging threshold | `AI_THRESHOLD` in `app/src/lib/tagger.ts` |
| Radar thresholds | `ZSCORE_THRESHOLD`, `MIN_CASES`, `ALERT_RADIUS_KM` in `cloud/app/config.py`; `COLD_START_CASES` in `cloud/app/outbreak.py` |
| Open or closed access | `OPEN_ENROLLMENT`, `OPEN_DASHBOARD` in `cloud/deploy.sh` |
| Visit-list rules | `app/src/lib/plans.ts` |

## Build, test and deploy

| Task | Command |
|---|---|
| Check the app compiles | `cd app && npx tsc --noEmit` |
| UI in a browser | `cd app && npm run dev` (stand-in store, no Qdrant Edge) |
| Backend test | `cd cloud && .venv/bin/python -m unittest discover -s tests` |
| Search benchmark | `python eval/bench.py` |
| APK | push to `main`; GitHub Actions publishes it to the `latest-build` release |
| Cloud | `QDRANT_URL=… ./cloud/deploy.sh` (Cloud Build image, Cloud Run in `asia-south1`, keys from Secret Manager) |
