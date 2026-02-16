import os
import argparse
from pathlib import Path
from PIL import Image

# Configure backends; adjust if your runtime lacks these packages.
os.environ.setdefault("ATTN_BACKEND", "flash-attn")
os.environ.setdefault("SPCONV_ALGO", "native")

from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils


def load_images_from_dir(image_dir: Path):
    exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    files = [p for p in sorted(image_dir.iterdir()) if p.suffix.lower() in exts]
    if not files:
        raise FileNotFoundError(f"No images found in: {image_dir}")
    return [Image.open(p) for p in files]


def main():
    parser = argparse.ArgumentParser(
        description="Generate 3D assets from a folder of multiview images using TRELLIS."
    )
    parser.add_argument(
        "image_dir",
        type=str,
        help="Directory containing multiview images of the same object (e.g., PNG/JPG).",
    )
    parser.add_argument(
        "output_prefix",
        type=str,
        help=(
            "Output path prefix (no extension). Files like <prefix>.ply, "
            "<prefix>.glb, and <prefix>.obj will be written."
        ),
    )
    args = parser.parse_args()

    image_dir = Path(args.image_dir)
    if not image_dir.exists() or not image_dir.is_dir():
        raise FileNotFoundError(f"Image directory not found: {image_dir}")

    output_prefix = Path(args.output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)

    images = load_images_from_dir(image_dir)

    # Load pipeline; ensure TRELLIS-image-large is available in the working directory.
    pipeline = TrellisImageTo3DPipeline.from_pretrained("./TRELLIS-image-large")
    pipeline.cuda()

    outputs = pipeline.run_multi_image(
        images,
        seed=1,
        # Optional: tweak sampler params if desired
        # sparse_structure_sampler_params={"steps": 12, "cfg_strength": 7.5},
        # slat_sampler_params={"steps": 12, "cfg_strength": 3},
    )

    print("3D multiview generation completed successfully!")
    print(f"Generated {len(outputs['gaussian'])} Gaussian splat(s)")
    print(f"Generated {len(outputs['radiance_field'])} radiance field(s)")
    print(f"Generated {len(outputs['mesh'])} mesh(es)")

    # Save Gaussians as PLY
    try:
        outputs["gaussian"][0].save_ply(str(output_prefix.with_suffix(".ply")))
        print(f"Saved Gaussian splat: {output_prefix.with_suffix('.ply')}")
    except Exception as e:  # noqa: BLE001
        print(f"Error saving Gaussian PLY: {e}")

    # Save GLB and OBJ
    try:
        glb = postprocessing_utils.to_glb(
            outputs["gaussian"][0],
            outputs["mesh"][0],
            simplify=0.95,
            texture_size=1024,
        )
        glb.export(str(output_prefix.with_suffix(".glb")))
        print(f"Saved GLB: {output_prefix.with_suffix('.glb')}")

        glb.export(str(output_prefix.with_suffix(".obj")))
        print(f"Saved OBJ: {output_prefix.with_suffix('.obj')}")
    except Exception as e:  # noqa: BLE001
        print(f"Error saving GLB/OBJ: {e}")

    # Save raw mesh OBJ (untextured)
    try:
        import trimesh

        vertices = outputs["mesh"][0].vertices.cpu().numpy()
        faces = outputs["mesh"][0].faces.cpu().numpy()
        mesh_obj = trimesh.Trimesh(vertices=vertices, faces=faces)
        mesh_obj.export(str(output_prefix.with_name(output_prefix.name + "_raw.obj")))
        print(f"Saved raw mesh OBJ: {output_prefix.with_name(output_prefix.name + '_raw.obj')}")
    except Exception as e:  # noqa: BLE001
        print(f"Error saving raw OBJ: {e}")

    print("Done. Rendering videos is omitted to keep the script lightweight.")


if __name__ == "__main__":
    main()
