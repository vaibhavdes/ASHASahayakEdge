# Build from the repository root (the service reads ../data):
#   gcloud builds submit --config cloud/cloudbuild.yaml
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 MODEL_CACHE=/models PORT=8080
WORKDIR /srv/cloud

COPY cloud/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY data /srv/data
COPY cloud /srv/cloud

# Bake the embedding model into the image so cold starts don't download it.
RUN python -c "from app.embed import dense; dense(['warm up'])"

CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
