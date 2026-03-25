// Tab navigation
const tabLinks = document.querySelectorAll('.tab-link');
const tabPanels = document.querySelectorAll('.tab-panel');

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

tabLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = link.dataset.tab;
    showTab(target);
  });
});

const initialTab = window.location.hash.replace('#', '') || 'home';
showTab(initialTab);

// Generation workflow
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const emptyPreview = document.getElementById('emptyPreview');
const fileMeta = document.getElementById('fileMeta');
const generateBtn = document.getElementById('generateBtn');
const resetBtn = document.getElementById('resetBtn');
const dropzone = document.getElementById('dropzone');

const progressCard = document.getElementById('progressCard');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const progressStage = document.getElementById('progressStage');

let selectedFile = null;
let currentJobId = null;
let pollTimer = null;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setPreview(file) {
  const url = URL.createObjectURL(file);
  imagePreview.src = url;
  imagePreview.classList.remove('hidden');
  emptyPreview.classList.add('hidden');
  fileMeta.classList.remove('hidden');
  fileMeta.textContent = `${file.name} • ${formatFileSize(file.size)}`;
  generateBtn.disabled = false;
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
  progressCard.classList.add('hidden');
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  progressStage.textContent = 'Waiting to start...';
  if (pollTimer) clearInterval(pollTimer);
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

function clearViewer() {
  if (viewerAnimationFrame) cancelAnimationFrame(viewerAnimationFrame);
  if (viewerRenderer) {
    viewerRenderer.dispose();
    viewerRenderer = null;
  }
  window.removeEventListener('resize', onViewerResize);
  if (modalViewer) {
    modalViewer.innerHTML = '';
  }
  viewerScene = null;
  viewerCamera = null;
  viewerControls = null;
  viewerObject = null;
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
  if (viewerControls) viewerControls.update();
  if (viewerRenderer && viewerScene && viewerCamera) {
    viewerRenderer.render(viewerScene, viewerCamera);
  }
}

function onViewerResize() {
  if (!viewerRenderer || !viewerCamera || !modalViewer) return;
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

async function openViewer(item) {
  if (!modal) return;
  clearViewer();
  modal.classList.remove('hidden');
  modalTitle.textContent = item.title || 'Model preview';
  modalSubtitle.textContent = item.model_type ? `${item.model_type.toUpperCase()} file` : '';
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