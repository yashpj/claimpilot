import threading
from dataclasses import dataclass
from typing import Protocol

from PIL import Image


@dataclass
class Detection:
    cls: str
    confidence: float
    bbox: list[float]  # x1, y1, x2, y2 in pixels


class Detector(Protocol):
    version: str

    def detect(self, image: Image.Image) -> list[Detection]: ...


class YoloDetector:
    """Wraps an Ultralytics checkpoint. Loading takes seconds (torch import +
    weights), which is why k8s gives this pod a startupProbe."""

    def __init__(self, path: str, version: str, conf: float):
        from ultralytics import YOLO  # heavy import, only when really loading

        self._model = YOLO(path)
        if self._model.task != "detect":
            raise ValueError(f"{path} is a '{self._model.task}' model; need 'detect'")
        self.version = version
        self._conf = conf
        # One inference at a time per process: the model isn't documented as
        # thread-safe, and CPU inference saturates cores anyway. Scale out
        # with replicas, not threads.
        self._lock = threading.Lock()

    def detect(self, image: Image.Image) -> list[Detection]:
        with self._lock:
            result = self._model.predict(image, conf=self._conf, verbose=False)[0]
        names = self._model.names
        return [
            Detection(
                cls=names[int(c)],
                confidence=round(float(s), 4),
                bbox=[round(float(v), 1) for v in box],
            )
            for c, s, box in zip(result.boxes.cls, result.boxes.conf, result.boxes.xyxy)
        ]
