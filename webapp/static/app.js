// Tab navigation
const tabLinks = document.querySelectorAll('.tab-link');
const tabPanels = document.querySelectorAll('.tab-panel');
const modeTabs = document.querySelectorAll('.mode-tab');
const singleModePanel = document.getElementById('singleModePanel');
const variantModePanel = document.getElementById('variantModePanel');

function showTab(tabName) {
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabName);
    panel.classList.toggle('hidden', panel.id !== tabName);
  });

  tabLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.tab === tabName);
  });

  if (tabName) {
    history.replaceState(null, '', `#${tabName}`);
  }
}

function showGenerationMode(mode) {
  if (!singleModePanel || !variantModePanel) return;

  const isSingle = mode !== 'variants';
  singleModePanel.classList.toggle('active', isSingle);
  singleModePanel.classList.toggle('hidden', !isSingle);
  variantModePanel.classList.toggle('active', !isSingle);
  variantModePanel.classList.toggle('hidden', isSingle);

  modeTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === (isSingle ? 'single' : 'variants'));
  });
}

tabLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = link.dataset.tab;
    showTab(target);
  });
});

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    showGenerationMode(tab.dataset.mode || 'single');
  });
});

const initialTab = window.location.hash.replace('#', '') || 'home';
showTab(initialTab);
showGenerationMode('single');

// Generation workflow
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const emptyPreview = document.getElementById('emptyPreview');
const fileMeta = document.getElementById('fileMeta');
const generateBtn = document.getElementById('generateBtn');
const generateVariantsBtn = document.getElementById('generateVariantsBtn');
const resetBtn = document.getElementById('resetBtn');
const resetBtnVariant = document.getElementById('resetBtnVariant');
const dropzone = document.getElementById('dropzone');
const variantCountInput = document.getElementById('variantCount');
const variantSeedInput = document.getElementById('variantSeed');

const progressCard = document.getElementById('progressCard');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const progressStage = document.getElementById('progressStage');

const variantResultsCard = document.getElementById('variantResultsCard');
const variantSummary = document.getElementById('variantSummary');
const multiviewBtn = document.getElementById('multiviewBtn');
const variantGallery = document.getElementById('variantGallery');
const variantGalleryEmpty = document.getElementById('variantGalleryEmpty');

let selectedFile = null;
let currentJobId = null;
let pollTimer = null;
let variantPollTimer = null;
let currentVariantJobId = null;
let currentVariantState = null;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getVariantCount() {
  const value = Number.parseInt(variantCountInput?.value || '4', 10);
  if (!Number.isFinite(value) || value < 1) return 4;
  return Math.min(value, 4);
}

function getVariantSeed() {
  const rawValue = variantSeedInput?.value?.trim();
  if (!rawValue) return '';
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

function clearVariantPolling() {
  if (variantPollTimer) clearInterval(variantPollTimer);
  variantPollTimer = null;
}

function resetVariantUI() {
  currentVariantJobId = null;
  currentVariantState = null;
  clearVariantPolling();

  if (variantResultsCard) variantResultsCard.classList.add('hidden');
  if (variantGallery) variantGallery.innerHTML = '';
  if (variantGallery) variantGallery.classList.add('hidden');
  if (variantGalleryEmpty) {
    variantGalleryEmpty.textContent = 'No variants yet.';
    variantGalleryEmpty.classList.remove('hidden');
  }
  if (variantSummary) variantSummary.textContent = 'Generated variants will appear here.';
  if (multiviewBtn) multiviewBtn.disabled = true;
}

function setPreview(file) {
  const url = URL.createObjectURL(file);
  imagePreview.src = url;
  imagePreview.classList.remove('hidden');
  emptyPreview.classList.add('hidden');
  fileMeta.classList.remove('hidden');
  fileMeta.textContent = `${file.name} • ${formatFileSize(file.size)}`;
  generateBtn.disabled = false;
  if (generateVariantsBtn) generateVariantsBtn.disabled = false;
}

function resetUI() {
  selectedFile = null;
  currentJobId = null;
  imageInput.value = '';
  imagePreview.src = '';
  imagePreview.classList.add('hidden');
  emptyPreview.classList.remove('hidden');
  fileMeta.classList.add('hidden');
  fileMeta.textContent = '';
  generateBtn.disabled = true;
  if (generateVariantsBtn) generateVariantsBtn.disabled = true;
  progressCard.classList.add('hidden');
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  progressStage.textContent = 'Waiting to start...';
  if (pollTimer) clearInterval(pollTimer);
  resetVariantUI();
}

if (imageInput) {
  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    setPreview(file);
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', resetUI);
}

if (resetBtnVariant) {
  resetBtnVariant.addEventListener('click', resetUI);
}

if (dropzone) {
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    selectedFile = file;
    setPreview(file);
  });
}

async function pollStatus(jobId) {
  const res = await fetch(`/api/status/${jobId}`);
  const data = await res.json();

  progressFill.style.width = `${data.progress}%`;
  progressPercent.textContent = `${data.progress}%`;
  progressStage.textContent = data.stage;

  if (data.status === 'done') {
    clearInterval(pollTimer);
    window.location.href = `/result?job=${jobId}`;
  }

  if (data.status === 'error') {
    clearInterval(pollTimer);
    progressFill.style.width = '100%';
    progressPercent.textContent = 'Failed';
    progressStage.textContent = data.error || 'Generation failed.';
    generateBtn.disabled = false;
  }
}

function formatRuntime(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return 'Unknown';
  return `${seconds.toFixed(2)}s`;
}

function buildVariantItem(jobData, variant) {
  const title = `Variant ${variant.index || variant.variant_id || ''}`.trim();
  return {
    job_id: jobData.job_id,
    title,
    model_url: variant.output_url,
    model_type: 'obj',
    preview_image: jobData.input_url,
    input_image: jobData.input_url,
    seed: variant.seed,
    runtime_seconds: variant.runtime_seconds,
    error: variant.error,
    subtitle: `Seed ${variant.seed} • Runtime ${formatRuntime(variant.runtime_seconds)}`,
    result_page: `/result?job=${jobData.job_id}&seed=${variant.seed}`,
    active: jobData.active_seed === variant.seed,
  };
}

function setVariantGalleryState(jobData) {
  currentVariantJobId = jobData.job_id;
  currentVariantState = jobData;

  const completedCount = Array.isArray(jobData.variants)
    ? jobData.variants.filter((variant) => variant.status === 'done' && variant.output_url).length
    : 0;

  if (variantSummary) {
    const baseSeed = jobData.base_seed;
    if (Number.isInteger(baseSeed)) {
      variantSummary.textContent = `Batch seed ${baseSeed} • ${completedCount} variant${completedCount === 1 ? '' : 's'} ready.`;
    } else {
      variantSummary.textContent = `${completedCount} variant${completedCount === 1 ? '' : 's'} ready.`;
    }
  }

  if (multiviewBtn) {
    multiviewBtn.disabled = completedCount < 2;
  }
}

function renderVariantGallery(jobData) {
  if (!variantResultsCard || !variantGallery || !variantGalleryEmpty) return;

  const variants = Array.isArray(jobData.variants) ? jobData.variants : [];
  variantResultsCard.classList.remove('hidden');
  setVariantGalleryState(jobData);

  variantGallery.innerHTML = '';

  if (!variants.length) {
    variantGallery.classList.add('hidden');
    variantGalleryEmpty.classList.remove('hidden');
    variantGalleryEmpty.textContent = 'No completed variants yet.';
    return;
  }

  variantGalleryEmpty.classList.add('hidden');
  variantGallery.classList.remove('hidden');

  variants.forEach((variant) => {
    const item = buildVariantItem(jobData, variant);
    const card = renderVariantCard(item);
    variantGallery.appendChild(card);
  });
}

async function pollVariantStatus(jobId) {
  const res = await fetch(`/api/status/${jobId}`);
  const data = await res.json();

  progressFill.style.width = `${data.progress}%`;
  progressPercent.textContent = `${data.progress}%`;
  progressStage.textContent = data.stage;

  if (data.status === 'done') {
    clearInterval(variantPollTimer);
    if (generateBtn) generateBtn.disabled = false;
    if (generateVariantsBtn) generateVariantsBtn.disabled = false;
    renderVariantGallery(data);
  }

  if (data.status === 'error') {
    clearInterval(variantPollTimer);
    progressFill.style.width = '100%';
    progressPercent.textContent = 'Failed';
    progressStage.textContent = data.error || 'Variant generation failed.';
    if (generateBtn) generateBtn.disabled = false;
    if (generateVariantsBtn) generateVariantsBtn.disabled = false;
    renderVariantGallery(data);
  }

  return data;
}

async function startVariantGeneration() {
  if (!selectedFile || !generateVariantsBtn) return;

  if (generateBtn) generateBtn.disabled = true;
  generateVariantsBtn.disabled = true;
  progressCard.classList.remove('hidden');
  progressStage.textContent = 'Uploading image';
  resetVariantUI();

  const formData = new FormData();
  formData.append('image', selectedFile);
  formData.append('variant_count', String(getVariantCount()));
  formData.append('base_seed', getVariantSeed());

  try {
    const res = await fetch('/api/generate-variants', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Variant generation failed');
    }

    currentVariantJobId = data.job_id;
    if (variantSummary) {
      variantSummary.textContent = `Generating ${data.requested_count} variants from seed ${data.base_seed}.`;
    }

    const initialStatus = await pollVariantStatus(currentVariantJobId);
    clearVariantPolling();
    if (initialStatus.status !== 'done' && initialStatus.status !== 'error') {
      variantPollTimer = setInterval(() => pollVariantStatus(currentVariantJobId), 1500);
    }
  } catch (err) {
    progressCard.classList.remove('hidden');
    progressStage.textContent = err.message || 'Something went wrong.';
    generateVariantsBtn.disabled = false;
  }
}

if (generateBtn) {
  generateBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    generateBtn.disabled = true;
    progressCard.classList.remove('hidden');
    progressStage.textContent = 'Uploading image';

    const formData = new FormData();
    formData.append('image', selectedFile);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Upload failed');
      }

      currentJobId = data.job_id;

      await pollStatus(currentJobId);
      pollTimer = setInterval(() => pollStatus(currentJobId), 1500);
    } catch (err) {
      progressCard.classList.remove('hidden');
      progressStage.textContent = err.message || 'Something went wrong.';
      generateBtn.disabled = false;
    }
  });
}

if (generateVariantsBtn) {
  generateVariantsBtn.addEventListener('click', async () => {
    await startVariantGeneration();
  });
}

if (multiviewBtn) {
  multiviewBtn.addEventListener('click', async () => {
    if (!currentVariantState) return;
    const variants = Array.isArray(currentVariantState.variants)
      ? currentVariantState.variants.filter((variant) => variant.status === 'done' && variant.output_url)
      : [];
    if (variants.length < 2) return;
    await openVariantComparison(currentVariantState.base_seed ?? null);
  });
}

resetUI();

// Gallery
const galleryGrid = document.getElementById('galleryGrid');
const galleryEmpty = document.getElementById('galleryEmpty');

const modal = document.getElementById('viewerModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalSubtitle = document.getElementById('modalSubtitle');
const modalViewer = document.getElementById('modalViewer');
const modalDownload = document.getElementById('modalDownload');

let viewerScene = null;
let viewerCamera = null;
let viewerRenderer = null;
let viewerControls = null;
let viewerObject = null;
let viewerAnimationFrame = null;
let viewerMode = 'single';
let compareViews = [];
let syncingViews = false;

function orientObjectForViewer(object, modelUrl) {
  // Convert TRELLIS raw OBJ orientation to the viewer convention.
  if (String(modelUrl || '').toLowerCase().endsWith('.obj')) {
    object.rotation.set(-Math.PI / 2, 0,0);
  }
}

function clearViewer() {
  if (viewerAnimationFrame) cancelAnimationFrame(viewerAnimationFrame);
  if (viewerRenderer) {
    viewerRenderer.dispose();
    viewerRenderer = null;
  }
  compareViews.forEach((view) => {
    try {
      view.renderer.dispose();
    } catch (e) {
      // Ignore dispose errors during cleanup.
    }
  });
  compareViews = [];
  window.removeEventListener('resize', onViewerResize);
  if (modalViewer) {
    modalViewer.innerHTML = '';
  }
  viewerScene = null;
  viewerCamera = null;
  viewerControls = null;
  viewerObject = null;
  viewerMode = 'single';
}

function initViewer() {
  if (!modalViewer) return;

  viewerScene = new THREE.Scene();
  viewerScene.background = new THREE.Color(0xe9edf5);

  const width = modalViewer.clientWidth || 800;
  const height = modalViewer.clientHeight || 520;

  viewerCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  viewerCamera.position.set(2.5, 2.0, 3.5);

  viewerRenderer = new THREE.WebGLRenderer({ antialias: true });
  viewerRenderer.setPixelRatio(window.devicePixelRatio);
  viewerRenderer.setSize(width, height);
  modalViewer.appendChild(viewerRenderer.domElement);

  viewerControls = new THREE.OrbitControls(viewerCamera, viewerRenderer.domElement);
  viewerControls.enableDamping = true;
  viewerControls.dampingFactor = 0.08;

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  viewerScene.add(ambient);

  const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
  dir1.position.set(4, 6, 5);
  viewerScene.add(dir1);

  const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
  dir2.position.set(-4, 2, -3);
  viewerScene.add(dir2);

  const grid = new THREE.GridHelper(10, 10, 0x999999, 0xcccccc);
  grid.position.y = -1.2;
  viewerScene.add(grid);

  window.addEventListener('resize', onViewerResize);

  animateViewer();
}

function animateViewer() {
  viewerAnimationFrame = requestAnimationFrame(animateViewer);
  if (viewerMode === 'compare') {
    compareViews.forEach((view) => {
      view.controls.update();
      view.renderer.render(view.scene, view.camera);
    });
    return;
  }

  if (viewerControls) viewerControls.update();
  if (viewerRenderer && viewerScene && viewerCamera) {
    viewerRenderer.render(viewerScene, viewerCamera);
  }
}

function onViewerResize() {
  if (!modalViewer) return;

  if (viewerMode === 'compare') {
    compareViews.forEach((view) => {
      const width = view.container.clientWidth || 400;
      const height = view.container.clientHeight || 260;
      view.camera.aspect = width / height;
      view.camera.updateProjectionMatrix();
      view.renderer.setSize(width, height);
    });
    return;
  }

  if (!viewerRenderer || !viewerCamera) return;
  const width = modalViewer.clientWidth;
  const height = modalViewer.clientHeight;
  viewerCamera.aspect = width / height;
  viewerCamera.updateProjectionMatrix();
  viewerRenderer.setSize(width, height);
}

function fitViewerToObject(object) {
  if (!viewerCamera || !viewerControls) return;
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = viewerCamera.fov * (Math.PI / 180);
  let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2));
  cameraZ *= 1.8;

  viewerCamera.position.set(cameraZ * 0.8, cameraZ * 0.6, cameraZ);
  viewerCamera.near = maxDim / 100;
  viewerCamera.far = maxDim * 100;
  viewerCamera.updateProjectionMatrix();

  viewerControls.target.set(0, 0, 0);
  viewerControls.update();
}

async function loadModel(url) {
  return new Promise((resolve, reject) => {
    const lower = url.toLowerCase();
    if (lower.endsWith('.obj')) {
      const loader = new THREE.OBJLoader();
      loader.load(
        url,
        (obj) => {
          orientObjectForViewer(obj, url);
          obj.traverse((child) => {
            if (child.isMesh) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x2b66c3,
                metalness: 0.2,
                roughness: 0.7,
              });
            }
          });
          resolve(obj);
        },
        undefined,
        (err) => reject(err)
      );
    } else if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
      const loader = new THREE.GLTFLoader();
      loader.load(
        url,
        (gltf) => resolve(gltf.scene || gltf.scenes[0]),
        undefined,
        (err) => reject(err)
      );
    } else {
      reject(new Error('Unsupported model type'));
    }
  });
}

function _syncCompareFrom(sourceView) {
  if (syncingViews) return;
  syncingViews = true;
  compareViews.forEach((view) => {
    if (view === sourceView) return;
    view.camera.position.copy(sourceView.camera.position);
    view.camera.quaternion.copy(sourceView.camera.quaternion);
    view.controls.target.copy(sourceView.controls.target);
    view.camera.updateProjectionMatrix();
    view.controls.update();
  });
  syncingViews = false;
}

function _createCompareViewCell(item, index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'compare-cell';

  const label = document.createElement('div');
  label.className = 'compare-label';
  label.textContent = `Seed ${item.seed}`;
  wrapper.appendChild(label);

  const viewport = document.createElement('div');
  viewport.className = 'compare-viewport';
  wrapper.appendChild(viewport);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9edf5);
  const camera = new THREE.PerspectiveCamera(60, 1.4, 0.1, 1000);
  camera.position.set(2.5, 2.0, 3.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(viewport.clientWidth || 400, viewport.clientHeight || 260);
  viewport.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.addEventListener('change', () => _syncCompareFrom(view));

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

  const view = {
    item,
    wrapper,
    container: viewport,
    scene,
    camera,
    renderer,
    controls,
    index,
  };
  return view;
}

async function openVariantComparison(seedToFocus) {
  if (!modal || !modalViewer || !currentVariantState) return;
  const variants = (currentVariantState.variants || []).filter((v) => v.status === 'done' && v.output_url);
  if (!variants.length) return;

  variants.sort((a, b) => {
    if (a.seed === seedToFocus) return -1;
    if (b.seed === seedToFocus) return 1;
    return (a.index || 0) - (b.index || 0);
  });

  const selected = variants.slice(0, 4).map((variant) => buildVariantItem(currentVariantState, variant));

  clearViewer();
  viewerMode = 'compare';
  modal.classList.remove('hidden');
  modalTitle.textContent = 'Variant Comparison';
  modalSubtitle.textContent = 'Up to 4 variants, synchronized camera controls.';
  modalDownload.href = selected[0].model_url;

  const grid = document.createElement('div');
  grid.className = 'compare-grid';
  modalViewer.appendChild(grid);

  compareViews = selected.map((item, idx) => {
    const view = _createCompareViewCell(item, idx);
    grid.appendChild(view.wrapper);
    return view;
  });

  for (const view of compareViews) {
    try {
      const obj = await loadModel(view.item.model_url);
      view.scene.add(obj);

      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fov = view.camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2));
      cameraZ *= 1.8;
      view.camera.position.set(cameraZ * 0.8, cameraZ * 0.6, cameraZ);
      view.camera.near = maxDim / 100;
      view.camera.far = maxDim * 100;
      view.camera.updateProjectionMatrix();
      view.controls.target.set(0, 0, 0);
      view.controls.update();
    } catch (err) {
      const error = document.createElement('div');
      error.className = 'error-text';
      error.textContent = `Failed loading seed ${view.item.seed}`;
      view.wrapper.appendChild(error);
    }
  }

  if (compareViews.length > 1) {
    _syncCompareFrom(compareViews[0]);
  }

  window.addEventListener('resize', onViewerResize);
  animateViewer();
}

async function openViewer(item) {
  if (!modal) return;
  clearViewer();
  modal.classList.remove('hidden');
  modalTitle.textContent = item.title || 'Model preview';
  modalSubtitle.textContent = item.subtitle || (item.model_type ? `${item.model_type.toUpperCase()} file` : '');
  modalDownload.href = item.model_url;

  initViewer();

  try {
    viewerObject = await loadModel(item.model_url);
    viewerScene.add(viewerObject);
    fitViewerToObject(viewerObject);
  } catch (err) {
    modalSubtitle.textContent = err.message || 'Unable to load model.';
  }
}

function closeModal() {
  if (!modal) return;
  modal.classList.add('hidden');
  clearViewer();
}

if (modalClose) {
  modalClose.addEventListener('click', closeModal);
}

if (modal) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

function renderGalleryItem(item) {
  const card = document.createElement('article');
  card.className = 'gallery-card';

  const thumb = document.createElement('div');
  thumb.className = 'gallery-card__thumb';

  const img = document.createElement('img');
  img.src = item.preview_image || item.input_image;
  img.alt = item.title || 'Gallery item';
  thumb.appendChild(img);

  const overlay = document.createElement('div');
  overlay.className = 'gallery-card__overlay';

  const title = document.createElement('div');
  title.className = 'gallery-card__title';
  title.textContent = item.title || 'Gallery item';
  overlay.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'gallery-card__actions';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-primary';
  viewBtn.textContent = 'View model';
  viewBtn.addEventListener('click', () => openViewer(item));

  const downloadBtn = document.createElement('a');
  downloadBtn.className = 'btn btn-secondary';
  downloadBtn.href = item.model_url;
  downloadBtn.download = '';
  downloadBtn.textContent = 'Download';

  actions.appendChild(viewBtn);
  actions.appendChild(downloadBtn);
  overlay.appendChild(actions);

  thumb.appendChild(overlay);
  card.appendChild(thumb);

  return card;
}

function renderVariantCard(item) {
  const card = document.createElement('article');
  card.className = 'variant-card';
  if (item.error) {
    card.classList.add('variant-card--error');
  }

  const thumb = document.createElement('div');
  thumb.className = 'variant-card__thumb';
  thumb.addEventListener('click', () => {
    if (item.model_url) openViewer(item);
  });

  const img = document.createElement('img');
  img.src = item.preview_image || item.input_image;
  img.alt = item.title || 'Variant preview';
  thumb.appendChild(img);

  const body = document.createElement('div');
  body.className = 'variant-card__body';

  const title = document.createElement('h3');
  title.className = 'variant-card__title';
  title.textContent = item.title || 'Variant';
  body.appendChild(title);

  const metadata = document.createElement('div');
  metadata.className = 'variant-metadata';
  metadata.innerHTML = `
    <div><strong>Seed:</strong> ${item.seed}</div>
    <div><strong>Runtime:</strong> ${formatRuntime(item.runtime_seconds)}</div>
    ${item.error ? `<div class="error-text"><strong>Error:</strong> ${item.error}</div>` : ''}
  `;
  body.appendChild(metadata);

  const actions = document.createElement('div');
  actions.className = 'variant-actions';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-primary';
  viewBtn.type = 'button';
  viewBtn.textContent = 'View';
  viewBtn.disabled = !item.model_url;
  viewBtn.addEventListener('click', () => openViewer(item));

  const useBtn = document.createElement('button');
  useBtn.className = 'btn btn-secondary';
  useBtn.type = 'button';
  useBtn.textContent = 'Use this';
  useBtn.disabled = !item.model_url;
  useBtn.addEventListener('click', () => {
    window.location.href = item.result_page || `/result?job=${item.job_id}&seed=${item.seed}`;
  });

  const downloadBtn = document.createElement('a');
  downloadBtn.className = 'btn btn-secondary';
  downloadBtn.href = item.model_url;
  downloadBtn.download = '';
  downloadBtn.textContent = 'Download';
  if (!item.model_url) {
    downloadBtn.classList.add('hidden');
  }

  actions.appendChild(viewBtn);
  actions.appendChild(useBtn);
  actions.appendChild(downloadBtn);

  body.appendChild(actions);

  card.appendChild(thumb);
  card.appendChild(body);

  return card;
}

async function loadGallery() {
  if (!galleryGrid || !galleryEmpty) return;

  try {
    const res = await fetch('/api/gallery');
    const items = await res.json();

    if (!res.ok) {
      throw new Error(items.detail || 'Failed to load gallery');
    }

    galleryGrid.innerHTML = '';

    if (!items.length) {
      galleryEmpty.classList.remove('hidden');
      galleryGrid.classList.add('hidden');
      return;
    }

    galleryEmpty.classList.add('hidden');
    galleryGrid.classList.remove('hidden');

    items.forEach((item) => {
      const card = renderGalleryItem(item);
      galleryGrid.appendChild(card);
    });
  } catch (err) {
    galleryEmpty.textContent = err.message || 'Unable to load gallery.';
    galleryEmpty.classList.remove('hidden');
    galleryGrid.classList.add('hidden');
  }
}

loadGallery();