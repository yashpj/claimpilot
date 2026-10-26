"""Download model weights and verify their SHA-256.

Pinning the checksum means a silently re-uploaded checkpoint (same URL,
different weights) fails the build instead of changing model behaviour.
"""
import hashlib
import os
import sys
import urllib.request

URL = os.getenv("MODEL_URL", "https://huggingface.co/vineetsarpal/yolov11n-car-damage/resolve/main/best.pt")
SHA256 = os.getenv("MODEL_SHA256", "cf3e55e63fd4564f68f78782be4e2608d26054753ba90762ab101dd22cdec962")
DEST = os.getenv("MODEL_PATH", "models/car-damage.pt")


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    os.makedirs(os.path.dirname(DEST) or ".", exist_ok=True)
    if not (os.path.exists(DEST) and sha256(DEST) == SHA256):
        print(f"downloading {URL}")
        urllib.request.urlretrieve(URL, DEST)
    actual = sha256(DEST)
    if actual != SHA256:
        print(f"checksum mismatch: expected {SHA256}, got {actual}", file=sys.stderr)
        return 1
    print(f"ok {DEST} {actual}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
