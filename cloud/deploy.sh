#!/usr/bin/env bash
# Deploy the district cloud to Cloud Run (Mumbai region). Run from anywhere:
#   ./cloud/deploy.sh
# Reads QDRANT_URL / QDRANT_API_KEY from cloud/.env.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT=$(gcloud config get-value project)
REGION=asia-south1
IMAGE="$REGION-docker.pkg.dev/$PROJECT/sahayak/cloud:latest"
set -a; [ -f cloud/.env ] && source cloud/.env; set +a

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud artifacts repositories describe sahayak --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create sahayak --repository-format docker --location "$REGION"

gcloud builds submit --config cloud/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE"

# All data lives in Qdrant Cloud; one instance keeps the pull sequence counter simple.
gcloud run deploy sahayak-cloud \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 2Gi --cpu 1 \
  --min-instances 1 --max-instances 1 \
  --set-env-vars "QDRANT_URL=${QDRANT_URL:-},QDRANT_API_KEY=${QDRANT_API_KEY:-}"

gcloud run services describe sahayak-cloud --region "$REGION" --format "value(status.url)"
