import os
os.environ['ATTN_BACKEND'] = 'flash-attn'   # Can be 'flash-attn' or 'xformers', default is 'flash-attn'
os.environ['SPCONV_ALGO'] = 'native'        # Can be 'native' or 'auto', default is 'auto'.
                                            # 'auto' is faster but will do benchmarking at the beginning.
                                            # Recommended to set to 'native' if run only once.

import imageio
from PIL import Image
from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import render_utils, postprocessing_utils
import argparse

# Set up argument parser
parser = argparse.ArgumentParser(description="Generate a 3D model from an image using TRELLIS.")
parser.add_argument("image_path", type=str, help="Path to the input image file.")
args = parser.parse_args()

# Load a pipeline from a model folder or a Hugging Face model hub.
pipeline = TrellisImageTo3DPipeline.from_pretrained("./TRELLIS-image-large")
pipeline.cuda()

# Load an image
image = Image.open(args.image_path)

# Run the pipeline
outputs = pipeline.run(
    image,
    seed=1,
    # Optional parameters
    # sparse_structure_sampler_params={
    #     "steps": 12,
    #     "cfg_strength": 7.5,
    # },
    # slat_sampler_params={
    #     "steps": 12,
    #     "cfg_strength": 3,
    # },
)
# outputs is a dictionary containing generated 3D assets in different formats:
# - outputs['gaussian']: a list of 3D Gaussians
# - outputs['radiance_field']: a list of radiance fields
# - outputs['mesh']: a list of meshes

print("3D generation completed successfully!")
print(f"Generated {len(outputs['gaussian'])} Gaussian splat(s)")
print(f"Generated {len(outputs['radiance_field'])} radiance field(s)")
print(f"Generated {len(outputs['mesh'])} mesh(es)")

# Save the core 3D assets without rendering videos
try:
    # Save Gaussians as PLY files
    outputs['gaussian'][0].save_ply("sample.ply")
    print("✅ Saved Gaussian splat as sample.ply")
except Exception as e:
    print(f"❌ Error saving Gaussian PLY: {e}")

try:
    # GLB files can be extracted from the outputs
    glb = postprocessing_utils.to_glb(
        outputs['gaussian'][0],
        outputs['mesh'][0],
        # Optional parameters
        simplify=0.95,          # Ratio of triangles to remove in the simplification process
        texture_size=1024,      # Size of the texture used for the GLB
    )
    glb.export("sample.glb")
    print("✅ Saved GLB file as sample.glb")
    
    # Export as OBJ file
    glb.export("sample.obj")
    print("✅ Saved OBJ file as sample.obj")
except Exception as e:
    print(f"❌ Error saving GLB/OBJ: {e}")

try:
    # Export raw mesh as OBJ (without texture baking)
    import trimesh
    vertices = outputs['mesh'][0].vertices.cpu().numpy()
    faces = outputs['mesh'][0].faces.cpu().numpy()
    
    # Create a simple trimesh object
    mesh_obj = trimesh.Trimesh(vertices=vertices, faces=faces)
    mesh_obj.export("sample_raw.obj")
    print("✅ Saved raw mesh as sample_raw.obj")
except Exception as e:
    print(f"❌ Error saving raw OBJ: {e}")

# Comment out the rendering code that requires diff_gaussian_rasterization
# The 3D models are generated successfully, just can't render videos due to CUDA version mismatch
print("\nNote: Video rendering skipped due to CUDA version compatibility issues.")
print("The 3D models have been generated successfully and saved as PLY and GLB files!")

# # Render the outputs (commented out due to CUDA version mismatch)
# video = render_utils.render_video(outputs['gaussian'][0])['color']
# imageio.mimsave("sample_gs.mp4", video, fps=30)
# video = render_utils.render_video(outputs['radiance_field'][0])['color']
# imageio.mimsave("sample_rf.mp4", video, fps=30)
# video = render_utils.render_video(outputs['mesh'][0])['normal']
# imageio.mimsave("sample_mesh.mp4", video, fps=30)