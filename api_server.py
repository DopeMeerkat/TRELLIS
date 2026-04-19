import os
import threading
import uuid
from pathlib import Path

import trimesh
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

# Match TRELLIS env defaults.
os.environ.setdefault("ATTN_BACKEND", "flash-attn")
os.environ.setdefault("SPCONV_ALGO", "native")

from trellis.pipelines import TrellisImageTo3DPipeline  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent


def _resolve_path(value: str, default: Path) -> Path:
    path = Path(value) if value else default
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


app = FastAPI(title="TRELLIS Local API")

APP_OUT = _resolve_path(os.environ.get("TRELLIS_OUTPUT_DIR", "outputs_api"), BASE_DIR / "outputs_api")
APP_OUT.mkdir(parents=True, exist_ok=True)

MODEL_DIR = _resolve_path(os.environ.get("TRELLIS_MODEL_DIR", "TRELLIS-image-large"), BASE_DIR / "TRELLIS-image-large")

_pipeline = None
_load_lock = threading.Lock()
_gen_lock = threading.Lock()

QUALITY_PRESETS = {
    "default": {
        "sparse_structure_sampler_params": {},
        "slat_sampler_params": {},
    },
    "medium": {
        "sparse_structure_sampler_params": {"steps": 20, "cfg_strength": 7.8},
        "slat_sampler_params": {"steps": 20, "cfg_strength": 3.5},
    },
    "high": {
        "sparse_structure_sampler_params": {"steps": 50, "cfg_strength": 8.5},
        "slat_sampler_params": {"steps": 50, "cfg_strength": 4.5},
    },
}


def get_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    with _load_lock:
        if _pipeline is not None:
            return _pipeline

        if not MODEL_DIR.exists():
            raise RuntimeError(f"Model dir not found: {MODEL_DIR}")

        pipeline = TrellisImageTo3DPipeline.from_pretrained(str(MODEL_DIR))
        pipeline.cuda()
        _pipeline = pipeline
        return _pipeline


def export_raw_obj(outputs, out_path: Path):
    mesh = outputs["mesh"][0]
    vertices = mesh.vertices.cpu().numpy()
    faces = mesh.faces.cpu().numpy()
    trimesh.Trimesh(vertices=vertices, faces=faces, process=False).export(
        out_path.as_posix(), file_type="obj"
    )


def _resolve_quality_preset(quality_preset: str) -> str:
    preset = str(quality_preset or "default").strip().lower()
    if preset not in QUALITY_PRESETS:
        raise HTTPException(status_code=400, detail="quality_preset must be one of: default, medium, high")
    return preset


def _generate_obj(job_dir: Path, image_path: Path, seed: int, quality_preset: str) -> Path:
    pipeline = get_pipeline()
    preset_name = _resolve_quality_preset(quality_preset)
    preset_params = QUALITY_PRESETS[preset_name]

    with _gen_lock:
        pil_image = Image.open(image_path).convert("RGB")
        outputs = pipeline.run(
            pil_image,
            seed=seed,
            sparse_structure_sampler_params=preset_params["sparse_structure_sampler_params"],
            slat_sampler_params=preset_params["slat_sampler_params"],
        )

        out_obj = job_dir / "model.obj"
        export_raw_obj(outputs, out_obj)

    return out_obj


@app.get("/health")
def health():
    return {
        "ok": True,
        "model_loaded": _pipeline is not None,
        "mode": "local_repo_root",
        "model_dir": str(MODEL_DIR),
        "output_dir": str(APP_OUT),
        "endpoints": ["/health", "/generate-raw-obj", "/generate-obj"],
    }


async def _handle_generate_with_seed(image: UploadFile, seed: int, quality_preset: str):
    job_id = str(uuid.uuid4())
    job_dir = APP_OUT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    in_path = job_dir / (image.filename or "input.png")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    in_path.write_bytes(data)

    try:
        get_pipeline()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline load failed: {exc}")

    out_obj = _generate_obj(job_dir, in_path, seed, quality_preset=quality_preset)

    if not out_obj.exists():
        raise HTTPException(status_code=500, detail="OBJ export failed")

    return FileResponse(
        str(out_obj),
        media_type="application/octet-stream",
        filename="model.obj",
    )


@app.post("/generate-raw-obj")
async def generate_raw_obj(
    image: UploadFile = File(...),
    seed: int = Form(1),
    quality_preset: str = Form("default"),
):
    return await _handle_generate_with_seed(image, seed=seed, quality_preset=quality_preset)


@app.post("/generate-obj")
async def generate_obj(
    image: UploadFile = File(...),
    seed: int = Form(1),
    quality_preset: str = Form("default"),
):
    return await _handle_generate_with_seed(image, seed=seed, quality_preset=quality_preset)


@app.post("/generate-variant-obj")
async def generate_variant_obj(
    image: UploadFile = File(...),
    seed: int = Form(1),
    quality_preset: str = Form("default"),
):
    return await _handle_generate_with_seed(image, seed=seed, quality_preset=quality_preset)


@app.get("/")
def root():
    return JSONResponse({"ok": True, "try": ["/health", "/generate-obj"]})