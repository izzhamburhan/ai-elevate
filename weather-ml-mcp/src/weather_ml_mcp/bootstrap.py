"""Explicit model bootstrap only: download one immutable revision and record checksums."""
import argparse
import json
import os
import re

from .config import Settings, utc_now
from .model import file_sha256


def bootstrap(settings: Settings) -> dict:
    revision = settings.model_revision
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Set WEATHER_MODEL_REVISION to the verified 40-character Hugging Face commit SHA")
    # The runtime is offline by default. This explicit acquisition job is the one permitted exception.
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"
    from huggingface_hub import snapshot_download
    settings.model_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id=settings.model_id, revision=revision, local_dir=str(settings.model_dir),
                      allow_patterns=["config.json", "model.safetensors", "README.md", "LICENSE", "LICENSE.txt"])
    checksums = {name: file_sha256(settings.model_dir / name)
                 for name in ("config.json", "model.safetensors")}
    manifest = {"id": settings.model_id, "revision": revision, "license": "Apache-2.0",
                "source": f"https://huggingface.co/{settings.model_id}/tree/{revision}",
                "acquired_at": utc_now().isoformat(), "sha256": checksums}
    path = settings.model_dir / "weather-model.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(path)
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Explicit pinned open-source model bootstrap")
    parser.add_argument("--revision", help="Immutable 40-character model commit SHA")
    args = parser.parse_args()
    if args.revision:
        os.environ["WEATHER_MODEL_REVISION"] = args.revision
    manifest = bootstrap(Settings.from_env())
    print(json.dumps({"event": "model_bootstrapped", "id": manifest["id"], "revision": manifest["revision"]}))


if __name__ == "__main__":
    main()
