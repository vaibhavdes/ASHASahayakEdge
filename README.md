# Sahayak Edge

An offline-first Android app for ASHA health workers, built on **Qdrant Edge**.

- She speaks or types her visit notes in Hindi, Hinglish or English.
- The phone understands them, keeps them searchable with no network, and tells her whom to visit.
- The district receives symptom reports and can send guidance back to phones. Visit notes stay local; the family registry syncs only between enrolled phones in the same area.

Code Cubicle 6.0 · Problem Statement 03: AI-Powered Edge Memory & Intelligence Platform

![System overview](docs/architecture.svg)

## The problem

An ASHA is the first health worker most rural families see. There are over 10 lakh of them, each looking after about a thousand people [1]. Their tools work against them:

- **Too many apps, entered twice.** A March 2026 report followed an ASHA who manages seven apps plus WhatsApp groups and spreadsheets, enters everything on paper and again online, and spends 20–30 minutes per person on slow phones and networks, paying for her own data [1].
- **Outbreaks are reported late.** Of the measles outbreaks reported to IDSP from 2019 to 2023, 44% arrived more than a week after onset, and most reports lacked the patients' age or vaccination status [2].
- **The need is greatest where connectivity is worst.** Maternal mortality is 87 per lakh live births nationally but 154 in Uttar Pradesh and 135 in Madhya Pradesh [3]. Rural India has 48 internet subscriptions per 100 people, against 127 in cities [4].

What she needs is a memory that lives on the phone, understands how she writes, and shares only what the health system needs.

## What it does

**On the phone, fully offline**
- **Speak or type a visit.** Hindi speech is converted to text by Android's on-device recogniser. Notes are tagged as they are written (fever with rash, diarrhoea, pregnancy or newborn danger sign), including "no fever"-style negation.
- **Search by meaning.** "garbhvati mahila BP pichle hafte" becomes filters (pregnant, last 7 days) plus a meaning search. "Similar past cases" works on any visit.
- **Know whom to visit today.** A short list built from her own records: danger signs to follow up, recent fever, pregnancies close to delivery or overdue a check, babies due for immunisation.
- **Guidance that listens and speaks.** Starter reference examples and newly published answers, with a "Listen" button that reads them aloud. A danger sign opens a relevant protocol immediately; clinical decisions require human review.
- **Spot a rise before any sync.** The phone compares its village's cases this week with the past six weeks and flags an unusual rise with a visit list.
- **Reports fill themselves.** The weekly IDSP S-form and a monthly summary are counted from existing notes, so she only checks and submits.

**Between phone and district**
- **Every record has a rule for where it may go:**
  - visit notes stay on the phone;
  - family and member names, contact details and house references go to the assigned-area registry;
  - symptom reports carry a device ID and coarse area, with danger signs sent first.
- **Sync happens by itself** when the network returns, when the app opens, and every ten minutes. When the phone detects a slow connection, urgent signals go first; workers can also choose Work offline.
- **Corrections propagate.** Editing or deleting a visit withdraws its already-sent signal by a random ID, so counts are fixed without identifying anyone.
- **Conflicts are resolved, not overwritten.** If the ASHA and her ANM change the same household field offline, both values are shown and she chooses. Different fields merge on their own.
- **Ask a doctor.** The worker edits and checks a proposed redacted question before sending. Automatic replacement is best effort and cannot guarantee removal of identity details.

**For the district**
- **A surveillance radar** checks each area against its own past eight weeks when sufficient history exists, and finds similar signals across areas with Qdrant's distance-matrix search. Alerts ask for human review.
- **Alerts reach every village within 6 km.** On each phone, an alert becomes a list of whom to visit, built from records the district never sees: for example, children near a case with no measles vaccine on record.
- **A dashboard** shows the village map, live signals, received reports and field questions, and which phones have each alert and guidance version.
- **Published guidance** reaches phones as a Qdrant partial snapshot.

## How it works

**Qdrant is the only database, on the phone and in the cloud.**
- **On the phone, three Qdrant Edge shards:**
  - `memory` holds visits and is never uploaded;
  - `knowledge` holds district guidance and alerts, and the phone only reads it;
  - `state` holds app records (households, outbox, settings, activity) as payload-only points.

  `memory` and `knowledge` are the privacy boundary.
- **In the cloud, Qdrant Cloud holds everything:** symptom signals and guidance as vector collections, and the area-scoped registry, device enrollments, alerts, reports and questions as payload-only collections. The evaluator workspace uses `eval1_` collections; older demo records stay separate.

**Recording a visit.**
1. The note is normalised: "bukhar" also reads as "fever"; "खसरा का टीका" (measles vaccine) is recognised as a vaccine, not a rash.
2. It is tagged, and embedded on the phone together with its tags.
3. It is stored with a BM25 vector and indexed details (village, ward, date, age band, syndromes, activities).
4. If it has a syndrome, a symptom signal is queued. The signal has a random ID, area, age band, week and device ID. The cloud replaces any client sentence with a fixed template before storing its vector; the note is never uploaded.

**Searching.** Qdrant Edge runs dense and BM25 search with the filters applied (ACORN when several narrow filters combine), fuses the two with weighted RRF, and boosts recent visits with a decay formula. MMR is available for varied results.

**Syncing.**
- **Push:** the outbox in priority order, plus retractions and reports.
- **Pull:** alerts, household changes and doctors' answers.
- **Guidance:** the phone sends its snapshot manifest and receives only the changed segments.
- **Ack:** the phone reports what it now holds.

**Answer safety.** Short Hinglish questions share framing ("... ko ... kya karein?") that can make unrelated questions look alike: snake bite scored 0.86 against hiccups. Framing words are removed before matching, the match must reach 0.70, and both questions must share a medical term (or reach 0.80 when there is none).

### Qdrant features used

| Where | Feature | Purpose |
|---|---|---|
| Phone | Qdrant Edge 0.8 in-process, three shards | Private memory, district knowledge and app state |
| Phone | Named dense vector + built-in BM25 (multilingual, no stemming, IDF) | Meaning and exact words (medicines, BP readings, names) |
| Phone | Prefetch + weighted RRF, Formula with exp decay, MMR, recommend | Hybrid ranking, recency, variety, similar cases |
| Phone | Payload indexes, filters, ACORN, facets, count | Village/ward/date/pregnancy filters and weekly summaries |
| Phone | int8 quantisation, on-disk storage, 4 MB WAL, bulk import in batches of 64 | Low-RAM phones |
| Phone | Snapshot unpack, full and partial recovery, manifest | District guidance updates |
| Phone | Payload-only points in a `state` shard | App records without a second database |
| Cloud | Qdrant Cloud collections with the same layout, shard and partial snapshots | Guidance packaged for phones |
| Cloud | Distance-matrix API | Similar signals across villages |
| Cloud | Payload-only collections, filters, count, scroll | Registry, alerts, devices, reports, questions and weekly counts, with no SQL |

Qdrant's edge sync guide describes four patterns: snapshot initialisation, partial snapshots, dual write, and an async queue. We use all four, and add two the guide doesn't cover: field-level conflict handling and retraction of synced data.

## Results

**Search** (`eval/bench.py`): 318 synthetic visit notes in three languages and 32 queries, 8 of them paraphrases that share no words with any note, run on Qdrant Edge.

| Setup | Precision@5 | MRR | Paraphrases P@5 |
|---|---|---|---|
| Meaning only, raw notes | 0.67 | 0.73 | 0.75 |
| Keywords only (BM25), normalised | 0.79 | 0.83 | 0.33 |
| Hybrid 2:1, normalised | 0.86 | 0.92 | 0.70 |
| **Hybrid 2:1, normalised note + tags (shipped)** | **0.93** | **0.97** | **0.78** |

- The biggest gains came from the input, not the model. The Hindi/Hinglish lexicon, and embedding each note together with its tags, matter most. That matches Qdrant's e-commerce search write-up, where adding the category to the product title helped every model.
- Keyword search alone fails on paraphrases, so we keep both kinds of search.
- The measured Qdrant query portion ran in under a millisecond on a laptop; this excludes embedding and phone UI time.
- The data is synthetic, so real-world gains will be smaller.

**Answer cache.** On questions the system had never seen, right answers scored 0.76–0.98, and the closest wrong one scored 0.69 (then blocked by the medical-term check).

**Sync.** Compressing signal vectors to int8 cut each signal to about a tenth of its size. A test sync of 19 signals, with alerts and household updates, took under a second.

## Technology

| Layer | Choice |
|---|---|
| App | Tauri 2 (Android), React 19 + TypeScript + Tailwind, Rust core with `qdrant-edge` 0.8 |
| On-device model | paraphrase-multilingual-MiniLM-L12-v2, int8 ONNX (~118 MB), via transformers.js and bundled ONNX Runtime Web |
| Voice | Android SpeechRecognizer (on-device) and TextToSpeech, through our Kotlin plugin |
| Cloud | Python, FastAPI, Qdrant Cloud, fastembed (same model), `qdrant-edge-py` for identical BM25 |
| Delivery | GitHub Actions builds the APK into Releases; the cloud runs on Google Cloud Run |

**Why these choices**
- **Qdrant Edge and Qdrant Cloud as the only databases:** hybrid search, filters, facets, quantisation and snapshots that match on both sides. Plain records fit as payload-only points, so we don't need a second database to keep in sync.
- **Tauri:** Qdrant Edge is a Rust library and Tauri is Rust underneath, while the screens are written in React. React Native would have needed the same Rust library plus a heavier toolchain.
- **ONNX in the web view:** it runs on any Android phone without a GPU or Google services. The int8 build is a quarter of the full size, and it produces the same vectors as the cloud.
- **Android's own speech engine:** it gives offline Hindi without shipping another large model.
- **No LLM:** ASHAs use low-cost phones. Rules plus embeddings are fast, predictable and explainable, which matters for health advice.

## Problem statement coverage

| PS03 goal | Sahayak Edge |
|---|---|
| Searchable semantic memory on the device | Visits and guidance in Qdrant Edge shards, dense + BM25 |
| Low-latency vector and hybrid search offline | Hybrid, filtered, recency-aware search in under a millisecond |
| Decide what stays local and what syncs | Per-record sync rules; automatic slow-network priority |
| Intermittent connectivity | Everything works offline; automatic sync with a priority queue |
| Sync with Qdrant Server | Signals, knowledge and snapshots with Qdrant Cloud; delivery acks |
| Evolving memory and conflicts | Edits with retraction, versioned guidance with expiry, field-level merge |
| Interface for memory, search, sync and activity | Home, Search, Sync and Inspector screens, plus the district dashboard |
| A meaningful edge-to-cloud workflow | Device-linked symptom reports → district radar → reviewed alerts → area visit lists; field questions → approved answers |

## Running it

**Cloud (local)**
```bash
cd cloud
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env    # QDRANT_URL and QDRANT_API_KEY for Qdrant Cloud
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```
- The dashboard opens at `http://localhost:8000` after entering `ADMIN_TOKEN`. Startup creates empty collections and starter guidance only. `ENROLL_CODE` is required to enroll each phone.
- Without Qdrant Cloud keys it uses local Qdrant; guidance then goes to phones as documents rather than snapshots.

**Cloud (Google Cloud Run)**
```bash
# In Google Cloud project codecubileproject, add the Qdrant Cloud database
# API key as an enabled version of Secret Manager secret sahayak-qdrant-api-key.
QDRANT_URL=https://YOUR-CLUSTER.cloud.qdrant.io ./cloud/deploy.sh
```
- A Qdrant Cloud cluster URL and database API key are required. Do not put the key in `cloud/.env` for deployment or commit it to Git. The deployment reads it from Secret Manager.
- The script targets `codecubileproject`, builds the image with Cloud Build (the model is baked in) and deploys one instance in `asia-south1`.
- Cloud Run accepts network traffic, but sync and guidance require a device token, and dashboard/admin APIs require a separate admin token. Enrollment uses a shared event code. Use fictional people for evaluation; this is not a production patient identity system.
- It prints the service URL. Use that URL as the app's district server.

See [Evaluator runbook](docs/evaluator-runbook.md) for the two-phone test, data boundaries, and demo video sequence.

**App in a browser** (for UI work)
```bash
cd app && npm install && npm run dev
```
Qdrant Edge only runs in the Android app, so the browser uses a stand-in store; everything else is real.

**Android**
```bash
cd app
npx tauri icon app-icon.png
npm run android:init
npm run android:dev
```
- Needs Rust with the `aarch64-linux-android` target, the Android SDK with NDK 27, and Java 17+.
- Every push to `main` also builds an APK into this repository's **Releases** page. The workflow points to the evaluator Cloud Run URL; the enrollment and admin codes are never baked into the APK.

## Limits and next steps
- **Real phones and real notes:** timings are from a laptop and the data is synthetic. Both need field testing, with consent.
- **Voice coverage:** on-device Hindi speech depends on the phone maker. A bundled Vosk model (~50 MB) would guarantee it everywhere.
- **Security:**
  - the app needs device enrolment, an authenticated sync API and encryption at rest;
  - the dashboard needs doctor logins;
  - an encrypted backup should protect notes if a phone is lost.
- **Government systems:** exchange data with U-WIN, RCH and ABHA through ABDM instead of adding another register.

## Data, credits and sources

All people, households and visits are synthetic (`data/generate.py`). Guidance texts are short summaries of public MoHFW and WHO material; each says when to refer. The app supports, and doesn't replace, clinical judgement.

**Built with:**
- [Qdrant Edge and Qdrant Cloud](https://qdrant.tech/edge/)
- [Tauri](https://tauri.app)
- [transformers.js](https://github.com/huggingface/transformers.js) and [ONNX Runtime](https://onnxruntime.ai)
- [fastembed](https://github.com/qdrant/fastembed)
- [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) (Apache-2.0)
- FastAPI, React, Tailwind CSS and lucide icons

**Sources**
1. "India's Digital Health Push Is Overworking Its Front-Line Women", New Lines Magazine, 31 Mar 2026. https://newlinesmag.com/reportage/indias-digital-health-push-is-overworking-its-front-line-women/
2. "Analysis of measles outbreaks reported to IDSP, India, 2019–2023", BMC Infectious Diseases, 18 Aug 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC13536584/
3. SRS Special Bulletin on Maternal Mortality in India 2022–24, Office of the Registrar General. https://censusindia.gov.in/nada/index.php/catalog/47151
4. "India crosses 1.09 billion internet users, but the rural digital divide persists", The Week, 23 Jun 2026 (TRAI data, March 2026). https://www.theweek.in/news/biz-tech/2026/06/23/india-telecom-growth-digital-divide.html
5. Qdrant Edge data synchronization patterns. https://qdrant.tech/documentation/edge/edge-data-synchronization-patterns/
