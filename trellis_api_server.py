import os, uuid, threading
from pathlib import Path

import trimesh
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

# Match TRELLIS env defaults
os.environ.setdefault("ATTN_BACKEND", "flash-attn")
os.environ.setdefault("SPCONV_ALGO", "native")

from trellis.pipelines import TrellisImageTo3DPipeline  # noqa: E402

app = FastAPI()

APP_OUT = Path("/content/outputs_api")
APP_OUT.mkdir(parents=True, exist_ok=True)

MODEL_DIR = Path(os.environ.get("TRELLIS_MODEL_DIR", "/content/TRELLIS-image-large"))

_pipeline = None
_load_lock = threading.Lock()
_gen_lock = threading.Lock()

def get_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    with _load_lock:
        if _pipeline is not None:
            return _pipeline
        if not MODEL_DIR.exists():
            raise RuntimeError(f"Model dir not found: {MODEL_DIR}")
        p = TrellisImageTo3DPipeline.from_pretrained(str(MODEL_DIR))
        p.cuda()
        _pipeline = p
        return _pipeline

def export_raw_obj(outputs, out_path: Path):
    # Same raw export pattern as generate.py:
    # mesh = outputs["mesh"][0]; vertices = mesh.vertices.cpu().numpy(); faces = mesh.faces.cpu().numpy()
    mesh = outputs["mesh"][0]
    vertices = mesh.vertices.cpu().numpy()
    faces = mesh.faces.cpu().numpy()
    tm = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    tm.export(out_path.as_posix(), file_type="obj")

@app.get("/health")
def health():
    return {
        "ok": True,
        "model_loaded": _pipeline is not None,
        "mode": "raw_mesh_obj",
        "endpoints": ["/health", "/generate-raw-obj", "/generate-obj"],
    }

async def _handle_generate(image: UploadFile):
    job_id = str(uuid.uuid4())
    job_dir = APP_OUT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    in_path = job_dir / (image.filename or "input.png")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    in_path.write_bytes(data)

    try:
        pipeline = get_pipeline()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline load failed: {e}")

    with _gen_lock:
        pil = Image.open(in_path).convert("RGB")
        outputs = pipeline.run(pil, seed=1)

        out_obj = job_dir / "model.obj"
        export_raw_obj(outputs, out_obj)

    if not out_obj.exists():
        raise HTTPException(status_code=500, detail="OBJ export failed")

    return FileResponse(str(out_obj), media_type="application/octet-stream", filename="model.obj")

@app.post("/generate-raw-obj")
async def generate_raw_obj(image: UploadFile = File(...)):
    return await _handle_generate(image)

# Alias so your existing curl to /generate-obj keeps working
@app.post("/generate-obj")
async def generate_obj(image: UploadFile = File(...)):
    return await _handle_generate(image)

@app.get("/")
def root():
    return JSONResponse({"ok": True, "try": ["/health", "/generate-obj"]})
