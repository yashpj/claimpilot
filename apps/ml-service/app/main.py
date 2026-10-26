import io
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse
from PIL import Image, UnidentifiedImageError
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from . import config
from .detector import Detector, YoloDetector

log = logging.getLogger("ml-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

INFERENCE_SECONDS = Histogram(
    "ml_inference_seconds", "Model inference time per image",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
)
REQUESTS = Counter("ml_detect_requests_total", "Detect requests", ["outcome"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tests inject a stub detector before startup; only load the real one if not.
    if getattr(app.state, "detector", None) is None:
        started = time.time()
        app.state.detector = YoloDetector(config.MODEL_PATH, config.MODEL_VERSION, config.CONF_THRESHOLD)
        log.info("model loaded in %.1fs: %s", time.time() - started, config.MODEL_VERSION)
    yield


app = FastAPI(title="ClaimPilot ml-service", lifespan=lifespan)


def detector(request: Request) -> Detector:
    return request.app.state.detector


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready(request: Request):
    # Uvicorn only starts serving after lifespan startup (model load), so if
    # we can answer, the model is in memory.
    if getattr(request.app.state, "detector", None) is None:
        raise HTTPException(503, "model not loaded")
    return {"status": "ok", "model_version": request.app.state.detector.version}


@app.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# Sync `def` on purpose: FastAPI runs it in a threadpool, so CPU-bound
# inference doesn't block the event loop (and /health keeps answering).
@app.post("/detect")
def detect(request: Request, files: list[UploadFile] = File(...)):
    if not files or len(files) > config.MAX_FILES:
        REQUESTS.labels("rejected").inc()
        raise HTTPException(400, f"send 1-{config.MAX_FILES} images as 'files'")

    det = detector(request)
    images = []
    for f in files:
        data = f.file.read(config.MAX_BYTES + 1)
        if len(data) > config.MAX_BYTES:
            REQUESTS.labels("rejected").inc()
            raise HTTPException(413, f"{f.filename} exceeds {config.MAX_BYTES} bytes")
        try:
            img = Image.open(io.BytesIO(data))
            img.load()  # force decode now: a corrupt file is a 400, not a 500 later
            images.append(img.convert("RGB"))
        except (UnidentifiedImageError, OSError):
            REQUESTS.labels("rejected").inc()
            raise HTTPException(400, f"{f.filename} is not a readable image")

    out = []
    for img in images:
        with INFERENCE_SECONDS.time():
            detections = det.detect(img)
        out.append({
            "width": img.width,
            "height": img.height,
            "detections": [
                {"class": d.cls, "confidence": d.confidence, "bbox": d.bbox} for d in detections
            ],
        })
    REQUESTS.labels("ok").inc()
    return {"model_version": det.version, "images": out}
