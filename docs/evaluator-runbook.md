# Evaluator runbook

## What is live

The Android app stores visit notes in Qdrant Edge on the phone. Family registry fields sync between enrolled phones assigned to the same area. Cloud Run uses the `eval1_` Qdrant collections; startup creates empty collections and starter guidance only. Earlier demo collections remain separate. The dashboard is open during evaluation (no token). There is no public simulate or reset action.

Use **fictional people** for the evaluation. The current device store has no at-rest encryption or staff identity management. Each phone registers itself on first setup and receives a token bound to that device and area (registrations are limited per network per hour; set `OPEN_ENROLLMENT=false` to require a shared code instead). Family names, member names, house references and optional phone numbers are in the cloud registry for same-area sync. Visit text and exact GPS stay local; symptom signals carry a device ID and coarse area. Doctor questions require the worker to edit and check a preview; automatic text replacement cannot guarantee anonymity. Do not enter real patient identities during testing.

## Prepare

1. Install the new Android APK on both phones. For a clean trial, clear older Sahayak app data first; old sample records and settings are local to the phone.
2. Have internet for first setup so each phone can enroll and download the offline embedding model. The work area is picked from GPS (nearest area within 30 km); away from our areas, or without location, it defaults to **Mumbai · Dharavi**, so remote evaluators end up in the same area. Keep both phones in the same area. No account or code is needed. The app opens in Hindi; the **EN / हि** button in the header switches language.
3. Open the [district dashboard](https://sahayak-cloud-362605925833.asia-south1.run.app/dashboard/). The new workspace should show zero families, zero signals and no devices until a phone syncs.
4. Keep the actual Android app visible for the video. The browser preview uses a stand-in store and cannot demonstrate Qdrant Edge.

The admin token and enrollment code (used only when `OPEN_DASHBOARD` or `OPEN_ENROLLMENT` is switched off) are stored in Google Secret Manager (`sahayak-enroll-code` and `sahayak-admin-token`) in project `codecubileproject`. Authorized project members can retrieve them with `gcloud secrets versions access latest --secret=SECRET_NAME --project=codecubileproject`. Do not put either in GitHub variables or an APK.

## Ten-minute demo journey

1. On phone A, tap **Try with a sample family** on Home (a fictional pregnant mother, a 3-year-old and the father), or **Add family** to enter your own fictional family and optionally tap **Use phone location**. A woman can be marked pregnant from the family screen. If permission or GPS fails, the selected area's approximate location is used; no random coordinates are invented. The GPS coordinate stays on phone A.
2. Select **Work offline**, or turn on airplane mode. Record a Hindi/Hinglish visit for the new member, such as `बच्चे को बुखार और दाने हैं, आज ANM को बताया`. Confirm the local tags, search for `fever rash child`, and show the queued outbox on Sync and the Qdrant Edge shards under the chip icon ("Under the hood"). Show a second visit with a negation, such as `आज बुखार नहीं है`, to check that it is not counted as fever.
3. Reconnect and switch back to **Auto**. Tap Sync. Confirm that the outbox clears and a new symptom report appears in the dashboard feed. On a slow connection the app sends urgent signals first by itself.
4. On the dashboard, pick an item in **Fill in a sample to try** (for example the dengue advisory or the COVID-19 answer) and press **Publish**. Tap Sync on phone A: a progress strip shows while it downloads, then Home lists it under "New from the district". Turn on airplane mode and open it, or ask about it in 📖 search; it answers offline. A single report is **not** called an outbreak. Without history, three fever-with-rash or jaundice reports (five diarrhoea) in one area in a week raise a "cluster — verify" alert that reaches every phone in and near the area; with history, a rise against the weekly baseline is flagged. Clinical alerts are decision support for human review.
5. Set up phone B in the **same area** and sync it; it should receive the family entered on A. To demonstrate a real conflict, disconnect both phones, edit the **same family contact name** on each, sync A, then sync B. B should show both values and let the worker choose. Different fields should merge without a conflict.

If the native snapshot update fails, the app falls back to guidance documents and logs the reason in Activity. Report which route actually worked; do not claim a snapshot from a browser preview.

## What to measure with reviewers

Ask a few ASHA or health-domain reviewers to try de-identified scenarios. Record: time to add a family and visit, task completion without coaching, missed or incorrect syndrome tags, top-five search relevance, sync/retry success, whether guidance is understandable, and any privacy or clinical concern. Keep the original phrasing of failed searches and tags so rules and evaluation queries can be improved. Do not put identifiable patient data in logs, screenshots or the submission video.

To improve tagging and search, collect a small labelled set of real (de-identified) phrasing from consenting reviewers and compare expected tags and search hits before and after each change. The synthetic benchmark notes in `eval/` are never loaded into the app or the cloud.
