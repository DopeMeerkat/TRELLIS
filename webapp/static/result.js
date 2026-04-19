function getJobId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("job");
}

function getSeed() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("seed");
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const errorText = document.getElementById("errorText");
const resultContent = document.getElementById("resultContent");
const resultImage = document.getElementById("resultImage");
const downloadObj = document.getElementById("downloadObj");
const resultMeta = document.getElementById("resultMeta");
const loadingHint = document.getElementById("loadingHint");
const qualityCard = document.getElementById("qualityCard");
const qualityRerunBtn = document.getElementById("qualityRerunBtn");
const qualityStatus = document.getElementById("qualityStatus");
const comparisonCard = document.getElementById("comparisonCard");
const comparisonMeta = document.getElementById("comparisonMeta");
const compareDownloadObj = document.getElementById("compareDownloadObj");
const resultViewerCard = document.getElementById("resultViewerCard");
const originalCompareViewport = document.getElementById("originalCompareViewport");
const regeneratedCompareViewport = document.getElementById("regeneratedCompareViewport");

let currentResult = null;
let viewerAnimationFrame = null;
let singleViewer = null;
let compareViewers = [];
let compareSyncing = false;
let compareSyncUnsubscribers = [];

function orientObjectForViewer(object) {
  object.rotation.set(-Math.PI / 2, 0, 0);
}

function showError(message) {
  loadingState.classList.add("hidden");
  resultContent.classList.add("hidden");
  if (qualityCard) qualityCard.classList.add("hidden");
  if (comparisonCard) comparisonCard.classList.add("hidden");
  errorState.classList.remove("hidden");
  errorText.textContent = message;
}

function setQualityStatus(message) {
  if (!qualityStatus) return;
  qualityStatus.textContent = message || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseApiResponse(res, fallbackMessage) {
  const rawText = await res.text();
  let data = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (err) {
      data = null;
    }
  }

  if (!res.ok) {
    const detail = (data && (data.detail || data.error))
      ? String(data.detail || data.error)
      : (rawText || fallbackMessage || `Request failed with status ${res.status}`);
    throw new Error(detail);
  }

  return data || {};
}

async function fetchSourceImageBlob() {
  const sourceUrl = resultImage?.src;
  if (!sourceUrl) {
    throw new Error("Source image is not available.");
  }

  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error("Could not load the source image.");
  }

  return await res.blob();
}

async function waitForJobCompletion(jobId) {
  while (true) {
    const statusRes = await fetch(`/api/status/${jobId}`);
    const statusData = await parseApiResponse(statusRes, "Could not load job status.");

    if (statusData.status === "error") {
      throw new Error(statusData.error || "Generation failed.");
    }

    if (statusData.status === "done") {
      return;
    }

    if (loadingHint) {
      const stage = statusData.stage || "Generating";
      const progress = Number.isFinite(statusData.progress) ? `${statusData.progress}%` : "";
      loadingHint.textContent = progress ? `${stage} (${progress})` : stage;
    }

    await sleep(1500);
  }
}

async function startQualityRerun() {
  if (!currentResult || !qualityRerunBtn) return;

  qualityRerunBtn.disabled = true;
  setQualityStatus("Preparing source image...");

  try {
    const sourceBlob = await fetchSourceImageBlob();
    const formData = new FormData();
    formData.append("source_job_id", currentResult.jobId);
    formData.append("image", sourceBlob, "source-image.png");
    if (Number.isFinite(currentResult.seed)) {
      formData.append("seed", String(currentResult.seed));
    }

    setQualityStatus("Starting higher-quality rerun...");

    const res = await fetch("/api/rerun-quality", {
      method: "POST",
      body: formData,
    });
    const data = await parseApiResponse(res, "Could not start quality rerun.");

    setQualityStatus("Rerun started. Redirecting to new result page...");
    const nextUrl = Number.isFinite(data.seed)
      ? `/result?job=${data.job_id}&seed=${data.seed}`
      : (data.result_page || `/result?job=${data.job_id}`);
    window.location.href = nextUrl;
  } catch (err) {
    setQualityStatus(err.message || "Could not start quality rerun.");
    qualityRerunBtn.disabled = false;
  }
}

function createViewerState(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9edf5);

  const width = container.clientWidth || 400;
  const height = container.clientHeight || 320;

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(2.5, 2.0, 3.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
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

  return { container, scene, camera, renderer, controls };
}

function disposeViewer(viewer) {
  if (!viewer) return;
  try {
    viewer.renderer.dispose();
  } catch (err) {
    // Ignore cleanup errors.
  }
}

function clearViewerState() {
  if (viewerAnimationFrame) cancelAnimationFrame(viewerAnimationFrame);
  viewerAnimationFrame = null;
  window.removeEventListener("resize", onResize);
  compareSyncUnsubscribers.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      // Ignore cleanup errors.
    }
  });
  compareSyncUnsubscribers = [];
  compareSyncing = false;
  disposeViewer(singleViewer);
  compareViewers.forEach(disposeViewer);
  singleViewer = null;
  compareViewers = [];
}

function syncCompareFrom(sourceViewer) {
  if (compareSyncing) return;
  compareSyncing = true;

  compareViewers.forEach((viewer) => {
    if (viewer === sourceViewer) return;
    viewer.camera.position.copy(sourceViewer.camera.position);
    viewer.camera.quaternion.copy(sourceViewer.camera.quaternion);
    viewer.controls.target.copy(sourceViewer.controls.target);
    viewer.camera.updateProjectionMatrix();
    viewer.controls.update();
  });

  compareSyncing = false;
}

function wireCompareSync() {
  compareSyncUnsubscribers.forEach((fn) => fn());
  compareSyncUnsubscribers = [];

  compareViewers.forEach((viewer) => {
    const handleChange = () => syncCompareFrom(viewer);
    viewer.controls.addEventListener("change", handleChange);
    compareSyncUnsubscribers.push(() => viewer.controls.removeEventListener("change", handleChange));
  });

  if (compareViewers.length > 0) {
    syncCompareFrom(compareViewers[0]);
  }
}

function fitCameraToViewer(viewer, object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = viewer.camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2));
  cameraZ *= 1.8;

  viewer.camera.position.set(cameraZ * 0.8, cameraZ * 0.6, cameraZ);
  viewer.camera.near = maxDim / 100;
  viewer.camera.far = maxDim * 100;
  viewer.camera.updateProjectionMatrix();

  viewer.controls.target.set(0, 0, 0);
  viewer.controls.update();
}

async function loadModel(url, color = 0x5a8dee) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.OBJLoader();
    loader.load(
      url,
      (obj) => {
        orientObjectForViewer(obj);
        obj.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              color,
              metalness: 0.15,
              roughness: 0.7,
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

function animateViewers() {
  viewerAnimationFrame = requestAnimationFrame(animateViewers);

  if (singleViewer) {
    singleViewer.controls.update();
    singleViewer.renderer.render(singleViewer.scene, singleViewer.camera);
  }

  compareViewers.forEach((viewer) => {
    viewer.controls.update();
    viewer.renderer.render(viewer.scene, viewer.camera);
  });
}

function onResize() {
  if (singleViewer) {
    const width = singleViewer.container.clientWidth;
    const height = singleViewer.container.clientHeight;
    singleViewer.camera.aspect = width / height;
    singleViewer.camera.updateProjectionMatrix();
    singleViewer.renderer.setSize(width, height);
  }

  compareViewers.forEach((viewer) => {
    const width = viewer.container.clientWidth || 400;
    const height = viewer.container.clientHeight || 320;
    viewer.camera.aspect = width / height;
    viewer.camera.updateProjectionMatrix();
    viewer.renderer.setSize(width, height);
  });
}

async function loadSingleViewer(modelUrl) {
  clearViewerState();
  if (comparisonCard) comparisonCard.classList.add("hidden");
  if (resultViewerCard) resultViewerCard.classList.remove("hidden");
  resultContent.classList.remove("result-grid--compare");
  if (compareDownloadObj) {
    compareDownloadObj.classList.add("hidden");
    compareDownloadObj.removeAttribute("href");
  }

  const container = document.getElementById("viewer");
  singleViewer = createViewerState(container);

  const object = await loadModel(modelUrl, 0x5a8dee);
  singleViewer.scene.add(object);
  fitCameraToViewer(singleViewer, object);

  window.addEventListener("resize", onResize);
  animateViewers();
}

async function loadComparisonViewers(originalResult, rerunResult) {
  clearViewerState();
  if (resultViewerCard) resultViewerCard.classList.add("hidden");
  if (comparisonCard) comparisonCard.classList.remove("hidden");
  resultContent.classList.add("result-grid--compare");

  compareViewers = [
    createViewerState(originalCompareViewport),
    createViewerState(regeneratedCompareViewport),
  ];

  const originalObject = await loadModel(originalResult.output_url, 0x7c8797);
  compareViewers[0].scene.add(originalObject);
  fitCameraToViewer(compareViewers[0], originalObject);

  const rerunObject = await loadModel(rerunResult.output_url, 0x2b66c3);
  compareViewers[1].scene.add(rerunObject);
  fitCameraToViewer(compareViewers[1], rerunObject);
  wireCompareSync();

  if (compareDownloadObj) {
    compareDownloadObj.href = rerunResult.output_url;
    compareDownloadObj.classList.remove("hidden");
  }

  if (comparisonMeta) {
    comparisonMeta.textContent = "Original model on the left, higher-quality rerun on the right.";
  }

  window.addEventListener("resize", onResize);
  animateViewers();
}

async function initPage() {
  const jobId = getJobId();
  const seed = getSeed();
  if (!jobId) {
    showError("Missing job id.");
    return;
  }

  try {
    await waitForJobCompletion(jobId);

    const resultUrl = seed === null ? `/api/result/${jobId}` : `/api/result/${jobId}?seed=${seed}`;
    const resultRes = await fetch(resultUrl);
    const resultData = await parseApiResponse(resultRes, "Could not load result.");

    loadingState.classList.add("hidden");
    resultContent.classList.remove("hidden");
    if (qualityCard) qualityCard.classList.remove("hidden");

    resultImage.src = resultData.input_url;
    downloadObj.href = resultData.output_url;
    currentResult = {
      jobId,
      seed: Number.isFinite(resultData.seed) ? resultData.seed : (seed === null ? null : seed),
      mode: resultData.mode,
      sourceJobId: resultData.source_job_id || null,
      sourceSeed: Number.isFinite(resultData.source_seed) ? resultData.source_seed : null,
    };

    if (resultMeta) {
      const pieces = [];
      if (resultData.mode === "variants") {
        pieces.push(`Seed ${resultData.seed}`);
        if (typeof resultData.runtime_seconds === "number") {
          pieces.push(`Runtime ${resultData.runtime_seconds.toFixed(2)}s`);
        }
      } else {
        pieces.push("Single generation");
      }
      if (resultData.quality_preset) {
        pieces.push(`Quality ${String(resultData.quality_preset).toUpperCase()}`);
      }
      resultMeta.textContent = pieces.join(" • ");
    }

    if (qualityRerunBtn) {
      qualityRerunBtn.disabled = false;
      qualityRerunBtn.onclick = startQualityRerun;
    }
    setQualityStatus("");

    if (resultData.source_job_id) {
      const sourceSeed = Number.isFinite(resultData.source_seed) ? resultData.source_seed : currentResult.seed;
      const sourceUrl = sourceSeed === null
        ? `/api/result/${resultData.source_job_id}`
        : `/api/result/${resultData.source_job_id}?seed=${sourceSeed}`;
      const sourceRes = await fetch(sourceUrl);
      const sourceData = await parseApiResponse(sourceRes, "Could not load original result for comparison.");

      await loadComparisonViewers(sourceData, resultData);
    } else {
      await loadSingleViewer(resultData.output_url);
    }
  } catch (err) {
    showError(err.message || "Something went wrong.");
  }
}

initPage();