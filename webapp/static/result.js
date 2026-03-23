function getJobId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("job");
}

const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const errorText = document.getElementById("errorText");
const resultContent = document.getElementById("resultContent");
const resultImage = document.getElementById("resultImage");
const downloadObj = document.getElementById("downloadObj");

let scene, camera, renderer, controls, currentObject;

function showError(message) {
  loadingState.classList.add("hidden");
  resultContent.classList.add("hidden");
  errorState.classList.remove("hidden");
  errorText.textContent = message;
}

function initViewer() {
  const container = document.getElementById("viewer");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9edf5);

  camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.set(2.5, 2.0, 3.5);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);

  const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
  dir1.position.set(4, 6, 5);
  scene.add(dir1);

  const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
  dir2.position.set(-4, 2, -3);
  scene.add(dir2);

  const grid = new THREE.GridHelper(10, 10, 0x999999, 0xcccccc);
  grid.position.y = -1.2;
  scene.add(grid);

  window.addEventListener("resize", onResize);
  animate();
}

function onResize() {
  const container = document.getElementById("viewer");
  if (!container || !renderer || !camera) return;

  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2));
  cameraZ *= 1.8;

  camera.position.set(cameraZ * 0.8, cameraZ * 0.6, cameraZ);
  camera.near = maxDim / 100;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();
}

async function loadOBJ(objUrl) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.OBJLoader();
    loader.load(
      objUrl,
      (obj) => {
        obj.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x5a8dee,
              metalness: 0.15,
              roughness: 0.7
            });
          }
        });
        resolve(obj);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

async function initPage() {
  const jobId = getJobId();
  if (!jobId) {
    showError("Missing job id.");
    return;
  }

  try {
    const statusRes = await fetch(`/api/status/${jobId}`);
    const statusData = await statusRes.json();

    if (!statusRes.ok) {
      throw new Error(statusData.detail || "Could not load job status.");
    }

    if (statusData.status === "error") {
      throw new Error(statusData.error || "Generation failed.");
    }

    if (statusData.status !== "done") {
      window.location.href = `/?pending=${jobId}`;
      return;
    }

    const resultRes = await fetch(`/api/result/${jobId}`);
    const resultData = await resultRes.json();

    if (!resultRes.ok) {
      throw new Error(resultData.detail || "Could not load result.");
    }

    loadingState.classList.add("hidden");
    resultContent.classList.remove("hidden");

    resultImage.src = resultData.input_url;
    downloadObj.href = resultData.output_url;

    initViewer();

    currentObject = await loadOBJ(resultData.output_url);
    scene.add(currentObject);
    fitCameraToObject(currentObject);
  } catch (err) {
    showError(err.message || "Something went wrong.");
  }
}

initPage();