# syntax=docker/dockerfile:1

# ---- build stage: deps + weights (nothing here ships except what we COPY) ----
FROM python:3.12-slim AS builder
WORKDIR /app
RUN python -m venv /venv
ENV PATH=/venv/bin:$PATH PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# CPU-only torch first: the default linux/amd64 wheel bundles CUDA (~2 GB of
# GPU libraries we'd never use on a free-tier CPU node).
RUN pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt
# Weights are baked into the image at build time, checksum-verified: the pod
# never downloads anything at startup, and the image SHA pins the model.
COPY scripts/download_model.py scripts/
RUN python scripts/download_model.py

# ---- runtime stage ----
FROM python:3.12-slim
# OpenCV (pulled in by ultralytics) needs these shared libs at import time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=builder /venv /venv
COPY --from=builder /app/models models
COPY app app
ENV PATH=/venv/bin:$PATH PYTHONUNBUFFERED=1 YOLO_CONFIG_DIR=/tmp/ultralytics \
    MODEL_PATH=/app/models/car-damage.pt
USER 10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
