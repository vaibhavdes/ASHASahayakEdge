#!/usr/bin/env bash
# Deploy the district cloud to Cloud Run (Mumbai region). Run from anywhere:
#   QDRANT_URL=https://YOUR-CLUSTER.cloud.qdrant.io ./cloud/deploy.sh
# The database API key is read by Cloud Run from Secret Manager.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT=codecubileproject
REGION=asia-south1
IMAGE="$REGION-docker.pkg.dev/$PROJECT/sahayak/cloud:latest"
SECRET=sahayak-qdrant-api-key
ENROLL_SECRET=sahayak-enroll-code
ADMIN_SECRET=sahayak-admin-token
COLLECTION_PREFIX=eval1_
SERVICE_ACCOUNT="sahayak-cloud@$PROJECT.iam.gserviceaccount.com"

if [[ -z "${QDRANT_URL:-}" ]]; then
  echo "Set QDRANT_URL to your Qdrant Cloud cluster URL before deploying." >&2
  exit 1
fi
for required in "$SECRET" "$ENROLL_SECRET" "$ADMIN_SECRET"; do
  if [[ -z "$(gcloud secrets versions list "$required" --project "$PROJECT" --filter='state:ENABLED' --format='value(name)' --limit=1)" ]]; then
    echo "Add an enabled version to Secret Manager secret $required before deploying." >&2
    exit 1
  fi
done

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$PROJECT"
gcloud artifacts repositories describe sahayak --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create sahayak --project "$PROJECT" --repository-format docker --location "$REGION"

gcloud builds submit --project "$PROJECT" --config cloud/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE"

# All data lives in Qdrant Cloud; one instance keeps the pull sequence counter simple.
gcloud run deploy sahayak-cloud \
  --image "$IMAGE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --service-account "$SERVICE_ACCOUNT" \
  --memory 2Gi --cpu 1 \
  --min-instances 1 --max-instances 1 \
  --set-env-vars "QDRANT_URL=$QDRANT_URL,COLLECTION_PREFIX=$COLLECTION_PREFIX" \
  --set-secrets "QDRANT_API_KEY=$SECRET:latest,ENROLL_CODE=$ENROLL_SECRET:latest,ADMIN_TOKEN=$ADMIN_SECRET:latest"

gcloud run services describe sahayak-cloud --project "$PROJECT" --region "$REGION" --format "value(status.url)"
