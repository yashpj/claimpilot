# ml-service

FastAPI wrapper around an Ultralytics YOLO car-damage detector.
`POST /detect` (multipart `files`, 1-6 images) returns, per image:
`{ width, height, detections: [{ class, confidence, bbox: [x1,y1,x2,y2] }] }`
plus `model_version`.

Probes: `/health/live`, `/health/ready`. Prometheus: `/metrics`.

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/python scripts/download_model.py      # checksum-verified weights
.venv/bin/uvicorn app.main:app --port 8010      # 8000 is often taken locally
.venv/bin/python -m pytest -q
```

Model: `vineetsarpal/yolov11n-car-damage` (Apache-2.0; trained on the Roboflow
Universe "Automobile Damage Detection" dataset; 14 location-aware classes).
Override with `MODEL_URL` / `MODEL_SHA256` / `MODEL_VERSION`. See DECISIONS.md
for why this is YOLO11n rather than YOLOv8.
