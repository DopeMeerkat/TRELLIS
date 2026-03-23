import os
import time
import uuid
import threading
from pathlib import Path
from typing import Dict, Any

import requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Change this to your current TRELLIS endpoint if needed
TRELLIS_API_URL = os.environ.get(
    "TRELLIS_API_URL",
    "https://jeannetta-unreplete-dowdily.ngrok-free.dev/generate-obj"
)

# Approximate average generation time in seconds
ESTIMATED_SECONDS = 80

app = FastAPI(title="TRELLIS Local Webapp")

# In-memory job store for localhost use
jobs: Dict[str, Dict[str, Any]] = {}
jobs_lock = threading.Lock()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/media/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/media/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")


def set_job(job_id: str, **updates):
    with jobs_lock:
        if job_id not in jobs:
            jobs[job_id] = {}
        jobs[job_id].update(updates)


def get_job(job_id: str):
    with jobs_lock:
        return jobs.get(job_id)


def run_generation(job_id: str, input_path: Path, output_path: Path):
    set_job(job_id, status="running", started_at=time.time(), error=None)

    try:
        with input_path.open("rb") as f:
            files = {
                "image": (input_path.name, f, "application/octet-stream")
            }
            response = requests.post(
                TRELLIS_API_URL,
                files=files,
                timeout=600,
                allow_redirects=True,
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
    if not image.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    ext = Path(image.filename).suffix.lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        raise HTTPException(status_code=400, detail="Supported formats: jpg, jpeg, png, webp")

    job_id = str(uuid.uuid4())
    safe_name = f"{job_id}{ext}"
    input_path = UPLOAD_DIR / safe_name
    output_path = OUTPUT_DIR / f"{job_id}.obj"

    content = await image.read()
    input_path.write_bytes(content)

    set_job(
        job_id,
        status="queued",
        created_at=time.time(),
        input_url=f"/media/uploads/{safe_name}",
        output_url=None,
        error=None,
        filename=image.filename,
    )

    thread = threading.Thread(
        target=run_generation,
        args=(job_id, input_path, output_path),
        daemon=True
    )
    thread.start()

    return JSONResponse({
        "job_id": job_id,
        "status": "queued",
        "result_page": f"/result?job={job_id}",
    })


@app.get("/api/status/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    status = job.get("status", "queued")
    now = time.time()

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
def job_result(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("status") != "done":
        raise HTTPException(status_code=400, detail="Job is not finished yet")

    return JSONResponse({
        "job_id": job_id,
        "input_url": job.get("input_url"),
        "output_url": job.get("output_url"),
        "filename": job.get("filename"),
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)