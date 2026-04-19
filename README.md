# TRELLIS Web App Fork

This repository is a generation-focused fork of Microsoft TRELLIS. It keeps the core TRELLIS pipelines and adds a practical local web experience for image-to-3D generation, variant exploration, and high-quality reruns.

The project includes:
- Script and notebook workflows for direct TRELLIS usage.
- A two-service FastAPI setup for local interactive use.
- A browser UI for upload, generation tracking, variant comparison, and OBJ download.

## Repository overview

Core files and folders:
- [api_server.py](api_server.py): TRELLIS inference backend that loads the model and returns generated OBJ files.
- [webapp/app.py](webapp/app.py): web application backend (job orchestration, status APIs, file serving, gallery APIs).
- [webapp/app2.py](webapp/app2.py): launcher entrypoint for the webapp service.
- [webapp/static](webapp/static): frontend HTML/CSS/JS for upload flow, status UI, result viewer, and comparison view.
- [outputs_api](outputs_api): raw backend generation job output.
- [webapp/data/uploads](webapp/data/uploads): uploaded source images.
- [webapp/data/outputs](webapp/data/outputs): webapp-exposed generated OBJ outputs.
- [clear.py](clear.py): utility script to clear output/upload directories.

## Requirements

- Linux with NVIDIA GPU (16 GB+ VRAM recommended).
- Python 3.10.
- CUDA-compatible PyTorch environment (this repo is configured around CUDA 12.1 wheels).
- [uv](https://docs.astral.sh/uv/) for dependency management.
- TRELLIS model weights available locally at [TRELLIS-image-large](TRELLIS-image-large) or via Hugging Face download beforehand.

## Environment setup

From repo root:

```bash
uv venv .venv
source .venv/bin/activate
uv sync
```

Optional webapp-only environment:

```bash
cd webapp
uv sync
```

## Run locally

This fork uses two local services.

1. Start TRELLIS inference API on port 8000:

```bash
python -m uvicorn api_server:app --app-dir . --host 127.0.0.1 --port 8000
```

2. Start webapp service on port 8010:

```bash
python -m uvicorn webapp.app2:app --app-dir . --host 127.0.0.1 --port 8010
```

3. Open:

```text
http://127.0.0.1:8010
```

Default backend URL wiring in [webapp/app.py](webapp/app.py):
- `TRELLIS_API_URL=http://127.0.0.1:8000/generate-obj`
- `TRELLIS_VARIANT_API_URL=http://127.0.0.1:8000/generate-variant-obj`

## Webapp behavior (detailed)

### 1) Single image generation

- Upload image on home page.
- Webapp creates a job and stores source image under [webapp/data/uploads](webapp/data/uploads).
- Webapp sends image to inference API endpoint `/generate-obj`.
- Result page polls `/api/status/{job_id}` until complete.
- Final OBJ is served from `/media/outputs/...` and shown in the 3D viewer.

Key route: `POST /api/upload` in [webapp/app.py](webapp/app.py).

### 2) Variant generation

- Variant mode accepts a variant count and optional base seed.
- Count is capped to 4 variants.
- Webapp fans out requests to `/generate-variant-obj` with derived seeds.
- Gallery cards allow view/use/download actions.
- "Use this" routes to the shared result page with seed context (`/result?job=...&seed=...`).

Key route: `POST /api/generate-variants` in [webapp/app.py](webapp/app.py).

### 3) Result page and quality rerun

- Shared result page: [webapp/static/result.html](webapp/static/result.html).
- Shows source image, generated OBJ viewer, and download action.
- "Regenerate in Higher Quality" creates a new job with same seed and source image.
- High-quality rerun uses `quality_preset=high`.
- Comparison mode shows original and rerun side-by-side with synchronized controls.
- Comparison header includes "Download Higher Quality OBJ" for rerun output.

Key route: `POST /api/rerun-quality` in [webapp/app.py](webapp/app.py).

### 4) Job status and result APIs

Webapp APIs:
- `GET /api/status/{job_id}`: queue/running/done/error with progress hints.
- `GET /api/result/{job_id}`: returns selected output metadata.
- `GET /api/gallery`: returns static gallery entries from [webapp/data/gallery](webapp/data/gallery).

### 5) Storage management

The webapp performs best-effort trimming of stored outputs/uploads when item count grows.

Manual cleanup command:

```bash
python clear.py
```

This clears contents of:
- [outputs_api](outputs_api)
- [webapp/data/outputs](webapp/data/outputs)
- [webapp/data/uploads](webapp/data/uploads)

## Inference API behavior

Inference service in [api_server.py](api_server.py):
- Loads `TrellisImageTo3DPipeline` from [TRELLIS-image-large](TRELLIS-image-large).
- Exposes endpoints:
   - `GET /health`
   - `POST /generate-obj`
   - `POST /generate-variant-obj`
   - `POST /generate-raw-obj`
- Supports quality presets: `default`, `medium`, `high`.

Current high preset values:

```python
sparse_structure_sampler_params = {
      "steps": 50,
      "cfg_strength": 8.5,
}

slat_sampler_params = {
      "steps": 50,
      "cfg_strength": 4.5,
}
```

## Script and notebook workflows

Available examples:
- [example.py](example.py): image to 3D pipeline run.
- [example_text.py](example_text.py): text to 3D pipeline run.
- [example_variant.py](example_variant.py): seed variants.
- [example_multi_image.py](example_multi_image.py): multi-image workflow.
- [generate.py](generate.py), [generate_multi.py](generate_multi.py): helper entry scripts.
- [Trellis_Final.ipynb](Trellis_Final.ipynb), [Trellis_UV.ipynb](Trellis_UV.ipynb): interactive notebook flows.

## Troubleshooting

- Stuck on loading screen:
   - Check both servers are running (inference on 8000, webapp on 8010).
   - Open webapp logs and verify `/api/status/{job_id}` is reachable.
- `Internal Server Error` from result fetch:
   - Check inference API terminal for model/pipeline exceptions.
- Slow or failed generations:
   - Verify GPU memory headroom.
   - Reduce concurrent jobs.
- Missing files after many runs:
   - Storage trim and cleanup may remove older artifacts.

## License and attribution

- This repository remains under [MIT License](LICENSE).
- Some bundled/submodule components include their own licenses.
- Please cite TRELLIS if you publish work based on these models:

```bibtex
@article{xiang2024structured,
      title   = {Structured 3D Latents for Scalable and Versatile 3D Generation},
      author  = {Xiang, Jianfeng and Lv, Zelong and Xu, Sicheng and Deng, Yu and Wang, Ruicheng and Zhang, Bowen and Chen, Dong and Tong, Xin and Yang, Jiaolong},
      journal = {arXiv preprint arXiv:2412.01506},
      year    = {2024}
}
```

