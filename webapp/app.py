import os
import secrets
import time
import uuid
import threading
from pathlib import Path
from typing import Dict, Any, List, Optional

import requests
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"
GALLERY_DIR = DATA_DIR / "gallery"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
GALLERY_DIR.mkdir(parents=True, exist_ok=True)

# Change this to your current TRELLIS endpoint if needed.
# Default to a local backend so the public UI can stay separate from generation.
TRELLIS_API_URL = os.environ.get(
    "TRELLIS_API_URL",
    "http://127.0.0.1:8000/generate-obj"
)
TRELLIS_VARIANT_API_URL = os.environ.get(
    "TRELLIS_VARIANT_API_URL",
    "http://127.0.0.1:8000/generate-variant-obj"
)

# Approximate average generation time in seconds
ESTIMATED_SECONDS = 80
DEFAULT_VARIANT_COUNT = 4
MAX_VARIANT_COUNT = 4
MAX_SEED = 2**31 - 1
MAX_STORED_ITEMS = 20
QUALITY_PRESETS = {"default", "medium", "high"}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MODEL_EXTS = {".obj", ".glb", ".gltf"}

app = FastAPI(title="TRELLIS Local Webapp")

# In-memory job store for localhost use
jobs: Dict[str, Dict[str, Any]] = {}
jobs_lock = threading.Lock()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/media/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/media/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.mount("/media/gallery", StaticFiles(directory=GALLERY_DIR), name="gallery")


def set_job(job_id: str, **updates):
    with jobs_lock:
        if job_id not in jobs:
            jobs[job_id] = {}
        jobs[job_id].update(updates)


def get_job(job_id: str):
    with jobs_lock:
        return jobs.get(job_id)


def _normalize_seed_value(raw_seed: Optional[str]) -> Optional[int]:
    if raw_seed is None:
        return None

    raw_seed = raw_seed.strip()
    if not raw_seed:
        return None

    try:
        return int(raw_seed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Seed must be blank or an integer.") from exc


def _normalize_variant_count(raw_count: int) -> int:
    if raw_count < 1:
        raise HTTPException(status_code=400, detail="Variant count must be at least 1.")
    return min(raw_count, MAX_VARIANT_COUNT)


def _trim_path_items(path: Path, max_items: int = MAX_STORED_ITEMS):
    if not path.exists() or not path.is_dir():
        return

    entries = sorted(path.iterdir(), key=lambda p: p.stat().st_mtime)
    if len(entries) <= max_items:
        return

    remove_count = len(entries) - max_items
    for entry in entries[:remove_count]:
        try:
            if entry.is_dir():
                for sub in sorted(entry.rglob("*"), key=lambda p: len(p.parts), reverse=True):
                    if sub.is_file() or sub.is_symlink():
                        sub.unlink(missing_ok=True)
                    elif sub.is_dir():
                        sub.rmdir()
                entry.rmdir()
            else:
                entry.unlink(missing_ok=True)
        except Exception:
            # Cleanup is best-effort; skip items that fail to delete.
            continue


def _cleanup_storage():
    _trim_path_items(UPLOAD_DIR)
    _trim_path_items(OUTPUT_DIR)
    _trim_path_items(BASE_DIR.parent / "outputs_api")


def _random_seed() -> int:
    return secrets.randbelow(MAX_SEED)


def _derive_seeds(base_seed: int, count: int) -> List[int]:
    return [int((base_seed + index) % MAX_SEED) for index in range(count)]


def _normalize_quality_preset(raw_preset: Optional[str]) -> str:
    preset = str(raw_preset or "default").strip().lower()
    if preset not in QUALITY_PRESETS:
        raise HTTPException(status_code=400, detail="quality_preset must be one of: default, medium, high")
    return preset


def _post_trellis_image(
    input_path: Path,
    seed: int,
    api_url: str,
    quality_preset: str = "default",
) -> requests.Response:
    with input_path.open("rb") as f:
        files = {"image": (input_path.name, f, "application/octet-stream")}
        return requests.post(
            api_url,
            files=files,
            data={
                "seed": str(seed),
                "quality_preset": quality_preset,
            },
            timeout=600,
            allow_redirects=True,
        )


def _variant_output_url(job_id: str, filename: str) -> str:
    return f"/media/outputs/{job_id}/{filename}"


def _find_variant(job: Dict[str, Any], seed: int):
    for variant in job.get("variants", []):
        if variant.get("seed") == seed:
            return variant
    return None


def _update_variant_job_state(job_id: str, variants: List[Dict[str, Any]], **updates):
    done_count = sum(1 for variant in variants if variant.get("status") == "done")
    total_count = len(variants)
    progress = min(95, 10 + int((done_count / max(total_count, 1)) * 85)) if total_count else 5

    stage = updates.pop("stage", None)
    if stage is None:
        if updates.get("status") == "done":
            stage = "Completed"
        elif updates.get("status") == "error":
            stage = "Completed with errors"
        else:
            stage = "Generating variants"

    set_job(
        job_id,
        variants=variants,
        completed_count=done_count,
        progress=updates.pop("progress", progress),
        stage=stage,
        **updates,
    )


def run_variant_generation(job_id: str, input_path: Path, output_dir: Path, seeds: List[int]):
    output_dir.mkdir(parents=True, exist_ok=True)
    start_time = time.time()

    existing = get_job(job_id) or {}
    current_variants = list(existing.get("variants", []))
    total_requested = int(existing.get("requested_count", 0)) + len(seeds)
    base_seed = existing.get("base_seed")

    _update_variant_job_state(
        job_id,
        current_variants,
        status="running",
        started_at=existing.get("started_at", start_time),
        completed_at=None,
        error=None,
        progress=10,
        stage=f"Generating 0 of {len(seeds)} variants",
        mode="variants",
        requested_count=total_requested,
        base_seed=base_seed,
    )

    for index, seed in enumerate(seeds, start=len(current_variants) + 1):
        variant_name = f"variant_{index:02d}_seed_{seed}.obj"
        output_path = output_dir / variant_name
        started_at = time.time()
        error_message = None

        try:
            response = _post_trellis_image(input_path, seed, TRELLIS_VARIANT_API_URL)
            if response.status_code != 200:
                raise RuntimeError(
                    f"API returned {response.status_code}: {response.text[:300]}"
                )

            output_path.write_bytes(response.content)
            status = "done"
        except Exception as exc:
            status = "error"
            error_message = str(exc)

        finished_at = time.time()
        current_variants.append({
            "variant_id": f"{job_id}-{index}",
            "index": index,
            "seed": seed,
            "status": status,
            "started_at": started_at,
            "completed_at": finished_at,
            "runtime_seconds": round(finished_at - started_at, 2),
            "output_url": _variant_output_url(job_id, variant_name) if status == "done" else None,
            "filename": variant_name,
            "error": error_message,
        })

        _update_variant_job_state(
            job_id,
            current_variants,
            status="running",
            started_at=existing.get("started_at", start_time),
            completed_at=None,
            error=error_message,
            progress=min(95, 10 + int((len(current_variants) / max(total_requested, 1)) * 85)),
            stage="Generating variants",
            mode="variants",
            requested_count=total_requested,
            base_seed=base_seed,
        )

    final_status = "done" if all(variant.get("status") == "done" for variant in current_variants) else "error"
    final_error = None if final_status == "done" else "One or more variants failed."

    _update_variant_job_state(
        job_id,
        current_variants,
        status=final_status,
        completed_at=time.time(),
        error=final_error,
        progress=100,
        stage="Completed" if final_status == "done" else "Completed with errors",
        mode="variants",
        requested_count=total_requested,
        base_seed=base_seed,
    )


def _spawn_variant_generation(job_id: str, input_path: Path, output_dir: Path, seeds: List[int]):
    thread = threading.Thread(
        target=run_variant_generation,
        args=(job_id, input_path, output_dir, seeds),
        daemon=True,
    )
    thread.start()
    return thread


def run_generation(
    job_id: str,
    input_path: Path,
    output_path: Path,
    seed: int = 1,
    quality_preset: str = "default",
):
    set_job(job_id, status="running", started_at=time.time(), error=None)

    try:
        response = _post_trellis_image(
            input_path=input_path,
            seed=seed,
            api_url=TRELLIS_API_URL,
            quality_preset=quality_preset,
        )

        if response.status_code != 200:
            raise RuntimeError(
                f"API returned {response.status_code}: {response.text[:300]}"
            )

        with output_path.open("wb") as out:
            out.write(response.content)

        set_job(
            job_id,
            status="done",
            completed_at=time.time(),
            output_url=f"/media/outputs/{output_path.name}",
            seed=seed,
            quality_preset=quality_preset,
        )

    except Exception as e:
        set_job(
            job_id,
            status="error",
            completed_at=time.time(),
            error=str(e),
        )


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/result")
def result_page():
    return FileResponse(STATIC_DIR / "result.html")


@app.post("/api/upload")
async def upload_image(image: UploadFile = File(...)):
    _cleanup_storage()

    if not image.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    ext = Path(image.filename).suffix.lower()
    if ext not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Supported formats: jpg, jpeg, png, webp")

    job_id = str(uuid.uuid4())
    safe_name = f"{job_id}{ext}"
    input_path = UPLOAD_DIR / safe_name
    output_path = OUTPUT_DIR / f"{job_id}.obj"

    content = await image.read()
    input_path.write_bytes(content)

    set_job(
        job_id,
        mode="single",
        status="queued",
        created_at=time.time(),
        input_url=f"/media/uploads/{safe_name}",
        input_path=str(input_path),
        output_url=None,
        error=None,
        filename=image.filename,
        seed=1,
        quality_preset="default",
    )

    thread = threading.Thread(
        target=run_generation,
        args=(job_id, input_path, output_path, 1, "default"),
        daemon=True
    )
    thread.start()

    return JSONResponse({
        "job_id": job_id,
        "status": "queued",
        "seed": 1,
        "quality_preset": "default",
        "result_page": f"/result?job={job_id}",
    })


@app.post("/api/generate-variants")
async def generate_variants(
    image: UploadFile = File(...),
    variant_count: int = Form(DEFAULT_VARIANT_COUNT),
    base_seed: str = Form(""),
):
    _cleanup_storage()

    if not image.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    ext = Path(image.filename).suffix.lower()
    if ext not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Supported formats: jpg, jpeg, png, webp")

    count = _normalize_variant_count(variant_count)
    parsed_seed = _normalize_seed_value(base_seed)
    base_seed_value = parsed_seed if parsed_seed is not None else _random_seed()
    seeds = _derive_seeds(base_seed_value, count)

    job_id = str(uuid.uuid4())
    safe_name = f"{job_id}{ext}"
    input_path = UPLOAD_DIR / safe_name
    output_dir = OUTPUT_DIR / job_id

    content = await image.read()
    input_path.write_bytes(content)
    output_dir.mkdir(parents=True, exist_ok=True)

    set_job(
        job_id,
        mode="variants",
        status="queued",
        created_at=time.time(),
        input_url=f"/media/uploads/{safe_name}",
        input_path=str(input_path),
        output_dir=str(output_dir),
        output_url=None,
        error=None,
        filename=image.filename,
        requested_count=count,
        base_seed=base_seed_value,
        active_seed=base_seed_value,
        completed_count=0,
        variants=[],
        seeds=seeds,
    )

    _spawn_variant_generation(job_id, input_path, output_dir, seeds)

    return JSONResponse({
        "job_id": job_id,
        "status": "queued",
        "mode": "variants",
        "requested_count": count,
        "base_seed": base_seed_value,
        "result_page": f"/result?job={job_id}",
    })


@app.get("/api/status/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    status = job.get("status", "queued")
    now = time.time()

    if job.get("mode") == "variants":
        variants = job.get("variants", [])
        completed = sum(1 for variant in variants if variant.get("status") == "done")
        requested_count = job.get("requested_count", len(variants))
        progress = int(job.get("progress", 0))
        if status == "queued":
            progress = 5
            stage = "Queued"
        elif status == "running":
            progress = max(progress, 10)
            stage = job.get("stage", "Generating variants")
        elif status == "done":
            progress = 100
            stage = "Completed"
        elif status == "error":
            progress = 100
            stage = job.get("stage", "Completed with errors")
        else:
            stage = job.get("stage", "Queued")

        return JSONResponse({
            "job_id": job_id,
            "mode": "variants",
            "status": status,
            "progress": progress,
            "stage": stage,
            "input_url": job.get("input_url"),
            "output_url": job.get("output_url"),
            "error": job.get("error"),
            "filename": job.get("filename"),
            "base_seed": job.get("base_seed"),
            "active_seed": job.get("active_seed"),
            "requested_count": requested_count,
            "completed_count": completed,
            "variants": variants,
        })

    progress = 0
    stage = "Queued"

    if status == "queued":
        progress = 5
        stage = "Queued"
    elif status == "running":
        started = job.get("started_at", now)
        elapsed = max(0, now - started)
        # Smooth approximate progress that caps before completion
        progress = min(95, int(10 + (elapsed / ESTIMATED_SECONDS) * 85))
        if progress < 30:
            stage = "Uploading image"
        elif progress < 60:
            stage = "Generating 3D geometry"
        elif progress < 85:
            stage = "Refining mesh"
        else:
            stage = "Finalizing OBJ"
    elif status == "done":
        progress = 100
        stage = "Completed"
    elif status == "error":
        progress = 100
        stage = "Failed"

    return JSONResponse({
        "job_id": job_id,
        "status": status,
        "progress": progress,
        "stage": stage,
        "input_url": job.get("input_url"),
        "output_url": job.get("output_url"),
        "error": job.get("error"),
        "filename": job.get("filename"),
    })


@app.get("/api/result/{job_id}")
def job_result(job_id: str, seed: Optional[int] = None):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("mode") == "variants":
        variants = job.get("variants", [])
        selected = None

        if seed is not None:
            selected = _find_variant(job, seed)
        if selected is None:
            active_seed = job.get("active_seed")
            if active_seed is not None:
                selected = _find_variant(job, int(active_seed))
        if selected is None:
            selected = next((variant for variant in variants if variant.get("status") == "done"), None)

        if not selected:
            raise HTTPException(status_code=400, detail="No completed variant is available yet")

        if selected.get("status") != "done":
            raise HTTPException(status_code=400, detail="Variant is not finished yet")

        return JSONResponse({
            "job_id": job_id,
            "mode": "variants",
            "input_url": job.get("input_url"),
            "output_url": selected.get("output_url"),
            "filename": selected.get("filename"),
            "seed": selected.get("seed"),
            "runtime_seconds": selected.get("runtime_seconds"),
            "base_seed": job.get("base_seed"),
            "active_seed": job.get("active_seed"),
            "requested_count": job.get("requested_count"),
            "variants": variants,
            "variant": selected,
        })

    if job.get("status") != "done":
        raise HTTPException(status_code=400, detail="Job is not finished yet")

    return JSONResponse({
        "job_id": job_id,
        "mode": "single",
        "input_url": job.get("input_url"),
        "output_url": job.get("output_url"),
        "filename": job.get("filename"),
        "seed": int(job.get("seed", 1)),
        "quality_preset": job.get("quality_preset", "default"),
        "source_job_id": job.get("source_job_id"),
        "source_seed": job.get("source_seed"),
    })


def _resolve_job_input_path(job: Dict[str, Any]) -> Path:
    input_path_value = job.get("input_path")
    if input_path_value:
        input_path = Path(str(input_path_value))
        if input_path.exists():
            return input_path

    input_url = str(job.get("input_url", ""))
    filename = Path(input_url).name
    fallback = UPLOAD_DIR / filename
    if fallback.exists():
        return fallback

    raise HTTPException(status_code=404, detail="Source image for rerun was not found")


def _resolve_seed_for_rerun(job: Dict[str, Any], seed: Optional[int]) -> int:
    if seed is not None:
        return int(seed)

    if job.get("mode") == "variants":
        active_seed = job.get("active_seed")
        if active_seed is not None:
            return int(active_seed)
        variants = job.get("variants", [])
        first_done = next((variant for variant in variants if variant.get("status") == "done"), None)
        if first_done and first_done.get("seed") is not None:
            return int(first_done.get("seed"))

    return int(job.get("seed", 1))


@app.post("/api/rerun-quality")
async def rerun_quality(
    image: Optional[UploadFile] = File(None),
    source_job_id: Optional[str] = Form(None),
    seed: Optional[int] = Form(None),
):
    source_job = get_job(source_job_id) if source_job_id else None
    if seed is None:
        seed = 1

    resolved_seed = int(seed)

    source_input_path = None
    source_filename = "source-image.png"
    if source_job:
        try:
            source_input_path = _resolve_job_input_path(source_job)
            source_filename = source_job.get("filename") or source_input_path.name
        except HTTPException:
            source_input_path = None

    if source_input_path is None:
        if image is None or not image.filename:
            raise HTTPException(status_code=400, detail="No source image provided.")
        source_filename = Path(image.filename).name or source_filename
        content = await image.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty source image upload.")
    else:
        content = source_input_path.read_bytes()

    job_id = str(uuid.uuid4())
    ext = Path(source_filename).suffix.lower() or ".png"
    safe_name = f"{job_id}{ext}"
    input_path = UPLOAD_DIR / safe_name
    input_path.write_bytes(content)

    output_path = OUTPUT_DIR / f"{job_id}.obj"
    set_job(
        job_id,
        mode="single",
        status="queued",
        created_at=time.time(),
        input_url=f"/media/uploads/{safe_name}",
        input_path=str(input_path),
        output_url=None,
        error=None,
        filename=source_job.get("filename") if source_job else source_filename,
        seed=resolved_seed,
        quality_preset="high",
        source_job_id=source_job_id,
        source_seed=resolved_seed,
    )

    thread = threading.Thread(
        target=run_generation,
        args=(job_id, input_path, output_path, resolved_seed, "high"),
        daemon=True,
    )
    thread.start()

    return JSONResponse({
        "job_id": job_id,
        "status": "queued",
        "source_job_id": source_job_id,
        "source_seed": resolved_seed,
        "seed": resolved_seed,
        "quality_preset": "high",
        "result_page": f"/result?job={job_id}",
    })


def _find_first(path: Path, extensions):
    for item in sorted(path.iterdir()):
        if item.suffix.lower() in extensions:
            return item
    return None


@app.get("/api/gallery")
def gallery_items():
    items = []

    if not GALLERY_DIR.exists():
        return JSONResponse(items)

    for entry in sorted(GALLERY_DIR.iterdir()):
        if not entry.is_dir():
            continue

        image_path = _find_first(entry, IMAGE_EXTS)
        model_path = _find_first(entry, MODEL_EXTS)

        if not image_path or not model_path:
            # Skip incomplete pairs
            continue

        preview_path = None
        for candidate in sorted(entry.iterdir()):
            if candidate.suffix.lower() in IMAGE_EXTS and any(tag in candidate.stem.lower() for tag in ["preview", "after", "render", "model"]):
                preview_path = candidate
                break

        preview_path = preview_path or image_path

        item_id = entry.name
        items.append({
            "id": item_id,
            "title": item_id.replace("-", " ").replace("_", " ").title(),
            "input_image": f"/media/gallery/{item_id}/{image_path.name}",
            "preview_image": f"/media/gallery/{item_id}/{preview_path.name}",
            "model_url": f"/media/gallery/{item_id}/{model_path.name}",
            "model_type": model_path.suffix.lower().lstrip("."),
        })

    return JSONResponse(items)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=5010, reload=True)