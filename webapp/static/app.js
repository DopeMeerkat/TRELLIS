const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
const emptyPreview = document.getElementById("emptyPreview");
const fileMeta = document.getElementById("fileMeta");
const generateBtn = document.getElementById("generateBtn");
const resetBtn = document.getElementById("resetBtn");
const dropzone = document.getElementById("dropzone");

const progressCard = document.getElementById("progressCard");
const progressFill = document.getElementById("progressFill");
const progressPercent = document.getElementById("progressPercent");
const progressStage = document.getElementById("progressStage");

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
  imagePreview.classList.remove("hidden");
  emptyPreview.classList.add("hidden");
  fileMeta.classList.remove("hidden");
  fileMeta.textContent = `${file.name} • ${formatFileSize(file.size)}`;
  generateBtn.disabled = false;
}

function resetUI() {
  selectedFile = null;
  currentJobId = null;
  imageInput.value = "";
  imagePreview.src = "";
  imagePreview.classList.add("hidden");
  emptyPreview.classList.remove("hidden");
  fileMeta.classList.add("hidden");
  fileMeta.textContent = "";
  generateBtn.disabled = true;
  progressCard.classList.add("hidden");
  progressFill.style.width = "0%";
  progressPercent.textContent = "0%";
  progressStage.textContent = "Waiting to start...";
  if (pollTimer) clearInterval(pollTimer);
}

imageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  setPreview(file);
});

resetBtn.addEventListener("click", resetUI);

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return;
  selectedFile = file;
  setPreview(file);
});

async function pollStatus(jobId) {
  const res = await fetch(`/api/status/${jobId}`);
  const data = await res.json();

  progressFill.style.width = `${data.progress}%`;
  progressPercent.textContent = `${data.progress}%`;
  progressStage.textContent = data.stage;

  if (data.status === "done") {
    clearInterval(pollTimer);
    window.location.href = `/result?job=${jobId}`;
  }

  if (data.status === "error") {
    clearInterval(pollTimer);
    progressFill.style.width = "100%";
    progressPercent.textContent = "Failed";
    progressStage.textContent = data.error || "Generation failed.";
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  generateBtn.disabled = true;
  progressCard.classList.remove("hidden");
  progressStage.textContent = "Uploading image";

  const formData = new FormData();
  formData.append("image", selectedFile);

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Upload failed");
    }

    currentJobId = data.job_id;

    await pollStatus(currentJobId);
    pollTimer = setInterval(() => pollStatus(currentJobId), 1500);
  } catch (err) {
    progressCard.classList.remove("hidden");
    progressStage.textContent = err.message || "Something went wrong.";
    generateBtn.disabled = false;
  }
});

resetUI();