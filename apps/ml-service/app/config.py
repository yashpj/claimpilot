import os

# Model weights are configuration, not code: swapping to a different
# Ultralytics checkpoint (e.g. a YOLOv8 fine-tune) is an env change.
MODEL_PATH = os.getenv("MODEL_PATH", "models/car-damage.pt")
MODEL_VERSION = os.getenv("MODEL_VERSION", "yolov11n-car-damage@hf:vineetsarpal")
# Low on purpose: the API decides what counts as "damage seen"
# (TRIAGE_CONFIG.mlMinConfidence). The service reports, the caller judges.
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.15"))
MAX_FILES = int(os.getenv("MAX_FILES", "6"))
MAX_BYTES = int(os.getenv("MAX_BYTES", str(8 * 1024 * 1024)))
