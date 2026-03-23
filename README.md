TRELLIS Web App
======================

This is my personal fork of the Microsoft TRELLIS repo, focused on running the pretrained 3D generation pipelines through lightweight scripts, exploratory notebooks, and a small FastAPI web app. I kept the core TRELLIS generation code and swapped the environment management to `uv` for faster installs.

What is included
----------------
- Single-run scripts for quick generation: [example.py](example.py) (image to 3D), [example_text.py](example_text.py) (text to 3D), [example_variant.py](example_variant.py) (variants), [example_multi_image.py](example_multi_image.py) (multi-image), and the CLI-style helpers [generate.py](generate.py) and [generate_multi.py](generate_multi.py).
- Notebooks for interactive runs: [Trellis_Final.ipynb](Trellis_Final.ipynb) and [Trellis_UV.ipynb](Trellis_UV.ipynb).
- A minimal FastAPI web app in [webapp/app.py](webapp/app.py) with a separate `uv` environment.
- The original TRELLIS model weights, configs, and utilities so outputs match upstream quality.

Requirements
------------
- Linux with an NVIDIA GPU (16 GB+ recommended) and CUDA drivers that match the PyTorch/cu121 wheels used in this fork.
- Python 3.10.
- [`uv`](https://docs.astral.sh/uv/) for dependency management.
- Access to the Hugging Face TRELLIS checkpoints (see links below).

Setup with uv
-------------
1. Install `uv` if you do not have it yet.
2. Create and activate a virtual environment at the repo root:
   ```sh
   uv venv .venv
   source .venv/bin/activate
   uv sync
   ```
   The root [pyproject.toml](pyproject.toml) pins PyTorch 2.5.1 with CUDA 12.1 wheels plus kaolin, spconv, and rendering deps.
3. (Optional) Install the slimmer web app dependencies in isolation:
   ```sh
   cd webapp
   uv sync
   ```
   You can also reuse the root environment if you prefer a single env.

Pretrained models
-----------------
I reuse the official TRELLIS checkpoints from Hugging Face:
- Image to 3D: `microsoft/TRELLIS-image-large`
- Text to 3D: `microsoft/TRELLIS-text-{base,large,xlarge}`

The scripts load by repository name. To run fully offline, download the model repos locally and point `from_pretrained` to the folder path.

Quickstart
----------
- Image to 3D: run `python example.py`. It loads `assets/example_image/T.png`, generates Gaussian, radiance field, and mesh outputs, and saves MP4/GLB/PLY files next to the script. Edit the image path and sampler settings inside the script to use your own inputs.
- Text to 3D: run `python example_text.py` and change the prompt string in the file. Output files mirror the image example.
- Variants / multi-image: use [example_variant.py](example_variant.py) and [example_multi_image.py](example_multi_image.py) as templates; update the input images and seeds inline.
- Batch helpers: [generate.py](generate.py) and [generate_multi.py](generate_multi.py) wrap the same pipelines; adjust paths and seeds in the files to suit your run.
- Notebooks: open [Trellis_Final.ipynb](Trellis_Final.ipynb) or [Trellis_UV.ipynb](Trellis_UV.ipynb) after activating the root env. They mirror the script flows but make it easy to tweak sampler parameters interactively.
- Web app: in the repo root (or after `cd webapp`), start `uvicorn webapp.app:app --host 0.0.0.0 --port 8000 --reload`. Point a browser at the shown URL to try interactive generation. The app uses the same pipelines as the scripts.

Notes and scope
---------------
- This fork is generation-focused. I removed the upstream training instructions and dataset tooling from the README; the code is still present if you need it.
- Environment installs rely on the CUDA 12.1 wheels configured in [pyproject.toml](pyproject.toml). If your system CUDA differs, update the indices or wheel versions before syncing.
- All credit for the underlying research and models goes to the original TRELLIS authors.

License and attribution
-----------------------
- The project remains under the upstream [MIT License](LICENSE). Some bundled submodules (e.g., diffoctreerast, FlexiCubes modifications) carry their own licenses; see their linked LICENSE files.
- If you publish work based on these models, please cite the TRELLIS paper:
  ```bibtex
  @article{xiang2024structured,
      title   = {Structured 3D Latents for Scalable and Versatile 3D Generation},
      author  = {Xiang, Jianfeng and Lv, Zelong and Xu, Sicheng and Deng, Yu and Wang, Ruicheng and Zhang, Bowen and Chen, Dong and Tong, Xin and Yang, Jiaolong},
      journal = {arXiv preprint arXiv:2412.01506},
      year    = {2024}
  }
  ```

