#!/usr/bin/env python3
"""Prepare independently installable, immutable BodyTrace ZIPA model packs.

The APK contains no weights; this workflow publishes a SEPARATE GitHub Release.
Source weights are from original AnySpeech Hugging Face repositories and their
licenses must be shown with the model. Files are never modified or quantized here.
"""
import argparse
import hashlib
import json
import pathlib
import zipfile

MODELS = [
    ("zipa-cr-small-300k", "anyspeech/zipa-small-crctc-300k", "CC-BY-4.0"),
    ("zipa-cr-small-500k", "anyspeech/zipa-small-crctc-500k", "CC-BY-4.0"),
    ("zipa-cr-small-ns-700k", "anyspeech/zipa-small-crctc-ns-700k", "CC-BY-NC-SA-4.0"),
]

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as fp:
        for block in iter(lambda: fp.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path("release-voice-models"))
    args = parser.parse_args()
    from huggingface_hub import HfApi, hf_hub_download
    args.output.mkdir(parents=True, exist_ok=True)
    api = HfApi()
    manifest = {"schema": 1, "source": "Hugging Face / AnySpeech ZIPA",
                "decode": "zipformer CTC / sherpa-onnx", "models": []}
    for model_id, repo, license_name in MODELS:
        info = api.model_info(repo)
        revision = info.sha
        folder = args.output / ("tmp-" + model_id)
        folder.mkdir(exist_ok=True)
        parts = {}
        for filename in ("model.int8.onnx", "tokens.txt"):
            cached = pathlib.Path(hf_hub_download(
                repo_id=repo, filename=filename, revision=revision))
            dest = folder / filename
            dest.write_bytes(cached.read_bytes())
            minimum = 10 * 1024 * 1024 if filename.endswith(".onnx") else 10
            assert dest.stat().st_size >= minimum, f"{repo}/{filename} too small"
            parts[filename] = {"sha256": sha256(dest), "size": dest.stat().st_size}
        metadata = {"schema": 1, "id": model_id, "repository": repo,
                    "revision": revision, "license": license_name,
                    "runtime": "sherpa-onnx/offline-zipformer-ctc",
                    "files": parts}
        archive_name = "VoicePhone-" + model_id + ".zip"
        archive_path = args.output / archive_name
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as z:
            z.writestr("pack.json", json.dumps(metadata, ensure_ascii=False, indent=2))
            for filename in ("model.int8.onnx", "tokens.txt"):
                z.write(folder / filename, arcname=filename)
        manifest["models"].append({
            "id": model_id, "name": archive_name, "sha256": sha256(archive_path),
            "size": archive_path.stat().st_size, "license": license_name,
            "source": repo, "revision": revision})
        print(model_id, archive_path.stat().st_size, revision)
        for filename in ("model.int8.onnx", "tokens.txt"):
            (folder / filename).unlink()
        folder.rmdir()
    (args.output / "VoicePhone-models.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
