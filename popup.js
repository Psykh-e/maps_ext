const elements = {
  form: document.getElementById("scrapeForm"),
  category: document.getElementById("category"),
  city: document.getElementById("city"),
  district: document.getElementById("district"),
  maxResults: document.getElementById("maxResults"),
  storageFolder: document.getElementById("storageFolder"),
  strictLocation: document.getElementById("strictLocation"),
  safeMode: document.getElementById("safeMode"),
  skipExisting: document.getElementById("skipExisting"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  importJsonBtn: document.getElementById("importJsonBtn"),
  importJsonInput: document.getElementById("importJsonInput"),
  viewArchiveBtn: document.getElementById("viewArchiveBtn"),
  copyLogsBtn: document.getElementById("copyLogsBtn"),
  clearLogsBtn: document.getElementById("clearLogsBtn"),
  clearBtn: document.getElementById("clearBtn"),
  statusText: document.getElementById("statusText"),
  countText: document.getElementById("countText"),
  archiveText: document.getElementById("archiveText"),
  messageText: document.getElementById("messageText"),
  errorText: document.getElementById("errorText"),
  progressFill: document.getElementById("progressFill"),
  resultsBody: document.getElementById("resultsBody"),
  logsText: document.getElementById("logsText")
};

let formHydrated = false;
let currentState = null;

function clampProgress(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, num));
}

function phaseToLabel(state) {
  const phase = String(state?.phase || "").toLowerCase();
  const status = String(state?.status || "").toLowerCase();

  if (status === "error") return "Hata";
  if (status === "done") return "Tamamlandi";
  if (status === "stopped") return "Durduruldu";
  if (phase === "hazirlaniyor") return "Hazirlaniyor";
  if (phase === "toplaniyor") return "Toplaniyor";
  if (phase === "filtreleniyor") return "Filtreleniyor";
  if (phase === "tamamlandi") return "Tamamlandi";
  return "Hazir";
}

function getSettingsFromForm() {
  return {
    category: elements.category.value.trim(),
    city: elements.city.value.trim(),
    district: elements.district.value.trim(),
    maxResults: Number.parseInt(elements.maxResults.value, 10) || 100,
    storageFolder: elements.storageFolder.value.trim(),
    strictLocation: false,
    safeMode: elements.safeMode.checked,
    skipExisting: elements.skipExisting.checked,
    autoSave: true
  };
}

function parseDistricts(input) {
  return String(input || "")
    .split(/[\n,;]+/g)
    .map((district) => district.trim())
    .filter(Boolean);
}

function hydrateFormFromState(state) {
  if (formHydrated || !state?.settings) {
    return;
  }
  const settings = state.settings;
  elements.category.value = settings.category || "";
  elements.city.value = settings.city || "";
  elements.district.value = state.batch?.originalDistrictText || settings.district || "";
  elements.maxResults.value = Number.isFinite(settings.maxResults) ? settings.maxResults : 100;
  elements.storageFolder.value = settings.storageFolder || "maps-ultra-store";
  elements.strictLocation.checked = false;
  elements.safeMode.checked = settings.safeMode !== false;
  elements.skipExisting.checked = settings.skipExisting !== false;
  formHydrated = true;
}

function safeText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function createLink(url, label = "Link") {
  if (!url) {
    return document.createTextNode("");
  }
  const a = document.createElement("a");
  a.href = url;
  a.textContent = label;
  a.className = "link";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function appendCell(row, label, content, className = "") {
  const td = document.createElement("td");
  td.dataset.label = label;
  if (className) {
    td.className = className;
  }
  if (content instanceof Node) {
    td.appendChild(content);
  } else {
    td.textContent = safeText(content);
  }
  row.appendChild(td);
  return td;
}

function renderResultsTable(rows) {
  elements.resultsBody.innerHTML = "";
  const data = Array.isArray(rows) ? rows : [];

  if (data.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = 8;
    td.dataset.label = "Durum";
    td.textContent = "Sonuc yok.";
    tr.appendChild(td);
    elements.resultsBody.appendChild(tr);
    return;
  }

  for (const row of data) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.dataset.label = "Isletme";
    if (row.mapsUrl) {
      nameTd.appendChild(createLink(row.mapsUrl, safeText(row.name || "Detay")));
    } else {
      nameTd.textContent = safeText(row.name);
    }
    tr.appendChild(nameTd);

    appendCell(tr, "Puan", row.rating);
    appendCell(tr, "Fiyat", row.priceText || row.listPriceText);
    appendCell(tr, "Telefon", row.phone);

    const websiteTd = document.createElement("td");
    websiteTd.dataset.label = "Web";
    if (row.website) {
      websiteTd.appendChild(createLink(row.website, "Site"));
    } else {
      websiteTd.textContent = "";
    }
    tr.appendChild(websiteTd);

    appendCell(tr, "Adres", row.fullAddress);
    appendCell(tr, "Ilce", row.district);
    appendCell(tr, "Sehir", row.city);

    elements.resultsBody.appendChild(tr);
  }
}

function renderLogs(logs) {
  if (!elements.logsText) {
    return;
  }
  const rows = Array.isArray(logs) ? logs : [];
  if (rows.length === 0) {
    elements.logsText.textContent = "Log kaydi yok.";
    return;
  }
  const lines = rows.slice(-400).map((entry) => {
    const ts = safeText(entry.ts || "").replace("T", " ").replace("Z", "");
    const level = safeText(entry.level || "info").toUpperCase();
    const step = safeText(entry.step || "system");
    const message = safeText(entry.message || "");
    const meta = entry.meta ? ` | ${JSON.stringify(entry.meta)}` : "";
    return `[${ts}] [${level}] [${step}] ${message}${meta}`;
  });
  elements.logsText.textContent = lines.join("\n");
  elements.logsText.scrollTop = elements.logsText.scrollHeight;
}

function renderState(state) {
  if (!state) {
    return;
  }
  currentState = state;
  hydrateFormFromState(state);

  const progress = clampProgress(state.progress);
  const currentCount = Number.isFinite(state.current) ? state.current : 0;
  const totalCount =
    Number.isFinite(state.total) && state.total > 0
      ? state.total
      : Number.isFinite(state.settings?.maxResults)
        ? state.settings.maxResults
        : 0;

  elements.statusText.textContent = phaseToLabel(state);
  elements.countText.textContent = `${currentCount}${totalCount ? ` / ${totalCount}` : ""}`;
  const archiveCount = Number.isFinite(state.archiveCount) ? state.archiveCount : 0;
  const newCount = Number.isFinite(state.newCount) ? state.newCount : 0;
  elements.archiveText.textContent = `${archiveCount}${newCount > 0 ? ` (+${newCount})` : ""}`;
  elements.messageText.textContent = safeText(state.message || "Bekleniyor...");
  elements.progressFill.style.width = `${progress}%`;

  if (state.lastError) {
    elements.errorText.textContent = safeText(state.lastError);
    elements.errorText.classList.remove("hidden");
  } else {
    elements.errorText.classList.add("hidden");
    elements.errorText.textContent = "";
  }

  const isRunning = state.status === "running" || state.status === "preparing";
  elements.startBtn.disabled = isRunning;
  elements.stopBtn.disabled = !isRunning;

  renderResultsTable(state.results || []);
  renderLogs(state.logs || []);
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function loadState() {
  const response = await sendMessage({ type: "GET_STATE" });
  if (response?.ok && response.state) {
    renderState(response.state);
    return;
  }
  elements.messageText.textContent = response?.error || "State alinamadi.";
}

async function handleStart(event) {
  event.preventDefault();
  const settings = getSettingsFromForm();
  if (!settings.category || !settings.city || parseDistricts(settings.district).length === 0) {
    elements.errorText.textContent = "Kategori, sehir ve en az bir ilce zorunludur.";
    elements.errorText.classList.remove("hidden");
    return;
  }

  elements.errorText.classList.add("hidden");
  elements.messageText.textContent = "Toplama baslatiliyor...";
  const response = await sendMessage({
    type: "START_SCRAPE",
    payload: settings
  });
  if (!response?.ok) {
    elements.errorText.textContent = response?.error || "Baslatma hatasi";
    elements.errorText.classList.remove("hidden");
  }
}

async function handleStop() {
  const response = await sendMessage({ type: "STOP_SCRAPE" });
  if (!response?.ok) {
    elements.errorText.textContent = response?.error || "Durdurma hatasi";
    elements.errorText.classList.remove("hidden");
  }
}

async function handleClear() {
  const response = await sendMessage({ type: "CLEAR_RESULTS" });
  if (!response?.ok) {
    elements.errorText.textContent = response?.error || "Temizleme hatasi";
    elements.errorText.classList.remove("hidden");
    return;
  }
  await loadState();
}


async function handleViewArchive() {
  const response = await sendMessage({ type: "OPEN_ARCHIVE_VIEW" });
  if (!response?.ok) {
    elements.errorText.textContent = response?.error || "Arsiv goruntuleme acilamadi";
    elements.errorText.classList.remove("hidden");
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("JSON dosyasi okunamadi."));
    reader.readAsText(file);
  });
}

async function handleImportJsonClick() {
  if (!elements.importJsonInput) {
    return;
  }
  elements.importJsonInput.value = "";
  elements.importJsonInput.click();
}

async function handleImportJsonChange(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  elements.errorText.classList.add("hidden");
  elements.messageText.textContent = "JSON import ediliyor...";

  try {
    const rawText = await readFileAsText(file);
    const response = await sendMessage({
      type: "IMPORT_ARCHIVE_JSON",
      payload: {
        jsonText: rawText,
        fileName: file.name || ""
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "JSON import basarisiz.");
    }

    elements.messageText.textContent = `${response.importedCount || 0} kayit import edildi.`;
    await loadState();
  } catch (error) {
    elements.errorText.textContent = error && error.message ? error.message : "JSON import hatasi";
    elements.errorText.classList.remove("hidden");
  } finally {
    if (elements.importJsonInput) {
      elements.importJsonInput.value = "";
    }
  }
}

async function handleCopyLogs() {
  const text = elements.logsText ? elements.logsText.textContent : "";
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    elements.messageText.textContent = "Log panoya kopyalandi.";
  } catch (error) {
    elements.errorText.textContent = "Log kopyalanamadi.";
    elements.errorText.classList.remove("hidden");
  }
}

async function handleClearLogs() {
  const response = await sendMessage({ type: "CLEAR_LOGS" });
  if (!response?.ok) {
    elements.errorText.textContent = response?.error || "Log temizlenemedi.";
    elements.errorText.classList.remove("hidden");
  }
}

elements.form.addEventListener("submit", handleStart);
elements.stopBtn.addEventListener("click", handleStop);
if (elements.importJsonBtn) {
  elements.importJsonBtn.addEventListener("click", handleImportJsonClick);
}
if (elements.importJsonInput) {
  elements.importJsonInput.addEventListener("change", handleImportJsonChange);
}
elements.clearBtn.addEventListener("click", handleClear);
elements.viewArchiveBtn.addEventListener("click", handleViewArchive);
if (elements.copyLogsBtn) {
  elements.copyLogsBtn.addEventListener("click", handleCopyLogs);
}
if (elements.clearLogsBtn) {
  elements.clearLogsBtn.addEventListener("click", handleClearLogs);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "STATE_UPDATED" && message.payload) {
    renderState(message.payload);
  }
});

loadState();
