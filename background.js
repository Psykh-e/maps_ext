const STATE_KEY = "maps_ultra_scrape_state_v1";
const DEFAULT_STORAGE_FOLDER = "maps-ultra-store";
const MASTER_JSON_FILENAME = "maps-ultra-master.json";
const VIEWER_PAGE_PATH = "archive-view.html";
const LOG_LIMIT = 1200;
const ARCHIVE_DB_NAME = "maps_ultra_archive_db";
const ARCHIVE_DB_VERSION = 1;
const ARCHIVE_STORE_NAME = "archive";
const ARCHIVE_MASTER_KEY = "master";
const ARCHIVE_SEED_MARKER_KEY = "initial-archive-v1-imported";
const INITIAL_ARCHIVE_PATH = "initial-archive.json";
const PROGRESS_AUTOSAVE_INTERVAL_MS = 5000;
const MAX_CONTENT_ERROR_RESTARTS = 3;

const TURKISH_TO_ASCII_MAP = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  Ç: "C",
  Ğ: "G",
  İ: "I",
  Ö: "O",
  Ş: "S",
  Ü: "U"
};

const DEFAULT_SETTINGS = {
  category: "",
  city: "",
  district: "",
  maxResults: 100,
  strictLocation: false,
  safeMode: true,
  skipExisting: true,
  storageFolder: DEFAULT_STORAGE_FOLDER
};

function createInitialState() {
  return {
    status: "idle",
    phase: "hazir",
    message: "Hazir",
    progress: 0,
    current: 0,
    total: 0,
    runId: null,
    tabId: null,
    query: "",
    lastError: null,
    results: [],
    summary: null,
    settings: { ...DEFAULT_SETTINGS },
    archiveCount: 0,
    newCount: 0,
    archiveFilePath: `${DEFAULT_STORAGE_FOLDER}/${MASTER_JSON_FILENAME}`,
    lastSavedFile: "",
    pendingCandidateNavigation: null,
    startedAt: null,
    finishedAt: null,
    logs: [],
    updatedAt: new Date().toISOString()
  };
}

let state = createInitialState();
let stateInitialized = false;
let activeRun = null;
let resumeWatchdogTimer = null;
let archiveDbPromise = null;
let lastProgressAutoSaveAt = 0;

function clearResumeWatchdog() {
  if (resumeWatchdogTimer) {
    clearTimeout(resumeWatchdogTimer);
    resumeWatchdogTimer = null;
  }
}

function toAsciiTurkish(text) {
  return String(text || "")
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (char) => {
      return TURKISH_TO_ASCII_MAP[char] || char;
    })
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeKeyText(text) {
  return toAsciiTurkish(text).replace(/\s+/g, " ").trim();
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.max(min, Math.min(max, num));
}

function canonicalizeMapUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  try {
    const url = new URL(rawUrl, "https://www.google.com");
    const cid = url.searchParams.get("cid");
    if (cid) {
      return `${url.origin}${url.pathname}?cid=${cid}`;
    }
    if (url.pathname.includes("/maps/place/")) {
      return `${url.origin}${url.pathname}`;
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch (error) {
    return String(rawUrl || "").trim();
  }
}

function safeDecodeUrl(rawUrl) {
  try {
    return decodeURIComponent(rawUrl);
  } catch (error) {
    return String(rawUrl || "");
  }
}

function extractEntityTokenFromUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  const decoded = safeDecodeUrl(rawUrl);
  const match = decoded.match(/16s\/g\/([^?&!/]+)/i);
  return match && match[1] ? match[1] : "";
}

function extractHexEntityFromUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  const decoded = safeDecodeUrl(rawUrl);
  const match = decoded.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)!/i);
  return match && match[1] ? match[1].toLowerCase() : "";
}

function buildNameAddressKey(name, address) {
  const normalizedName = normalizeKeyText(name);
  const normalizedAddress = normalizeKeyText(address);
  if (!normalizedName && !normalizedAddress) {
    return "";
  }
  return `${normalizedName}|${normalizedAddress}`;
}

function buildRecordKey(record) {
  if (!record || typeof record !== "object") {
    return "";
  }

  const placeId = String(record.placeId || "").trim();
  if (placeId) {
    return `pid:${placeId}`;
  }

  const cid = String(record.cid || "").trim();
  if (cid) {
    return `cid:${cid}`;
  }

  const entityToken = extractEntityTokenFromUrl(record.mapsUrl || "");
  if (entityToken) {
    return `gid:${entityToken}`;
  }

  const hexEntity = extractHexEntityFromUrl(record.mapsUrl || "");
  if (hexEntity) {
    return `hex:${hexEntity}`;
  }

  const canonicalUrl = canonicalizeMapUrl(record.mapsUrl || "");
  if (canonicalUrl) {
    return `url:${canonicalUrl}`;
  }

  const nameAddress = buildNameAddressKey(record.name, record.fullAddress || record.listAddress || "");
  if (nameAddress) {
    return `na:${nameAddress}`;
  }

  return "";
}

function dedupeByRecordKey(records) {
  const unique = new Map();
  for (const row of records || []) {
    const key = buildRecordKey(row);
    if (!key) {
      continue;
    }
    if (!unique.has(key)) {
      unique.set(key, row);
    }
  }
  return Array.from(unique.values());
}

function mergeRecordData(existing, incoming) {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }

  const merged = { ...existing, ...incoming };

  const stringFields = [
    "placeId",
    "cid",
    "mapsUrl",
    "name",
    "fetchedAt",
    "fullAddress",
    "listAddress",
    "district",
    "city",
    "phone",
    "website",
    "websiteDomain",
    "priceText",
    "listPriceText",
    "messageStatus",
    "sentMessage",
    "messageSentAt"
  ];

  for (const field of stringFields) {
    const incomingValue = String(merged[field] || "").trim();
    const existingValue = String(existing[field] || "").trim();
    if (!incomingValue && existingValue) {
      merged[field] = existing[field];
    }
  }

  const numericFields = [
    "lat",
    "lng",
    "rating",
    "listRating",
    "priceLevel"
  ];

  for (const field of numericFields) {
    const incomingValue = merged[field];
    if (!Number.isFinite(incomingValue) && Number.isFinite(existing[field])) {
      merged[field] = existing[field];
    }
  }

  const booleanFields = ["isSponsored", "hasDelivery", "hasTakeaway", "hasDineIn"];
  for (const field of booleanFields) {
    merged[field] = Boolean(existing[field]) || Boolean(incoming[field]);
  }

  if (!merged.fetchedAt) {
    merged.fetchedAt = existing.fetchedAt || new Date().toISOString();
  }

  return merged;
}

function updateArchiveRecordFields(record, updates = {}) {
  if (!record || typeof record !== "object") {
    return record;
  }

  const next = { ...record };
  if (Object.prototype.hasOwnProperty.call(updates, "messageStatus")) {
    next.messageStatus = String(updates.messageStatus || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "sentMessage")) {
    next.sentMessage = String(updates.sentMessage || "");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "messageSentAt")) {
    next.messageSentAt = String(updates.messageSentAt || "").trim();
  }
  return next;
}

function sanitizeFolderPath(input) {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  const normalized = raw
    .split("/")
    .map((segment) => segment.replace(/[<>:"|?*\x00-\x1F]/g, "").trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/")
    .replace(/^\/+|\/+$/g, "");

  return normalized || DEFAULT_STORAGE_FOLDER;
}

function sanitizeSettings(input = {}) {
  const maxParsed = Number.parseInt(input.maxResults, 10);
  const maxResults = Number.isFinite(maxParsed) ? Math.max(1, Math.min(maxParsed, 2000)) : 100;
  return {
    category: String(input.category || "").trim(),
    city: String(input.city || "").trim(),
    district: String(input.district || "").trim(),
    maxResults,
    strictLocation: false,
    safeMode: input.safeMode !== false,
    skipExisting: input.skipExisting !== false,
    autoSave: true,
    storageFolder: sanitizeFolderPath(input.storageFolder)
  };
}

function parseDistricts(input) {
  const seen = new Set();
  return String(input || "")
    .split(/[\n,;]+/g)
    .map((district) => district.trim())
    .filter(Boolean)
    .filter((district) => {
      const key = normalizeKeyText(district);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function buildQuery(settings) {
  return [settings.category, settings.district, settings.city]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function createInitialArchive(records = []) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    records: Array.isArray(records) ? records : []
  };
}

function openArchiveDatabase() {
  if (archiveDbPromise) {
    return archiveDbPromise;
  }

  archiveDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARCHIVE_STORE_NAME)) {
        db.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        archiveDbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      archiveDbPromise = null;
      reject(request.error || new Error("IndexedDB arsivi acilamadi."));
    };

    request.onblocked = () => {
      archiveDbPromise = null;
      reject(new Error("IndexedDB arsivi baska bir baglanti tarafindan engellendi."));
    };
  });

  return archiveDbPromise;
}

function waitForIdbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB islemi basarisiz."));
  });
}

function waitForIdbTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB islemi basarisiz."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB islemi iptal edildi."));
  });
}

function getArchiveVirtualPath(folderPath) {
  const safeFolder = sanitizeFolderPath(folderPath);
  return `${safeFolder}/${MASTER_JSON_FILENAME}`;
}

async function getArchivePayload(folderPath) {
  const db = await openArchiveDatabase();
  const transaction = db.transaction(ARCHIVE_STORE_NAME, "readonly");
  const completed = waitForIdbTransaction(transaction);
  const stored = await waitForIdbRequest(
    transaction.objectStore(ARCHIVE_STORE_NAME).get(ARCHIVE_MASTER_KEY)
  );
  await completed;

  if (!stored || !Array.isArray(stored.records)) {
    return createInitialArchive([]);
  }

  return {
    version: Number.isFinite(stored.version) ? stored.version : 1,
    updatedAt: String(stored.updatedAt || ""),
    records: stored.records
  };
}

async function getArchiveRecords(folderPath) {
  const payload = await getArchivePayload(folderPath);
  return Array.isArray(payload.records) ? payload.records.slice() : [];
}

async function setArchiveRecords(records, folderPath) {
  const deduped = dedupeByRecordKey(records || []);
  const payload = createInitialArchive(deduped);
  const db = await openArchiveDatabase();
  const transaction = db.transaction(ARCHIVE_STORE_NAME, "readwrite");
  const completed = waitForIdbTransaction(transaction);
  await waitForIdbRequest(
    transaction.objectStore(ARCHIVE_STORE_NAME).put({
      id: ARCHIVE_MASTER_KEY,
      ...payload
    })
  );
  await completed;
  return payload;
}

async function getArchiveStoreValue(id) {
  const db = await openArchiveDatabase();
  const transaction = db.transaction(ARCHIVE_STORE_NAME, "readonly");
  const completed = waitForIdbTransaction(transaction);
  const value = await waitForIdbRequest(
    transaction.objectStore(ARCHIVE_STORE_NAME).get(id)
  );
  await completed;
  return value;
}

async function putArchiveStoreValue(value) {
  const db = await openArchiveDatabase();
  const transaction = db.transaction(ARCHIVE_STORE_NAME, "readwrite");
  const completed = waitForIdbTransaction(transaction);
  await waitForIdbRequest(
    transaction.objectStore(ARCHIVE_STORE_NAME).put(value)
  );
  await completed;
}

async function importBundledInitialArchiveOnce() {
  const migrationMarker = await getArchiveStoreValue(ARCHIVE_SEED_MARKER_KEY);
  if (migrationMarker) {
    return { imported: false, count: 0 };
  }

  const response = await fetch(chrome.runtime.getURL(INITIAL_ARCHIVE_PATH), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Baslangic arsivi okunamadi: HTTP ${response.status}`);
  }

  const parsed = await response.json();
  const sourceRecords = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.records)
      ? parsed.records
      : null;

  if (!sourceRecords) {
    throw new Error("Baslangic arsivinde 'records' dizisi bulunamadi.");
  }

  const existingRecords = await getArchiveRecords();
  const merge = mergeIntoArchive(existingRecords, sourceRecords);
  await setArchiveRecords(merge.mergedRecords);
  await putArchiveStoreValue({
    id: ARCHIVE_SEED_MARKER_KEY,
    importedAt: new Date().toISOString(),
    sourceCount: sourceRecords.length,
    archiveCount: merge.mergedRecords.length
  });

  return { imported: true, count: merge.newCount };
}

function buildExistingFilterPayload(records) {
  const placeIds = new Set();
  const cids = new Set();
  const entityTokens = new Set();
  const hexEntities = new Set();
  const mapsUrls = new Set();
  const nameAddress = new Set();

  for (const record of records || []) {
    const placeId = String(record.placeId || "").trim();
    if (placeId) {
      placeIds.add(placeId);
    }

    const cid = String(record.cid || "").trim();
    if (cid) {
      cids.add(cid);
    }

    const rawUrl = String(record.mapsUrl || "").trim();
    const entityToken = extractEntityTokenFromUrl(rawUrl);
    if (entityToken) {
      entityTokens.add(entityToken);
    }

    const hexEntity = extractHexEntityFromUrl(rawUrl);
    if (hexEntity) {
      hexEntities.add(hexEntity);
    }

    const canonicalUrl = canonicalizeMapUrl(rawUrl);
    if (canonicalUrl) {
      mapsUrls.add(canonicalUrl);
    }

    const key = buildNameAddressKey(record.name, record.fullAddress || record.listAddress || "");
    if (key) {
      nameAddress.add(key);
    }
  }

  return {
    placeIds: Array.from(placeIds),
    cids: Array.from(cids),
    entityTokens: Array.from(entityTokens),
    hexEntities: Array.from(hexEntities),
    mapsUrls: Array.from(mapsUrls),
    nameAddress: Array.from(nameAddress),
    count: Array.isArray(records) ? records.length : 0
  };
}

function mergeIntoArchive(existingRecords, incomingRecords) {
  const archiveMap = new Map();

  for (const row of existingRecords || []) {
    const key = buildRecordKey(row);
    if (!key) {
      continue;
    }
    if (!archiveMap.has(key)) {
      archiveMap.set(key, row);
    }
  }

  const newRecords = [];
  for (const row of dedupeByRecordKey(incomingRecords || [])) {
    const key = buildRecordKey(row);
    if (!key) {
      continue;
    }

    if (!archiveMap.has(key)) {
      archiveMap.set(key, row);
      newRecords.push(row);
      continue;
    }

    const merged = mergeRecordData(archiveMap.get(key), row);
    archiveMap.set(key, merged);
  }

  return {
    mergedRecords: Array.from(archiveMap.values()),
    newRecords,
    newCount: newRecords.length
  };
}

async function initializeState() {
  if (stateInitialized) {
    return;
  }

  const stored = await chrome.storage.local.get(STATE_KEY);
  if (stored && stored[STATE_KEY] && typeof stored[STATE_KEY] === "object") {
    state = {
      ...createInitialState(),
      ...stored[STATE_KEY],
      settings: {
        ...DEFAULT_SETTINGS,
        ...(stored[STATE_KEY].settings || {})
      }
    };
  }

  state.settings = sanitizeSettings(state.settings);
  state.results = [];
  state.archiveFilePath = getArchiveVirtualPath(state.settings.storageFolder);
  try {
    await importBundledInitialArchiveOnce();
  } catch (error) {
    console.error("[MAPS-ULTRA] Baslangic JSON arsivi IndexedDB'ye aktarilamadi.", error);
  }
  const archiveRecords = await getArchiveRecords(state.settings.storageFolder);
  state.archiveCount = archiveRecords.length;
  try {
    await chrome.storage.local.remove("maps_ultra_archive_v1");
  } catch (error) {
    // Eski arsiv key'i temizlenemese de akisa devam edilir.
  }
  await chrome.storage.local.set({ [STATE_KEY]: buildPersistableState(state) });
  stateInitialized = true;
}

function generateRunId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function buildPersistableState(rawState) {
  return {
    ...rawState,
    logs: Array.isArray(rawState.logs) ? rawState.logs.slice(-LOG_LIMIT) : [],
    results: []
  };
}

async function setState(patch) {
  state = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  const persistable = buildPersistableState(state);
  await chrome.storage.local.set({ [STATE_KEY]: persistable });
  broadcastState();
}

function trimLogs(logs) {
  return Array.isArray(logs) ? logs.slice(-LOG_LIMIT) : [];
}

async function appendLog(level, step, message, meta = null) {
  const entry = {
    ts: new Date().toISOString(),
    level: String(level || "info"),
    step: String(step || "system"),
    message: String(message || ""),
    meta: meta && typeof meta === "object" ? meta : null
  };

  state = {
    ...state,
    logs: trimLogs([...(state.logs || []), entry]),
    updatedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [STATE_KEY]: buildPersistableState(state) });
  broadcastState();
}

function broadcastState() {
  chrome.runtime
    .sendMessage({
      type: "STATE_UPDATED",
      payload: state
    })
    .catch(() => {
      // Popup acik degilse hata beklenen bir durum.
    });
}

function buildArchiveJsonDataUrl(records) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    records: Array.isArray(records) ? records : []
  };
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
}

async function autoSaveArchiveJson(records, folderPath) {
  const safeFolder = sanitizeFolderPath(folderPath);
  const url = buildArchiveJsonDataUrl(records || []);
  const filename = `${safeFolder}/${MASTER_JSON_FILENAME}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "overwrite"
  });

  if (!Number.isFinite(downloadId)) {
    throw new Error("JSON dosyasi icin indirme kimligi alinamadi.");
  }

  const waitForComplete = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error("JSON dosyasi indirme zaman asimina ugradi."));
      }, 20000);

      const onChanged = (delta) => {
        if (delta.id !== downloadId || !delta.state?.current) {
          return;
        }
        if (delta.state.current === "complete") {
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve();
          return;
        }
        if (delta.state.current === "interrupted") {
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error("JSON dosyasi indirme kesintiye ugradi."));
        }
      };

      chrome.downloads.onChanged.addListener(onChanged);
    });

  await waitForComplete();
  return filename;
}

async function saveProgressRecord(record, context = {}) {
  if (!record || typeof record !== "object" || !buildRecordKey(record)) {
    return { saved: false, reason: "invalid-record" };
  }

  const runId = context.runId || state.runId || null;
  const activeFolder = sanitizeFolderPath(state.settings.storageFolder);
  const batch = state.batch || null;
  let nextBatch = batch;
  let nextResults = Array.isArray(state.results) ? state.results : [];

  if (batch && Array.isArray(batch.districts) && batch.districts.length > 0) {
    const target = Number.isFinite(batch.perDistrictTarget)
      ? batch.perDistrictTarget
      : state.settings.maxResults;
    const previousDistrictResults = Array.isArray(batch.currentDistrictResults)
      ? batch.currentDistrictResults
      : [];
    const previousKeys = new Set(previousDistrictResults.map((row) => buildRecordKey(row)).filter(Boolean));
    const recordKey = buildRecordKey(record);
    const nextDistrictResults = dedupeByRecordKey([...previousDistrictResults, record]).slice(0, target);
    const acceptedKeys = new Set(nextDistrictResults.map((row) => buildRecordKey(row)).filter(Boolean));

    if (!acceptedKeys.has(recordKey) && !previousKeys.has(recordKey)) {
      return { saved: false, reason: "district-target-reached" };
    }

    const completedBatchResults = Array.isArray(batch.results) ? batch.results : [];
    nextBatch = {
      ...batch,
      currentDistrictResults: nextDistrictResults,
      completedRecords: completedBatchResults.length + nextDistrictResults.length
    };
    nextResults = dedupeByRecordKey([...completedBatchResults, ...nextDistrictResults]);
  } else {
    nextResults = dedupeByRecordKey([...nextResults, record]);
  }

  const archiveRecords = await getArchiveRecords(activeFolder);
  const merge = mergeIntoArchive(archiveRecords, [record]);
  await setArchiveRecords(merge.mergedRecords, activeFolder);

  let savedFile = state.lastSavedFile || "";
  let saveError = null;
  const now = Date.now();
  if (merge.newCount > 0 && now - lastProgressAutoSaveAt >= PROGRESS_AUTOSAVE_INTERVAL_MS) {
    try {
      savedFile = await autoSaveArchiveJson(merge.mergedRecords, activeFolder);
      lastProgressAutoSaveAt = now;
    } catch (error) {
      saveError = error && error.message ? error.message : String(error);
      await appendLog("error", "autosave", "Anlik JSON kaydi sirasinda hata.", {
        runId,
        error: saveError
      });
    }
  }

  await setState({
    results: nextResults,
    batch: nextBatch,
    current: nextResults.length,
    archiveCount: merge.mergedRecords.length,
    newCount: (Number.isFinite(state.newCount) ? state.newCount : 0) + merge.newCount,
    archiveFilePath: getArchiveVirtualPath(activeFolder),
    lastSavedFile: savedFile || state.lastSavedFile,
    lastError: saveError || state.lastError
  });

  if (merge.newCount > 0) {
    await appendLog("info", "archive", "Yeni kayit aninda arsive eklendi.", {
      runId,
      name: record.name || "",
      archiveCount: merge.mergedRecords.length
    });
  }

  return {
    saved: true,
    newCount: merge.newCount,
    archiveCount: merge.mergedRecords.length,
    savedFile,
    saveError
  };
}

async function flushArchiveJson(reason = "flush", runId = null) {
  const activeFolder = sanitizeFolderPath(state.settings.storageFolder);
  const archiveRecords = await getArchiveRecords(activeFolder);
  try {
    const savedFile = await autoSaveArchiveJson(archiveRecords, activeFolder);
    lastProgressAutoSaveAt = Date.now();
    await setState({
      archiveCount: archiveRecords.length,
      archiveFilePath: getArchiveVirtualPath(activeFolder),
      lastSavedFile: savedFile,
      lastError: null
    });
    return { ok: true, savedFile, count: archiveRecords.length };
  } catch (error) {
    const saveError = error && error.message ? error.message : String(error);
    await setState({ lastError: saveError });
    await appendLog("error", "autosave", "Arsiv JSON flush sirasinda hata.", {
      runId,
      reason,
      error: saveError
    });
    return { ok: false, error: saveError };
  }
}

async function openOrReuseMapsTab(query) {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const tabs = await chrome.tabs.query({ url: "https://www.google.com/maps/*" });
  if (tabs && tabs.length > 0) {
    const existing = tabs[0];
    return chrome.tabs.update(existing.id, { active: true, url });
  }
  return chrome.tabs.create({ url, active: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabReady(tabId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.status === "complete") {
        return;
      }
    } catch (error) {
      // Tab gecici olarak ulasilamazsa tekrar dene.
    }
    await sleep(300);
  }
}

async function sendMessageToTabWithRetry(tabId, message, retries = 25, intervalMs = 400) {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (i === retries - 1) {
        throw error;
      }
      await sleep(intervalMs);
    }
  }
  return null;
}

function scheduleResumeWatchdog(runId) {
  clearResumeWatchdog();
  resumeWatchdogTimer = setTimeout(async () => {
    resumeWatchdogTimer = null;
    try {
      const isActiveRun = Boolean(activeRun && activeRun.runId === runId && activeRun.tabId === state.tabId);
      const isRunning = state.status === "running" || state.status === "preparing";
      if (!isActiveRun || !isRunning || !state.tabId || state.runId !== runId) {
        return;
      }

      await appendLog("warn", "navigation", "Resume sinyali gecikti, fail-safe olarak SCRAPE_START yeniden gonderiliyor.", {
        runId,
        tabId: state.tabId
      });

      await waitForTabReady(state.tabId, 15000);
      const freshArchiveRecords = await getArchiveRecords(state.settings.storageFolder);
      await sendMessageToTabWithRetry(
        state.tabId,
        {
          type: "SCRAPE_START",
          payload: {
            runId: state.runId,
            query: state.query,
            settings: state.settings,
            existingFilters: state.settings.skipExisting ? buildExistingFilterPayload(freshArchiveRecords) : null,
            pendingDetailCandidate:
              state.pendingCandidateNavigation && state.pendingCandidateNavigation.runId === runId
                ? state.pendingCandidateNavigation.candidate
                : null
          }
        },
        12,
        500
      );

      await appendLog("info", "navigation", "Fail-safe SCRAPE_START basariyla gonderildi.", {
        runId,
        tabId: state.tabId
      });
    } catch (error) {
      await appendLog("error", "navigation", "Fail-safe resume girisimi basarisiz oldu.", {
        runId,
        error: error && error.message ? error.message : String(error)
      });
    }
  }, 14000);
}

async function handleStartScrape(payload) {
  clearResumeWatchdog();
  const settings = sanitizeSettings(payload || {});
  const districts = parseDistricts(settings.district);
  if (!settings.category || !settings.city || districts.length === 0) {
    throw new Error("Kategori, sehir ve ilce alanlari zorunludur.");
  }

  const batch = {
    id: generateRunId(),
    districts,
    originalDistrictText: settings.district,
    index: 0,
    attempt: 0,
    maxAttemptsPerDistrict: 2,
    perDistrictTarget: settings.maxResults,
    results: [],
    currentDistrictResults: [],
    completedRecords: 0,
    totalTarget: settings.maxResults * districts.length
  };
  const currentSettings = {
    ...settings,
    district: districts[0]
  };
  const query = buildQuery(currentSettings);
  const runId = generateRunId();
  const archiveRecords = await getArchiveRecords(settings.storageFolder);
  const archiveFilePath = getArchiveVirtualPath(settings.storageFolder);

  await appendLog("info", "start", "Toplama istegi alindi.", {
    runId,
    batchId: batch.id,
    districtCount: districts.length,
    currentDistrict: currentSettings.district,
    query,
    maxResults: settings.maxResults,
    safeMode: settings.safeMode,
    skipExisting: settings.skipExisting
  });

  await setState({
    status: "preparing",
    phase: "hazirlaniyor",
    message: "Google Maps sekmesi hazirlaniyor...",
    progress: 0,
    current: 0,
    total: batch.totalTarget,
    runId,
    tabId: null,
    query,
    lastError: null,
    results: [],
    summary: null,
    settings: currentSettings,
    batch,
    contentErrorRestarts: 0,
    archiveCount: archiveRecords.length,
    newCount: 0,
    archiveFilePath,
    lastSavedFile: state.lastSavedFile || "",
    pendingCandidateNavigation: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  });

  const tab = await openOrReuseMapsTab(query);
  activeRun = { runId, tabId: tab.id };
  await appendLog("info", "start", "Google Maps sekmesi hazirlandi.", {
    runId,
    tabId: tab.id
  });

  await setState({
    tabId: tab.id,
    message: "Maps acildi, toplama baslatiliyor..."
  });

  await waitForTabReady(tab.id);

  await sendMessageToTabWithRetry(tab.id, {
    type: "SCRAPE_START",
    payload: {
      runId,
      query,
      settings: currentSettings,
      existingFilters: currentSettings.skipExisting ? buildExistingFilterPayload(archiveRecords) : null
    }
  });

  await appendLog("info", "start", "Content script toplama baslatma mesaji gonderildi.", {
    runId,
    tabId: tab.id
  });
}

async function startNextBatchDistrict(batchPatch = {}) {
  const batch = {
    ...(state.batch || {}),
    ...batchPatch
  };
  const districts = Array.isArray(batch.districts) ? batch.districts : [];
  const district = districts[batch.index];
  if (!district) {
    return false;
  }

  const settings = {
    ...state.settings,
    district,
    maxResults: Number.isFinite(batch.perDistrictTarget) ? batch.perDistrictTarget : state.settings.maxResults
  };
  const query = buildQuery(settings);
  const runId = generateRunId();
  const archiveRecords = await getArchiveRecords(settings.storageFolder);

  await setState({
    status: "preparing",
    phase: "hazirlaniyor",
    message: `${district} icin Google Maps hazirlaniyor...`,
    progress: Math.floor((batch.index / Math.max(districts.length, 1)) * 100),
    current: Number.isFinite(batch.completedRecords) ? batch.completedRecords : 0,
    total: Number.isFinite(batch.totalTarget) ? batch.totalTarget : settings.maxResults * districts.length,
    runId,
    query,
    lastError: null,
    settings,
    batch,
    pendingCandidateNavigation: null,
    startedAt: state.startedAt || new Date().toISOString(),
    finishedAt: null
  });

  await appendLog("info", "batch", "Siradaki ilce baslatiliyor.", {
    runId,
    district,
    index: batch.index + 1,
    totalDistricts: districts.length,
    attempt: (batch.attempt || 0) + 1,
    query
  });

  const tab = await openOrReuseMapsTab(query);
  activeRun = { runId, tabId: tab.id };
  await setState({
    tabId: tab.id,
    message: `${district} icin toplama baslatiliyor...`
  });

  await waitForTabReady(tab.id);
  await sendMessageToTabWithRetry(tab.id, {
    type: "SCRAPE_START",
    payload: {
      runId,
      query,
      settings,
      existingFilters: settings.skipExisting ? buildExistingFilterPayload(archiveRecords) : null
    }
  });

  return true;
}

async function handleStopScrape() {
  clearResumeWatchdog();
  if (!activeRun || !activeRun.tabId) {
    await setState({
      status: "stopped",
      phase: "hata",
      message: "Aktif toplama bulunamadi.",
      finishedAt: new Date().toISOString()
    });
    return { ok: true, stopped: false };
  }

  try {
    await chrome.tabs.sendMessage(activeRun.tabId, {
      type: "SCRAPE_STOP",
      payload: { runId: activeRun.runId }
    });
  } catch (error) {
    // Content script kapaliysa da state'i durduruyoruz.
  }

  await setState({
    status: "stopped",
    phase: "durduruldu",
    message: "Toplama durduruldu.",
    batch: null,
    finishedAt: new Date().toISOString()
  });
  await appendLog("warn", "stop", "Toplama kullanici tarafindan durduruldu.", {
    runId: activeRun?.runId || null
  });
  activeRun = null;
  return { ok: true, stopped: true };
}

async function handleContentProgress(message) {
  const { runId, phase, progress, current, total, message: progressMessage, lastError, record } = message.payload || {};
  if (!state.runId || state.runId !== runId) {
    return { ok: true, ignored: true };
  }

  if (record && typeof record === "object") {
    await saveProgressRecord(record, { runId, current, total });
  }

  const batch = state.batch || null;
  const districtCount = Array.isArray(batch?.districts) ? batch.districts.length : 0;
  const batchIndex = Number.isFinite(batch?.index) ? batch.index : 0;
  const completedRecords = Number.isFinite(batch?.completedRecords) ? batch.completedRecords : 0;
  const completedBeforeDistrict = Array.isArray(batch?.results) ? batch.results.length : completedRecords;
  const totalTarget = Number.isFinite(batch?.totalTarget) ? batch.totalTarget : state.total;
  const localProgress = clampNumber(progress, 0, 100);
  const nextProgress = districtCount > 1
    ? Math.min(99, Math.floor(((batchIndex + (localProgress / 100)) / districtCount) * 100))
    : (Number.isFinite(progress) ? progress : state.progress);
  const nextCurrent = districtCount > 1 && Number.isFinite(current)
    ? Math.max(completedRecords, completedBeforeDistrict + current)
    : (Number.isFinite(current) ? current : state.current);
  const currentDistrict = batch?.districts?.[batchIndex] || state.settings?.district || "";

  await setState({
    status: "running",
    phase: phase || state.phase,
    progress: nextProgress,
    current: nextCurrent,
    total: districtCount > 1 ? totalTarget : (Number.isFinite(total) ? total : state.total),
    message: districtCount > 1 && progressMessage
      ? `${currentDistrict} (${batchIndex + 1}/${districtCount}): ${progressMessage}`
      : (progressMessage || state.message),
    lastError: lastError || null
  });
  if (!state.pendingCandidateNavigation) {
    clearResumeWatchdog();
  }

  const payloadText = String(progressMessage || "");
  if (payloadText || lastError) {
    await appendLog(lastError ? "warn" : "info", "progress", payloadText || "Ilerleme guncellendi.", {
      runId,
      phase,
      progress,
      current,
      total,
      lastError: lastError || null
    });
  }
  return { ok: true };
}

async function handleContentDone(message) {
  const payload = message.payload || {};
  const { runId, results, summary } = payload;
  if (!state.runId || state.runId !== runId) {
    return { ok: true, ignored: true };
  }

  const incomingResults = Array.isArray(results) ? results : [];
  const currentRunRecords = dedupeByRecordKey(incomingResults);
  const batchForStorage = state.batch || null;
  let recordsToArchive = currentRunRecords;
  if (batchForStorage && Array.isArray(batchForStorage.districts) && batchForStorage.districts.length > 0) {
    const target = Number.isFinite(batchForStorage.perDistrictTarget)
      ? batchForStorage.perDistrictTarget
      : state.settings.maxResults;
    const previousDistrictResults = Array.isArray(batchForStorage.currentDistrictResults)
      ? batchForStorage.currentDistrictResults
      : [];
    const previousKeys = new Set(previousDistrictResults.map((record) => buildRecordKey(record)).filter(Boolean));
    const acceptedDistrictResults = dedupeByRecordKey([...previousDistrictResults, ...currentRunRecords]).slice(0, target);
    recordsToArchive = acceptedDistrictResults.filter((record) => {
      const key = buildRecordKey(record);
      return !key || !previousKeys.has(key);
    });
  }
  await appendLog("info", "done", "Content script toplama tamamlandi.", {
    runId,
    incomingCount: incomingResults.length,
    acceptedCount: recordsToArchive.length
  });
  const activeFolder = sanitizeFolderPath(state.settings.storageFolder);
  const archiveRecords = await getArchiveRecords(activeFolder);
  const merge = mergeIntoArchive(archiveRecords, recordsToArchive);
  await setArchiveRecords(merge.mergedRecords, activeFolder);
  const cumulativeNewCount = (Number.isFinite(state.newCount) ? state.newCount : 0) + merge.newCount;

  let savedFile = state.lastSavedFile || "";
  let saveError = null;

  try {
    savedFile = await autoSaveArchiveJson(merge.mergedRecords, activeFolder);
  } catch (error) {
    saveError = error && error.message ? error.message : String(error);
    await appendLog("error", "autosave", "Otomatik kayit sirasinda hata.", {
      runId,
      error: saveError
    });
  }

  const finalSummary = {
    ...(summary || {}),
    archiveCount: merge.mergedRecords.length,
    newCount: cumulativeNewCount,
    skippedExisting: Math.max(0, incomingResults.length - merge.newCount),
    autoSaveEnabled: true,
    autoSavedFile: savedFile || "",
    autoSaveError: saveError
  };

  const batch = state.batch || null;
  if (batch && Array.isArray(batch.districts) && batch.districts.length > 0) {
    const district = batch.districts[batch.index] || state.settings.district;
    const target = Number.isFinite(batch.perDistrictTarget) ? batch.perDistrictTarget : state.settings.maxResults;
    const attempt = Number.isFinite(batch.attempt) ? batch.attempt : 0;
    const maxAttempts = Number.isFinite(batch.maxAttemptsPerDistrict) ? batch.maxAttemptsPerDistrict : 2;
    const previousDistrictResults = Array.isArray(batch.currentDistrictResults) ? batch.currentDistrictResults : [];
    const districtResults = dedupeByRecordKey([...previousDistrictResults, ...currentRunRecords]).slice(0, target);
    const completedBatchResults = Array.isArray(batch.results) ? batch.results : [];
    const combinedResults = dedupeByRecordKey([...completedBatchResults, ...districtResults]);
    const shouldRetryDistrict = districtResults.length < target && attempt + 1 < maxAttempts;
    const nextBatch = {
      ...batch,
      currentDistrictResults: districtResults,
      completedRecords: completedBatchResults.length + districtResults.length
    };

    if (shouldRetryDistrict) {
      await appendLog("warn", "batch", "Ilce hedefin altinda kaldi, ayni arama bir kez daha deneniyor.", {
        district,
        found: districtResults.length,
        target,
        nextAttempt: attempt + 2
      });
      activeRun = null;
      clearResumeWatchdog();
      await startNextBatchDistrict({
        ...nextBatch,
        results: completedBatchResults,
        attempt: attempt + 1,
        contentErrorRestarts: 0
      });
      return { ok: true, continued: true, retry: true };
    }

    const nextIndex = (Number.isFinite(batch.index) ? batch.index : 0) + 1;
    if (nextIndex < batch.districts.length) {
      await appendLog("info", "batch", "Ilce tamamlandi, sonraki ilceye geciliyor.", {
        district,
        found: districtResults.length,
        target,
        nextDistrict: batch.districts[nextIndex]
      });
      activeRun = null;
      clearResumeWatchdog();
      await startNextBatchDistrict({
        ...nextBatch,
        results: combinedResults,
        currentDistrictResults: [],
        completedRecords: combinedResults.length,
        index: nextIndex,
        attempt: 0,
        contentErrorRestarts: 0
      });
      return { ok: true, continued: true };
    }

    await setState({
      status: "done",
      phase: "tamamlandi",
      progress: 100,
      current: combinedResults.length,
      total: batch.totalTarget || combinedResults.length,
      message: `Tum ilceler tamamlandi. ${batch.districts.length} ilcede ${combinedResults.length} tekil kayit toplandi.`,
      results: combinedResults,
      summary: {
        ...finalSummary,
        districtCount: batch.districts.length,
        requestedPerDistrict: target,
        totalCollected: combinedResults.length
      },
      archiveCount: merge.mergedRecords.length,
      newCount: cumulativeNewCount,
      archiveFilePath: getArchiveVirtualPath(activeFolder),
      lastSavedFile: savedFile,
      lastError: saveError,
      settings: {
        ...state.settings,
        district: batch.originalDistrictText || batch.districts.join(", ")
      },
      batch: null,
      contentErrorRestarts: 0,
      finishedAt: new Date().toISOString()
    });

    await appendLog("info", "batch", "Tum ilceler tamamlandi.", {
      districtCount: batch.districts.length,
      collected: combinedResults.length,
      mergedArchiveCount: merge.mergedRecords.length
    });

    clearResumeWatchdog();
    activeRun = null;
    return { ok: true };
  }

  await setState({
    status: "done",
    phase: "tamamlandi",
    progress: 100,
    current: currentRunRecords.length,
    total: state.total || 0,
    message:
      currentRunRecords.length > 0
        ? `Toplama tamamlandi. ${currentRunRecords.length} kayit toplandi, ${cumulativeNewCount} yeni kayit arsive eklendi.`
        : "Toplama tamamlandi. Kayit bulunamadi.",
    results: currentRunRecords,
    summary: finalSummary,
    archiveCount: merge.mergedRecords.length,
    newCount: cumulativeNewCount,
    archiveFilePath: getArchiveVirtualPath(activeFolder),
    lastSavedFile: savedFile,
    lastError: saveError,
    batch: null,
    contentErrorRestarts: 0,
    finishedAt: new Date().toISOString()
  });

  await appendLog("info", "done", "Toplama state tamamlandi.", {
    runId,
    mergedArchiveCount: merge.mergedRecords.length,
    newCount: cumulativeNewCount,
    autoSavedFile: savedFile || ""
  });

  clearResumeWatchdog();
  activeRun = null;
  return { ok: true };
}

async function handleContentError(message) {
  const payload = message.payload || {};
  const { runId, error } = payload;
  if (!state.runId || (runId && state.runId !== runId)) {
    return { ok: true, ignored: true };
  }
  const errorText = String(error || "Bilinmeyen hata");
  const isSoftCancelled = errorText === "Toplama durduruldu.";
  const isRunning = state.status === "running" || state.status === "preparing";

  if (isSoftCancelled && isRunning) {
    await appendLog("warn", "content", "Ayni run icindeki gecici iptal sinyali yok sayildi.", {
      runId: runId || null,
      error: errorText
    });
    return { ok: true, ignored: true, reason: "soft-cancel" };
  }

  await flushArchiveJson("content-error", runId || null);

  if (isRunning) {
    const batch = state.batch || null;
    if (batch && Array.isArray(batch.districts) && batch.districts.length > 0) {
      const restartCount = Number.isFinite(batch.contentErrorRestarts) ? batch.contentErrorRestarts : 0;
      if (restartCount < MAX_CONTENT_ERROR_RESTARTS) {
        await appendLog("warn", "content", "Content script hata verdi, ayni ilce yeniden baslatiliyor.", {
          runId: runId || null,
          error: errorText,
          restart: restartCount + 1,
          maxRestarts: MAX_CONTENT_ERROR_RESTARTS
        });
        activeRun = null;
        clearResumeWatchdog();
        await startNextBatchDistrict({
          ...batch,
          contentErrorRestarts: restartCount + 1
        });
        return { ok: true, restarted: true };
      }

      const currentIndex = Number.isFinite(batch.index) ? batch.index : 0;
      const nextIndex = currentIndex + 1;
      const completedBatchResults = Array.isArray(batch.results) ? batch.results : [];
      const currentDistrictResults = Array.isArray(batch.currentDistrictResults) ? batch.currentDistrictResults : [];
      const combinedResults = dedupeByRecordKey([...completedBatchResults, ...currentDistrictResults]);

      if (nextIndex < batch.districts.length) {
        await appendLog("error", "content", "Ilce ust uste hata verdi, eldeki kayitlar korunup sonraki ilceye geciliyor.", {
          runId: runId || null,
          error: errorText,
          district: batch.districts[currentIndex] || "",
          nextDistrict: batch.districts[nextIndex] || ""
        });
        activeRun = null;
        clearResumeWatchdog();
        await startNextBatchDistrict({
          ...batch,
          results: combinedResults,
          currentDistrictResults: [],
          completedRecords: combinedResults.length,
          index: nextIndex,
          attempt: 0,
          contentErrorRestarts: 0
        });
        return { ok: true, continued: true, skippedErroredDistrict: true };
      }

      const activeFolder = sanitizeFolderPath(state.settings.storageFolder);
      const archiveRecords = await getArchiveRecords(activeFolder);
      await setState({
        status: "done",
        phase: "tamamlandi",
        progress: 100,
        current: combinedResults.length,
        total: batch.totalTarget || combinedResults.length,
        message: "Tarama hatalara ragmen eldeki kayitlarla tamamlandi.",
        results: combinedResults,
        archiveCount: archiveRecords.length,
        archiveFilePath: getArchiveVirtualPath(activeFolder),
        lastError: errorText,
        settings: {
          ...state.settings,
          district: batch.originalDistrictText || batch.districts.join(", ")
        },
        batch: null,
        finishedAt: new Date().toISOString()
      });
      await appendLog("error", "content", "Son ilce de ust uste hata verdi; eldeki kayitlarla akiş tamamlandi.", {
        runId: runId || null,
        error: errorText,
        collected: combinedResults.length
      });
      clearResumeWatchdog();
      activeRun = null;
      return { ok: true, completedWithErrors: true };
    }

    const restartCount = Number.isFinite(state.contentErrorRestarts) ? state.contentErrorRestarts : 0;
    if (restartCount < MAX_CONTENT_ERROR_RESTARTS) {
      const nextRunId = generateRunId();
      const query = state.query || buildQuery(state.settings);
      await appendLog("warn", "content", "Content script hata verdi, arama yeniden baslatiliyor.", {
        previousRunId: runId || null,
        nextRunId,
        error: errorText,
        restart: restartCount + 1,
        maxRestarts: MAX_CONTENT_ERROR_RESTARTS
      });
      activeRun = null;
      clearResumeWatchdog();
      await setState({
        status: "preparing",
        phase: "hazirlaniyor",
        message: "Hata sonrasi tarama yeniden baslatiliyor...",
        runId: nextRunId,
        query,
        lastError: errorText,
        contentErrorRestarts: restartCount + 1
      });
      const tab = await openOrReuseMapsTab(query);
      activeRun = { runId: nextRunId, tabId: tab.id };
      await setState({ tabId: tab.id });
      await waitForTabReady(tab.id);
      const archiveRecords = await getArchiveRecords(state.settings.storageFolder);
      await sendMessageToTabWithRetry(tab.id, {
        type: "SCRAPE_START",
        payload: {
          runId: nextRunId,
          query,
          settings: state.settings,
          existingFilters: state.settings.skipExisting ? buildExistingFilterPayload(archiveRecords) : null
        }
      });
      return { ok: true, restarted: true };
    }
  }

  await setState({
    status: "error",
    phase: "hata",
    message: "Toplama cok fazla hata aldigi icin durdu. O ana kadar bulunan kayitlar arsivde korundu.",
    lastError: errorText,
    batch: null,
    finishedAt: new Date().toISOString()
  });
  await appendLog("error", "content", "Content script hata bildirdi.", {
    runId: runId || null,
    error: errorText
  });
  clearResumeWatchdog();
  activeRun = null;
  return { ok: true };
}

async function handleContentLog(message) {
  const payload = message.payload || {};
  await appendLog(payload.level || "info", payload.step || "content", payload.message || "", payload.meta || null);
  return { ok: true };
}

async function handleClearLogs() {
  state = {
    ...state,
    logs: [],
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [STATE_KEY]: buildPersistableState(state) });
  broadcastState();
  return { ok: true };
}

async function handleImportArchiveJson(message) {
  const payload = message?.payload || {};
  const rawText = String(payload.jsonText || "").trim();
  if (!rawText) {
    return { ok: false, error: "Import edilecek JSON bos." };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return { ok: false, error: "JSON formati gecersiz." };
  }

  const sourceRecords = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.records)
      ? parsed.records
      : null;

  if (!sourceRecords) {
    return { ok: false, error: "JSON icinde 'records' dizisi bulunamadi." };
  }

  const deduped = dedupeByRecordKey(sourceRecords);
  await setArchiveRecords(deduped, state.settings.storageFolder);

  const activeFolder = sanitizeFolderPath(state.settings.storageFolder);
  let savedFile = state.lastSavedFile || "";
  let saveError = null;
  try {
    savedFile = await autoSaveArchiveJson(deduped, activeFolder);
  } catch (error) {
    saveError = error && error.message ? error.message : String(error);
  }

  await setState({
    archiveCount: deduped.length,
    newCount: 0,
    archiveFilePath: getArchiveVirtualPath(activeFolder),
    lastSavedFile: savedFile || state.lastSavedFile,
    lastError: saveError
  });

  await appendLog("info", "import", "JSON arsiv import edildi.", {
    importedCount: deduped.length,
    fileName: String(payload.fileName || ""),
    savedFile: savedFile || "",
    saveError
  });

  if (saveError) {
    return { ok: false, error: `Import edildi ama dosyaya kayit hatasi: ${saveError}` };
  }
  return { ok: true, importedCount: deduped.length, savedFile };
}

async function handleGetArchiveViewData() {
  const activeFolder = sanitizeFolderPath(state.settings.storageFolder);
  const payload = await getArchivePayload(activeFolder);
  const records = Array.isArray(payload.records) ? payload.records : [];
  const sorted = records.slice().sort((a, b) => {
    const aTime = new Date(a?.fetchedAt || 0).getTime();
    const bTime = new Date(b?.fetchedAt || 0).getTime();
    return bTime - aTime;
  });

  return {
    ok: true,
    archiveFilePath: getArchiveVirtualPath(activeFolder),
    updatedAt: payload.updatedAt || "",
    count: sorted.length,
    records: sorted
  };
}

async function handleUpdateArchiveRecord(message) {
  const payload = message?.payload || {};
  const row = payload.row && typeof payload.row === "object" ? payload.row : null;
  const updates = payload.updates && typeof payload.updates === "object" ? payload.updates : {};
  const activeFolder = sanitizeFolderPath(state.settings.storageFolder);

  if (!row) {
    return { ok: false, error: "Guncellenecek kayit bulunamadi." };
  }

  const key = buildRecordKey(row);
  if (!key) {
    return { ok: false, error: "Guncellenecek kayit anahtari bulunamadi." };
  }

  const archiveRecords = await getArchiveRecords(activeFolder);
  let updatedRecord = null;
  const nextRecords = archiveRecords.map((record) => {
    if (buildRecordKey(record) !== key) {
      return record;
    }
    updatedRecord = updateArchiveRecordFields(record, updates);
    return updatedRecord;
  });

  if (!updatedRecord) {
    return { ok: false, error: "Kayit arsivde bulunamadi." };
  }

  await setArchiveRecords(nextRecords, activeFolder);

  return { ok: true, record: updatedRecord };
}

async function handleSaveArchiveJson() {
  return flushArchiveJson("manual-save", state.runId || null);
}

async function handleOpenArchiveView() {
  const url = chrome.runtime.getURL(VIEWER_PAGE_PATH);
  await chrome.tabs.create({ url, active: true });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await initializeState();
    if (!message || !message.type) {
      return { ok: false, error: "Mesaj tipi eksik." };
    }

    switch (message.type) {
      case "GET_STATE":
        return { ok: true, state };
      case "START_SCRAPE":
        await handleStartScrape(message.payload || {});
        return { ok: true };
      case "STOP_SCRAPE":
        return handleStopScrape();
      case "CLEAR_RESULTS":
        clearResumeWatchdog();
        await setState({
          ...createInitialState(),
          settings: { ...state.settings },
          archiveCount: state.archiveCount,
          archiveFilePath: state.archiveFilePath || getArchiveVirtualPath(state.settings.storageFolder),
          lastSavedFile: state.lastSavedFile,
          batch: null
        });
        await appendLog("info", "clear", "Sonuclar ve gecici durum temizlendi.");
        activeRun = null;
        return { ok: true };
      case "OPEN_ARCHIVE_VIEW":
        return handleOpenArchiveView();
      case "CLEAR_LOGS":
        return handleClearLogs();
      case "GET_ARCHIVE_VIEW_DATA":
        return handleGetArchiveViewData();
      case "UPDATE_ARCHIVE_RECORD":
        return handleUpdateArchiveRecord(message);
      case "SAVE_ARCHIVE_JSON":
        return handleSaveArchiveJson();
      case "IMPORT_ARCHIVE_JSON":
        return handleImportArchiveJson(message);
      case "SCRAPE_PROGRESS":
        return handleContentProgress(message);
      case "SCRAPE_DONE":
        return handleContentDone(message);
      case "SCRAPE_ERROR":
        return handleContentError(message);
      case "SCRAPE_LOG":
        return handleContentLog(message);
      case "SCRAPE_NAVIGATING":
        // Content script sayfayi yenilemek uzere oldugunu haber veriyor.
        // State'i koruyoruz (running olarak birakyoruz), resume mekanizmasi devreye girecek.
        if (message.payload?.pendingCandidate && message.payload?.runId) {
          await setState({
            pendingCandidateNavigation: {
              runId: message.payload.runId,
              targetUrl: message.payload?.targetUrl || message.payload?.searchUrl || null,
              reason: message.payload?.reason || null,
              candidate: message.payload.pendingCandidate
            }
          });
        }
        await appendLog("warn", "navigation", "Content script sayfa yenileniyor, resume bekleniyor.", {
          runId: message.payload?.runId || null,
          searchUrl: message.payload?.searchUrl || null
        });
        if (message.payload?.runId) {
          scheduleResumeWatchdog(message.payload.runId);
        }
        return { ok: true };
      case "CONTENT_INITIALIZED": {
        // Yeni content script yuklendiginde bu mesaj gelir.
        // Eger aktif bir toplama varsa ve mesaj o tab'dan geldiyse, resume payload gonder.
        const senderTabId = sender?.tab?.id;
        const isRunning = state.status === "running" || state.status === "preparing";
        if (
          activeRun &&
          isRunning &&
          senderTabId &&
          state.tabId === senderTabId
        ) {
          await appendLog("info", "navigation", "CONTENT_INITIALIZED alindi, aktif toplama tespit edildi. Resume payload hazirlaniyor.", {
            runId: state.runId,
            senderTabId
          });
          clearResumeWatchdog();
          // Taze arsiv kayitlariyla existingFilters guncelle (sayfa yenilenmeden once toplananlari da iceriyor)
          const freshArchiveRecords = await getArchiveRecords(state.settings.storageFolder);
          const existingFilters = buildExistingFilterPayload(freshArchiveRecords);
          const resumePayload = {
            runId: state.runId,
            query: state.query,
            settings: { ...state.settings },
            existingFilters,
            pendingDetailCandidate:
              state.pendingCandidateNavigation && state.pendingCandidateNavigation.runId === state.runId
                ? state.pendingCandidateNavigation.candidate
                : null
          };
          if (resumePayload.pendingDetailCandidate) {
            await setState({ pendingCandidateNavigation: null });
          }
          return { ok: true, shouldResume: true, payload: resumePayload };
        }
        return { ok: true, shouldResume: false };
      }
      default:
        return { ok: false, error: `Bilinmeyen mesaj tipi: ${message.type}` };
    }
  })()
    .then((result) => sendResponse(result))
    .catch(async (error) => {
      const errorMessage = error && error.message ? error.message : String(error);
      await setState({
        status: "error",
        phase: "hata",
        message: "Islem sirasinda hata olustu.",
        lastError: errorMessage,
        finishedAt: new Date().toISOString()
      });
      clearResumeWatchdog();
      activeRun = null;
      sendResponse({ ok: false, error: errorMessage });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await initializeState();
  await chrome.storage.local.set({ [STATE_KEY]: buildPersistableState(state) });
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});
