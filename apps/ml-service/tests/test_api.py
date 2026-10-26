import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.detector import Detection
from app.main import app


class StubDetector:
    version = "stub-1"

    def detect(self, image):
        return [Detection(cls="rear-bumper-dent", confidence=0.8, bbox=[1, 2, 3, 4])]


@pytest.fixture
def client():
    app.state.detector = StubDetector()  # injected before lifespan => no torch
    with TestClient(app) as c:
        yield c
    app.state.detector = None


def jpeg(color="red", size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def test_detect_contract(client):
    res = client.post("/detect", files=[("files", ("a.jpg", jpeg(), "image/jpeg")),
                                        ("files", ("b.jpg", jpeg("blue"), "image/jpeg"))])
    assert res.status_code == 200
    body = res.json()
    assert body["model_version"] == "stub-1"
    assert len(body["images"]) == 2
    assert body["images"][0] == {
        "width": 64, "height": 48,
        "detections": [{"class": "rear-bumper-dent", "confidence": 0.8, "bbox": [1, 2, 3, 4]}],
    }


def test_rejects_non_images(client):
    res = client.post("/detect", files=[("files", ("x.jpg", b"not an image", "image/jpeg"))])
    assert res.status_code == 400


def test_rejects_too_many_files(client):
    files = [("files", (f"{i}.jpg", jpeg(), "image/jpeg")) for i in range(7)]
    assert client.post("/detect", files=files).status_code == 400


def test_health_and_metrics(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json()["model_version"] == "stub-1"
    client.post("/detect", files=[("files", ("a.jpg", jpeg(), "image/jpeg"))])
    assert "ml_inference_seconds" in client.get("/metrics").text


@pytest.mark.skipif(not os.path.exists("models/car-damage.pt"), reason="weights not downloaded")
def test_real_model_loads_and_runs():
    from app.detector import YoloDetector

    det = YoloDetector("models/car-damage.pt", "test", 0.15)
    assert isinstance(det.detect(Image.new("RGB", (640, 480), "gray")), list)
