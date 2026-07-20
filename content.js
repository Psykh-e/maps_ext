const SELECTORS = {
  searchInputCandidates: [
    "input#searchboxinput",
    'div[role="search"] input[name="q"]',
    'form[role="search"] input[name="q"]',
    'input[role="combobox"][name="q"]',
    'div[role="search"] input[role="combobox"]',
    'input[name="q"][autocomplete="off"]'
  ],
  searchButtonCandidates: [
    "button#searchbox-searchbutton",
    'div[role="search"] button[jsaction*="omnibox.search"]',
    'form[role="search"] button[jsaction*="omnibox.search"]',
    'div[role="search"] button[aria-label*="Ara"]',
    'div[role="search"] button[aria-label*="Search"]'
  ],
  resultsFeed: 'div[role="feed"]',
  resultsFeedCandidates: [
    'div[role="feed"]',
    'div[role="main"] div[role="feed"]',
    'div[aria-label*="Results"] div[role="feed"]',
    'div[aria-label*="Sonu"] div[role="feed"]',
    'div[aria-label*="sonu"] div[role="feed"]'
  ],
  resultArticle: 'div[role="article"]',
  resultAnchors: 'a.hfpxzc, a[href*="/maps/place/"], a[href*="maps?cid="]',
  placeTitle:
    "div[role='main'] h1.DUwDvf, div[role='main'] h1[data-attrid='title'], div[role='main'] h1.fontHeadlineLarge",
  ratingLabel: 'div.F7nice span[aria-hidden="true"], span.ceNzKf',
  reviewButton: 'button[jsaction*="pane.rating.moreReviews"], button[aria-label*="yorum"], button[aria-label*="review"]',
  categoryButton:
    'button[jsaction*="pane.rating.category"], button.DkEaL, button[aria-label*="kategori"], button[aria-label*="category"]',
  statusElement: "span.ZDu9vd, span[aria-label*='Acilis'], span[aria-label*='Open']",
  hoursTableRows: "table tr",
  detailNodes: "button[data-item-id], a[data-item-id], button[aria-label], a[aria-label]",
  detailsRoot: "div[role='main']"
};

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

let activeRun = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeText(text) {
  return toAsciiTurkish(text).replace(/\s+/g, " ");
}

function getText(element) {
  if (!element) {
    return "";
  }
  return (element.textContent || "").trim();
}

function queryFirst(selectors, root = document) {
  if (!Array.isArray(selectors)) {
    return null;
  }
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node) {
      return node;
    }
  }
  return null;
}

function isInteractable(element) {
  if (!element) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findCloseButton(root = document) {
  const selectors = [
    'button[jsaction*="pane.place.backToList"]',
    'button[jsaction*="pane.header.back"]',
    'button[jsaction*="pane.back"]',
    'button[data-value="Back"]',
    'button[aria-label="Geri"]',
    'button[aria-label="Back"]',
    'button[jsaction*="pane.close"]',
    'button[aria-label="Kapat"]',
    'button[aria-label="Close"]',
    'button[jsaction*="close"]'
  ];
  
  for (const selector of selectors) {
    const btn = root.querySelector(selector);
    if (btn && isInteractable(btn)) {
      if (btn.closest('#searchbox') || btn.closest('.searchbox')) {
        continue;
      }
      return btn;
    }
  }
  
  const buttons = Array.from(root.querySelectorAll('button'));
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (label === 'close' || label === 'kapat' || label === 'geri' || label === 'back') {
      if (isInteractable(btn)) {
        if (btn.closest('#searchbox') || btn.closest('.searchbox')) {
          continue;
        }
        return btn;
      }
    }
  }
  
  return null;
}

function isDetailPanelStillOpen(root = null) {
  const detailRoot = root || getActiveDetailRoot();
  if (!detailRoot) {
    return false;
  }
  const hasTitle = Boolean(detailRoot.querySelector("h1.DUwDvf, h1[data-attrid='title'], h1.fontHeadlineLarge"));
  const hasDetailNodes = hasDetailContactNodes(detailRoot);
  return hasTitle || hasDetailNodes;
}

async function tryCloseDetailPanel(controller, safeMode) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertNotCancelled(controller);
    const detailRoot = getActiveDetailRoot();
    if (!isDetailPanelStillOpen(detailRoot)) {
      return true;
    }

    const closeBtn = findCloseButton(detailRoot) || findCloseButton(document);
    if (closeBtn) {
      const label = closeBtn.getAttribute("aria-label") || "Kapat/Geri";
      await sendLog(controller, "info", "navigation", `Panel kapatma denemesi #${attempt}: '${label}' tiklaniyor...`);
      closeBtn.click();
    } else {
      await sendLog(controller, "warn", "navigation", `Panel kapatma denemesi #${attempt}: buton bulunamadi, ESC gonderiliyor.`);
    }

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    await smartDelay(controller, safeMode, 240, 620);

    if (!isDetailPanelStillOpen(getActiveDetailRoot())) {
      return true;
    }
  }
  return false;
}

function safeDecodeUrl(rawUrl) {
  try {
    return decodeURIComponent(rawUrl);
  } catch (error) {
    return rawUrl;
  }
}

function canonicalizeMapUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  try {
    const url = new URL(rawUrl, window.location.origin);
    const cid = url.searchParams.get("cid");
    if (cid) {
      return `${url.origin}${url.pathname}?cid=${cid}`;
    }
    if (url.pathname.includes("/maps/place/")) {
      return `${url.origin}${url.pathname}`;
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch (error) {
    return rawUrl;
  }
}

function isValidMapsPlaceHref(rawUrl) {
  if (!rawUrl) {
    return false;
  }
  try {
    const url = new URL(rawUrl, window.location.origin);
    const pathname = String(url.pathname || "").toLowerCase();
    if (pathname.includes("/maps/place/")) {
      return true;
    }
    const cid = url.searchParams.get("cid");
    if (cid) {
      return true;
    }
    const placeId = url.searchParams.get("place_id");
    if (placeId && /^ChI/i.test(placeId)) {
      return true;
    }
    const q = url.searchParams.get("q");
    if (q && /place_id:/i.test(q)) {
      return true;
    }
    return false;
  } catch (error) {
    const lowered = String(rawUrl).toLowerCase();
    return lowered.includes("/maps/place/") || lowered.includes("cid=");
  }
}

function extractLatLngFromUrl(rawUrl) {
  if (!rawUrl) {
    return { lat: null, lng: null };
  }
  const decoded = safeDecodeUrl(rawUrl);
  const fromAt = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (fromAt) {
    return {
      lat: Number.parseFloat(fromAt[1]),
      lng: Number.parseFloat(fromAt[2])
    };
  }
  const fromData = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (fromData) {
    return {
      lat: Number.parseFloat(fromData[1]),
      lng: Number.parseFloat(fromData[2])
    };
  }
  return { lat: null, lng: null };
}

function extractPlaceIdFromUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }
  const decoded = safeDecodeUrl(rawUrl);
  const fromBang = decoded.match(/!(?:1s|19s)(ChI[^!/?&]+)/);
  if (fromBang && fromBang[1]) {
    return fromBang[1];
  }
  const fromQuery = decoded.match(/[?&]q=place_id:(ChI[^&]+)/i);
  if (fromQuery && fromQuery[1]) {
    return fromQuery[1];
  }
  const fromParam = decoded.match(/[?&]place_id=(ChI[^&]+)/i);
  if (fromParam && fromParam[1]) {
    return fromParam[1];
  }
  return null;
}

function extractCidFromUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }
  try {
    const url = new URL(rawUrl, window.location.origin);
    return url.searchParams.get("cid");
  } catch (error) {
    return null;
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

function parseRating(text) {
  if (!text) {
    return null;
  }
  const match = text.match(/(\d+[.,]?\d*)/);
  if (!match) {
    return null;
  }
  return Number.parseFloat(match[1].replace(",", "."));
}

function parseReviewCount(text) {
  if (!text) {
    return null;
  }
  const match = text.match(/(\d[\d.,\s]*)/);
  if (!match) {
    return null;
  }
  const raw = match[1].replace(/\s+/g, "");
  if (raw.includes(",") && raw.includes(".")) {
    return Number.parseInt(raw.replace(/[.,]/g, ""), 10);
  }
  if (raw.includes(".") && !raw.includes(",")) {
    return Number.parseInt(raw.replace(/\./g, ""), 10);
  }
  if (raw.includes(",") && !raw.includes(".")) {
    const parts = raw.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      return Number.parseInt(parts[0], 10);
    }
    return Number.parseInt(raw.replace(/,/g, ""), 10);
  }
  return Number.parseInt(raw, 10);
}

function parsePriceLevel(text) {
  if (!text) {
    return null;
  }
  const dollarCount = (text.match(/\$/g) || []).length;
  if (dollarCount > 0) {
    return dollarCount;
  }
  const tlCount = (text.match(/₺/g) || []).length;
  if (tlCount > 0) {
    return tlCount;
  }
  return null;
}

function parsePriceText(text) {
  if (!text) {
    return "";
  }
  const normalized = String(text).replace(/\s+/g, " ").trim();
  const priceRangeMatch = normalized.match(/[₺$€£]\s*\d[\d.,]*(?:\s*[-–]\s*[₺$€£]?\s*\d[\d.,]*)?/);
  if (priceRangeMatch) {
    return priceRangeMatch[0];
  }
  const compactLevelMatch = normalized.match(/[₺$€£]{1,4}/);
  return compactLevelMatch ? compactLevelMatch[0] : "";
}

function parseWebsiteDomain(website) {
  if (!website) {
    return "";
  }
  try {
    const url = new URL(website);
    return url.hostname.replace(/^www\./i, "");
  } catch (error) {
    return "";
  }
}

function isGoogleOwnedDomain(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return false;
  }
  return (
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "googleadservices.com" ||
    host.endsWith(".googleadservices.com") ||
    host === "g.co" ||
    host.endsWith(".g.co")
  );
}

function isGoogleOwnedUrl(rawUrl) {
  if (!rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return isGoogleOwnedDomain(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function toAbsoluteHttpUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  const trimmed = String(rawUrl).trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.href;
  } catch (error) {
    if (/^[^\s/$.?#].[^\s]*\.[a-z]{2,}(?:[/?#].*)?$/i.test(trimmed)) {
      try {
        const withScheme = new URL(`https://${trimmed}`);
        return withScheme.href;
      } catch (innerError) {
        return "";
      }
    }
    return "";
  }
}

function resolveBusinessWebsite(rawUrl) {
  const direct = toAbsoluteHttpUrl(rawUrl);
  if (!direct) {
    return "";
  }
  try {
    const parsed = new URL(direct);
    if (!isGoogleOwnedDomain(parsed.hostname)) {
      return parsed.pathname.includes("/maps/place/") ? "" : parsed.href;
    }

    const unwrapKeys = ["q", "url", "dest", "destination", "target", "continue"];
    for (const key of unwrapKeys) {
      const candidate = parsed.searchParams.get(key);
      if (!candidate) {
        continue;
      }
      const unwrapped = toAbsoluteHttpUrl(safeDecodeUrl(candidate));
      if (!unwrapped || isGoogleOwnedUrl(unwrapped)) {
        continue;
      }
      if (unwrapped.includes("/maps/place/")) {
        continue;
      }
      return unwrapped;
    }
    return "";
  } catch (error) {
    return "";
  }
}

function extractPhone(text) {
  if (!text) {
    return "";
  }
  const source = String(text).replace(/\u00a0/g, " ");
  const match = source.match(/((?:\+?\d[\d().\-\s]{6,}\d|\(\d[\d().\-\s]{6,}\d))/);
  if (!match || !match[1]) {
    return "";
  }
  let cleaned = match[1].replace(/\s{2,}/g, " ").trim();
  const startIndex = source.indexOf(match[1]);
  if (startIndex > 0 && source[startIndex - 1] === "(" && !cleaned.startsWith("(")) {
    cleaned = `(${cleaned}`;
  }
  const digitCount = cleaned.replace(/\D/g, "").length;
  if (digitCount < 10 || digitCount > 15) {
    return "";
  }
  return cleaned;
}

function pickFirstPhone(values) {
  for (const value of values || []) {
    const extracted = extractPhone(value);
    if (extracted) {
      return extracted;
    }
  }
  return "";
}

function parseNeighborhoodFromAddress(fullAddress) {
  if (!fullAddress) {
    return "";
  }
  const cleaned = String(fullAddress).trim();
  const commaSplit = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaSplit.length === 0) {
    return "";
  }
  const first = commaSplit[0];
  // Ornek: "Akşemsettin, Fevzipaşa Cd..." -> mahalle ilk parcada olur.
  if (first && first.length <= 40) {
    return first;
  }
  return "";
}

function isNoiseLine(text) {
  if (!text) {
    return true;
  }
  const line = text.trim();
  if (!line) {
    return true;
  }
  if (/^[\uE000-\uF8FF·•\-\s]+$/u.test(line)) {
    return true;
  }
  if (line.length === 1 && /[^\p{L}\p{N}]/u.test(line)) {
    return true;
  }
  return false;
}

function cleanCardLines(lines) {
  return (lines || [])
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter((line) => !isNoiseLine(line));
}

function parseAddressParts(fullAddress) {
  const cleaned = String(fullAddress || "").trim();
  if (!cleaned) {
    return {
      district: "",
      city: "",
      postalCode: ""
    };
  }

  const postalMatch = cleaned.match(/\b\d{5}\b/);
  const postalCode = postalMatch ? postalMatch[0] : "";

  let district = "";
  let city = "";
  const slashMatch = cleaned.match(/([^,/]+)\s*\/\s*([^,/]+)/);
  if (slashMatch) {
    district = slashMatch[1].trim();
    city = slashMatch[2].trim();
  } else {
    const parts = cleaned
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      city = parts[parts.length - 2];
      district = parts[parts.length - 3] || "";
    } else if (parts.length === 1) {
      city = parts[0];
    }
  }

  return { district, city, postalCode };
}

function setInputValue(input, value) {
  if (!input) {
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function buildHoursText() {
  const rows = Array.from(document.querySelectorAll(SELECTORS.hoursTableRows));
  const hourPairs = [];

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("td, th"))
      .map((cell) => getText(cell))
      .filter(Boolean);
    if (cells.length >= 2) {
      hourPairs.push(`${cells[0]} ${cells[1]}`);
    }
  }

  if (hourPairs.length > 0) {
    return hourPairs.join(" | ");
  }

  const hourNode = Array.from(document.querySelectorAll("button, div, span")).find((node) => {
    const label = (node.getAttribute("aria-label") || "").toLowerCase();
    return label.includes("hour") || label.includes("saat");
  });

  if (hourNode) {
    return getText(hourNode) || hourNode.getAttribute("aria-label") || "";
  }

  return "";
}

function extractServicesAndAttributes() {
  const chips = new Set();
  const scope = document.querySelector("div[role='main']") || document;

  const candidates = Array.from(scope.querySelectorAll("button, span, div"))
    .map((node) => getText(node))
    .filter((text) => text && text.length > 1 && text.length < 60);

  for (const text of candidates) {
    const normalized = normalizeText(text);
    if (
      normalized.includes("paket servis") ||
      normalized.includes("yerinde servis") ||
      normalized.includes("gel al") ||
      normalized.includes("disa servis") ||
      normalized.includes("delivery") ||
      normalized.includes("takeaway") ||
      normalized.includes("dine in")
    ) {
      chips.add(text);
    }
  }
  return Array.from(chips);
}

function deriveImageCount() {
  const candidates = Array.from(document.querySelectorAll("button, span, div"));
  for (const node of candidates) {
    const text = getText(node);
    if (!text) {
      continue;
    }
    const normalized = normalizeText(text);
    if (normalized.includes("fotograf") || normalized.includes("photo")) {
      const count = parseReviewCount(text);
      if (Number.isFinite(count)) {
        return count;
      }
    }
  }
  return null;
}

function deriveOwnerData() {
  const candidates = Array.from(document.querySelectorAll("button, span, div, a"));
  for (const node of candidates) {
    const text = getText(node);
    if (!text) {
      continue;
    }
    if (text.length > 120) {
      continue;
    }
    const normalized = normalizeText(text);
    if (normalized.includes("sahibi") || normalized.includes("owner")) {
      return text;
    }
  }
  return "";
}

function isCancelled(controller) {
  return !controller || controller.cancelled;
}

function assertNotCancelled(controller) {
  if (isCancelled(controller)) {
    throw new Error("Toplama durduruldu.");
  }
}

function assertCandidateStillActive(candidate, controller) {
  assertNotCancelled(controller);
  const token = candidate?.processingToken || "";
  if (token && controller && controller.activeCandidateToken !== token) {
    throw new Error("Aday islemi artik aktif degil.");
  }
}

async function sendRuntimeMessage(type, payload) {
  try {
    await Promise.race([
      chrome.runtime.sendMessage({ type, payload }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("runtime message timeout")), 2200);
      })
    ]);
  } catch (error) {
    // Background geçici olarak ayakta degilse hatayi yutuyoruz.
  }
}

async function sendLog(controller, level, step, message, meta = null) {
  const ts = new Date().toISOString();
  const consoleMsg = `[MAPS-EXT-CONTENT] [${ts}] [${String(level || "info").toUpperCase()}] [${step}] ${message}${meta ? " " + JSON.stringify(meta) : ""}`;
  if (level === "error") {
    console.error(consoleMsg);
  } else if (level === "warn") {
    console.warn(consoleMsg);
  } else {
    console.log(consoleMsg);
  }

  if (!controller || !controller.runId) {
    return;
  }
  await sendRuntimeMessage("SCRAPE_LOG", {
    runId: controller.runId,
    level: String(level || "info"),
    step: String(step || "content"),
    message: String(message || ""),
    meta: meta && typeof meta === "object" ? meta : null
  });
}

function sendLogAsync(controller, level, step, message, meta = null) {
  sendLog(controller, level, step, message, meta).catch(() => {});
}

async function runWithTimeout(taskFactory, timeoutMs, timeoutMessage) {
  let timer = null;
  try {
    return await Promise.race([
      taskFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function sendProgress(controller, patch = {}) {
  if (!controller || !controller.runId) {
    return;
  }
  await sendRuntimeMessage("SCRAPE_PROGRESS", {
    runId: controller.runId,
    ...patch
  });
}

async function waitForSelector(selector, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
  const controller = options.controller || null;
  const root = options.root || document;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    assertNotCancelled(controller);
    const element = root.querySelector(selector);
    if (element) {
      return element;
    }
    await sleep(intervalMs);
  }
  return null;
}

async function waitForAnySelector(selectors, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
  const controller = options.controller || null;
  const root = options.root || document;
  const onlyInteractable = options.onlyInteractable !== false;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    assertNotCancelled(controller);
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (!node) {
        continue;
      }
      if (!onlyInteractable || isInteractable(node)) {
        return node;
      }
    }
    await sleep(intervalMs);
  }
  return null;
}

async function smartDelay(controller, safeMode, minMs = 220, maxMs = 850) {
  assertNotCancelled(controller);
  if (!safeMode) {
    await sleep(minMs);
    return;
  }
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await sleep(jitter);
}

function extractQueryFromMapsUrl() {
  const { pathname, search } = window.location;
  const queryParam = new URLSearchParams(search).get("q");
  if (queryParam) {
    return queryParam.trim();
  }

  const match = pathname.match(/\/maps\/search\/([^/]+)/i);
  if (!match || !match[1]) {
    return "";
  }
  return safeDecodeUrl(match[1]).replace(/\+/g, " ").trim();
}

function buildMapsSearchUrl(query) {
  return `https://www.google.com/maps/search/${encodeURIComponent(String(query || "").trim())}`;
}

async function navigateWithResumeSignal(controller, url, reason, extra = {}) {
  if (!url) {
    throw new Error("Yonlendirme URL'i bos.");
  }

  await sendRuntimeMessage("SCRAPE_NAVIGATING", {
    runId: controller?.runId || null,
    searchUrl: url,
    reason: String(reason || "navigation"),
    currentUrl: window.location.href,
    ...extra
  });
  window.location.assign(url);
}

async function hasUsableResultsFeed(controller, timeoutMs = 6000) {
  const feed = await waitForResultsFeedReady(controller, timeoutMs);
  return Boolean(feed && countValidResultLinks(feed) > 0) || hasNoResultsMessage(document);
}

function findSearchButton() {
  return queryFirst(SELECTORS.searchButtonCandidates);
}

function getResultsFeedElement(root = document) {
  const selectors = Array.isArray(SELECTORS.resultsFeedCandidates)
    ? SELECTORS.resultsFeedCandidates
    : [SELECTORS.resultsFeed];

  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node) {
      return node;
    }
  }

  const firstAnchor = root.querySelector(SELECTORS.resultAnchors);
  if (!firstAnchor) {
    return null;
  }

  return (
    firstAnchor.closest('div[role="feed"]') ||
    firstAnchor.closest('div[aria-label*="Results"]') ||
    firstAnchor.closest('div[aria-label*="Sonu"]') ||
    firstAnchor.closest('div[aria-label*="sonu"]') ||
    firstAnchor.parentElement
  );
}

function hasResultsListPresent(root = document) {
  const feed = getResultsFeedElement(root);
  if (feed) {
    return true;
  }
  return root.querySelectorAll(SELECTORS.resultAnchors).length >= 3;
}

function countValidResultLinks(root = document) {
  return Array.from(root.querySelectorAll(SELECTORS.resultAnchors)).filter((anchor) => {
    return isValidMapsPlaceHref(anchor.getAttribute("href") || "");
  }).length;
}

function hasNoResultsMessage(root = document) {
  const main = root.querySelector("div[role='main']") || root.body || root.documentElement;
  const normalized = normalizeText(main?.innerText || "");
  return (
    normalized.includes("sonuc bulunamadi") ||
    normalized.includes("sonuc yok") ||
    normalized.includes("no results found") ||
    normalized.includes("no results")
  );
}

async function waitForResultsFeedReady(controller, timeoutMs = 18000) {
  const start = Date.now();
  let lastLoggedAt = 0;
  let lastAnchorCount = -1;

  while (Date.now() - start < timeoutMs) {
    assertNotCancelled(controller);
    const feed = getResultsFeedElement(document);
    const anchorCount = feed ? countValidResultLinks(feed) : countValidResultLinks(document);

    if (feed && anchorCount > 0) {
      return feed;
    }

    if (hasNoResultsMessage(document)) {
      return feed || getResultsFeedElement(document);
    }

    if (anchorCount !== lastAnchorCount || Date.now() - lastLoggedAt > 5000) {
      await sendLog(controller, "info", "collect", "Sonuc kartlarinin render edilmesi bekleniyor.", {
        elapsedMs: Date.now() - start,
        anchorCount
      });
      lastAnchorCount = anchorCount;
      lastLoggedAt = Date.now();
    }

    await sleep(400);
  }

  return getResultsFeedElement(document);
}

function parseListCardData(anchor) {
  if (!anchor) {
    return {};
  }
  const article = anchor.closest(SELECTORS.resultArticle);
  if (!article) {
    return {};
  }

  const rawLines = (article.innerText || "").split("\n");
  const lines = cleanCardLines(rawLines);
  const normalizedLines = lines.map((line) => normalizeText(line));

  const isSponsored = normalizedLines.some((line) => line === "sponsorlu");
  const ratingLine =
    lines.find((line) => /(\d+[.,]\d+)\s*\(/.test(line)) ||
    lines.find((line) => normalizeText(line).includes("yildizli"));
  const listRating = parseRating(ratingLine || "");
  const listPriceText = parsePriceText(ratingLine || lines.join(" "));

  const listStatus =
    lines.find((line) => /(acik|kapali|open|closed|24 saat)/i.test(normalizeText(line))) || "";
  const listInfoLine =
    lines.find((line) => line.includes(" · ") && !/(acik|kapali|open|closed)/i.test(normalizeText(line))) || "";
  const listAddress =
    lines.find((line) =>
      /(\/|cd\.?|cad\.?|sok\.?|blv\.?|bulv\.?|mah\.?|no\s*:)/i.test(normalizeText(line))
    ) ||
    lines.find((line) => /\b(fatih|istanbul)\b/i.test(normalizeText(line))) ||
    "";
  const serviceLines = lines.filter((line) =>
    /(paket servis|adrese servis|iceride servis|delivery|takeaway|dine in|gel al)/i.test(
      normalizeText(line)
    )
  );

  const actionHints = lines.filter((line) =>
    /(internetten siparis|masa rezerve et|siparis)/i.test(normalizeText(line))
  );

  const listSnippet = lines.slice(0, 8).join(" | ");
  return {
    listRating: Number.isFinite(listRating) ? listRating : null,
    listPriceText,
    listStatus,
    listInfoLine,
    listAddress,
    listServices: Array.from(new Set(serviceLines)),
    listSnippet,
    isSponsored,
    listActions: actionHints
  };
}

async function ensureSearch(query, controller, safeMode) {
  await sendLog(controller, "info", "search", "Arama hazirlaniyor.", { query });
  const normalizedTarget = normalizeText(query);
  const urlQuery = extractQueryFromMapsUrl();
  const normalizedUrlQuery = normalizeText(urlQuery);

  await sendLog(controller, "info", "search", `Sorgu karsilastirmasi: normalizedTarget='${normalizedTarget}', normalizedUrlQuery='${normalizedUrlQuery}'`);

  // Maps URL zaten hedef sorguyu tasiyorsa, input bulunmasa da sonuca devam ediyoruz.
  if (normalizedUrlQuery && normalizedUrlQuery === normalizedTarget) {
    await sendLog(controller, "info", "search", "URL sorgusu hedef sorgu ile eslesiyor, feed kontrol ediliyor.");
    const feedReady = await hasUsableResultsFeed(controller, 9000);
    if (feedReady) {
      await sendLog(controller, "info", "search", "URL sorgusu dogru, mevcut sonuc listesi kullaniliyor.");
      return;
    } else {
      await sendLog(controller, "warn", "search", "URL sorgusu dogru ancak sonuclar listesi (feed) yuklenemedi.");
    }
  }

  await sendLog(controller, "info", "search", "Arama inputu araniyor...");
  const input = await waitForAnySelector(SELECTORS.searchInputCandidates, {
    timeoutMs: 30000,
    controller,
    onlyInteractable: true
  });
  if (!input) {
    if (normalizedUrlQuery && normalizedUrlQuery === normalizedTarget) {
      await sendLog(controller, "warn", "search", "Arama kutusu bulunamadi ancak URL eslestigi icin devam ediliyor.");
      // Bazı Maps varyantlarında input geç geliyor; URL dogruysa akışı bozma.
      return;
    }
    throw new Error(
      "Maps arama kutusu bulunamadi. Arayuz degismis olabilir; selectorlar guncellenmeli."
    );
  }

  const currentValue = normalizeText(input.value || "");
  await sendLog(controller, "info", "search", `Arama kutusu bulundu. Mevcut deger: '${currentValue}', Hedef deger: '${normalizedTarget}'`);
  if (currentValue !== normalizedTarget) {
    await sendLog(controller, "info", "search", `Arama kutusuna yeni deger giriliyor: '${query}'`);
    setInputValue(input, query);
    await smartDelay(controller, safeMode, 300, 900);

    const searchButton = findSearchButton();
    if (searchButton) {
      await sendLog(controller, "info", "search", "Arama butonu bulundu, tiklaniyor.");
      searchButton.click();
    } else {
      await sendLog(controller, "warn", "search", "Arama butonu bulunamadi, Enter tusu gonderiliyor.");
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true
        })
      );
    }
  } else {
    await sendLog(controller, "info", "search", "Arama kutusundaki deger zaten hedef degerle ayni, yeni arama tetiklenmiyor.");
  }

  await smartDelay(controller, safeMode, 1500, 2500);
  const readyFeed = await waitForResultsFeedReady(controller, 18000);
  const readyCount = readyFeed ? countValidResultLinks(readyFeed) : 0;
  if (readyCount > 0) {
    await sendLog(controller, "info", "search", "Arama sonuclari render edildi.", {
      resultLinks: readyCount
    });
  } else {
    await sendLog(controller, "warn", "search", "Arama sonrasi sonuc kartlari beklenen surede render edilmedi.", {
      resultLinks: readyCount
    });
  }
  await sendLog(controller, "info", "search", "Arama tetiklendi ve bekleme tamamlandi.");
}

function gatherVisibleResultLinks(feedElement) {
  const links = new Map();
  if (!feedElement) {
    return links;
  }

  const anchors = Array.from(feedElement.querySelectorAll(SELECTORS.resultAnchors));
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href || !isValidMapsPlaceHref(href)) {
      continue;
    }
    const normalizedHref = canonicalizeMapUrl(href);
    if (!normalizedHref) {
      continue;
    }
    if (!links.has(normalizedHref)) {
      const cardData = parseListCardData(anchor);
      const candidate = {
        url: href,
        canonicalUrl: normalizedHref,
        nameHint: anchor.getAttribute("aria-label") || getText(anchor),
        ...cardData
      };
      candidate.identityKey = buildCandidateIdentityKey(candidate);
      links.set(normalizedHref, candidate);
    }
  }
  return links;
}

function countCollectableCandidates(collectedMap, knownKeys, skipExisting) {
  if (!skipExisting || !(knownKeys instanceof Set) || knownKeys.size === 0) {
    return collectedMap.size;
  }

  let count = 0;
  for (const candidate of collectedMap.values()) {
    const key = String(candidate.identityKey || "").trim();
    if (!key || !knownKeys.has(key)) {
      count += 1;
    }
  }
  return count;
}

async function collectCandidates(targetCount, controller, safeMode, options = {}) {
  let feed = await waitForResultsFeedReady(controller, 25000);
  if (!feed) {
    await waitForSelector(SELECTORS.resultAnchors, {
      timeoutMs: 30000,
      controller
    });
    feed = getResultsFeedElement(document);
  }
  if (!feed) {
    throw new Error("Sonuc listesi bulunamadi.");
  }
  await sendLog(controller, "info", "collect", "Aday toplama basladi.", { targetCount });

  const desiredCandidates = Math.max(1, targetCount);
  const knownKeys = options.knownKeys instanceof Set ? options.knownKeys : null;
  const skipExisting = Boolean(options.skipExisting);
  const collected = new Map();
  let stableCycles = 0;
  let previousCount = 0;
  let previousCollectableCount = 0;
  let scrollStuckCycles = 0;
  let previousScrollTop = -1;
  let previousScrollHeight = -1;

  const maxCycles = Number.isFinite(options.maxCycles) ? options.maxCycles : 140;
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    assertNotCancelled(controller);
    const latestFeed = getResultsFeedElement(document);
    if (latestFeed && latestFeed !== feed) {
      feed = latestFeed;
      scrollStuckCycles = 0;
      previousScrollTop = -1;
      previousScrollHeight = -1;
      await sendLog(controller, "info", "collect", "Sonuc listesi DOM'da yenilendi, guncel feed ile devam ediliyor.", {
        cycle
      });
    }

    const visible = gatherVisibleResultLinks(feed);
    for (const [key, value] of visible.entries()) {
      if (!collected.has(key)) {
        collected.set(key, value);
      }
    }

    const collectableCount = countCollectableCandidates(collected, knownKeys, skipExisting);
    
    if (cycle % 5 === 0 || collectableCount >= desiredCandidates) {
      await sendLog(controller, "info", "collect", `Dongu ${cycle}/${maxCycles}: Gorunur=${visible.size}, Toplam=${collected.size}, Toplanabilir=${collectableCount}, Hedef=${desiredCandidates}`);
    }

    if (collectableCount >= desiredCandidates) {
      await sendLog(controller, "info", "collect", "Yeterli aday toplandi.", {
        collectableCount,
        desiredCandidates,
        cycle
      });
      break;
    }

    if (collected.size === previousCount && collectableCount === previousCollectableCount) {
      stableCycles += 1;
    } else {
      stableCycles = 0;
      previousCount = collected.size;
      previousCollectableCount = collectableCount;
    }
    const stableThreshold = collectableCount >= Math.max(1, Math.floor(desiredCandidates * 0.7)) ? 8 : 18;
    if (stableCycles >= stableThreshold && scrollStuckCycles >= 16) {
      await sendLog(controller, "warn", "collect", "Scroll ilerlemesi durdu, aday toplama erken bitiriliyor.", {
        cycle,
        stableCycles,
        scrollStuckCycles,
        collectableCount
      });
      break;
    }

    const oldScrollTop = feed.scrollTop;
    feed.scrollTop = feed.scrollTop + Math.max(feed.clientHeight * 0.85, 600);
    if (Math.floor(feed.scrollTop) === Math.floor(oldScrollTop)) {
      feed.dispatchEvent(new WheelEvent("wheel", { deltaY: 820, bubbles: true, cancelable: true }));
      feed.scrollTop = feed.scrollTop + Math.max(feed.clientHeight * 1.1, 900);
    }
    await smartDelay(controller, safeMode, 350, 1100);
    const currentScrollTop = Math.floor(feed.scrollTop);
    const currentScrollHeight = Math.floor(feed.scrollHeight);
    
    if (cycle % 10 === 0) {
      await sendLog(controller, "info", "collect", `Scroll yapildi. Eski scrollTop: ${oldScrollTop}, Yeni scrollTop: ${currentScrollTop}, scrollHeight: ${currentScrollHeight}, scrollStuckCycles: ${scrollStuckCycles}, stableCycles: ${stableCycles}`);
    }

    if (currentScrollTop === previousScrollTop && currentScrollHeight === previousScrollHeight) {
      scrollStuckCycles += 1;
    } else {
      scrollStuckCycles = 0;
      previousScrollTop = currentScrollTop;
      previousScrollHeight = currentScrollHeight;
    }
  }

  await sendLog(controller, "info", "collect", "Aday toplama tamamlandi.", { collected: collected.size });

  return Array.from(collected.values());
}

function parseFromAriaLabel(label) {
  if (!label) {
    return "";
  }
  const colonIndex = label.indexOf(":");
  if (colonIndex >= 0 && colonIndex < label.length - 1) {
    return label.slice(colonIndex + 1).trim();
  }
  return label.trim();
}

function getActiveDetailRoot() {
  const mains = Array.from(document.querySelectorAll(SELECTORS.detailsRoot));
  if (mains.length === 0) {
    return document;
  }

  const scored = mains.map((main) => {
    const rect = main.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0;
    const titleNode = main.querySelector("h1.DUwDvf, h1[data-attrid='title'], h1.fontHeadlineLarge");
    const contactNodeCount = main.querySelectorAll(
      "[data-item-id*='address'], [data-item-id^='phone'], [data-item-id*='phone:tel'], [data-item-id*='authority'], [data-item-id*='website'], a[href^='tel:']"
    ).length;
    const hasFeed = Boolean(main.querySelector(SELECTORS.resultsFeed));

    // Feed panelinden ziyade detay panelini secmek icin basit skor.
    let score = 0;
    if (titleNode) {
      score += 120;
    }
    score += Math.min(contactNodeCount, 20) * 6;
    if (isVisible) {
      score += 10;
    }
    if (hasFeed) {
      score -= 25;
    }

    return { main, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.main || mains[0];
}

function hasDetailContactNodes(root = document) {
  if (!root) {
    return false;
  }
  return Boolean(
    root.querySelector(
      "[data-item-id*='address'], [data-item-id^='phone'], [data-item-id*='phone:tel'], [data-item-id*='authority'], [data-item-id*='website'], a[href^='tel:']"
    )
  );
}

function hasPhoneOrWebsiteNode(root = document) {
  if (!root) {
    return false;
  }
  return Boolean(root.querySelector("[data-item-id^='phone'], [data-item-id*='phone:tel'], [data-item-id*='authority'], [data-item-id*='website'], a[href^='tel:']"));
}

function hasAddressNode(root = document) {
  if (!root) {
    return false;
  }
  return Boolean(root.querySelector("[data-item-id*='address']"));
}

function getReviewCountFromButton(root = document) {
  const button = root.querySelector(SELECTORS.reviewButton);
  if (!button) {
    return null;
  }
  const label = button.getAttribute("aria-label") || getText(button);
  return parseReviewCount(label);
}

function getCategory() {
  const node = document.querySelector(SELECTORS.categoryButton);
  if (!node) {
    return "";
  }
  return getText(node) || node.getAttribute("aria-label") || "";
}

function getStatus() {
  const node = document.querySelector(SELECTORS.statusElement);
  if (!node) {
    return "";
  }
  return getText(node) || node.getAttribute("aria-label") || "";
}

function collectDetailFields(detailRoot = null) {
  const details = {
    fullAddress: "",
    phone: "",
    website: "",
    websiteDomain: "",
    priceText: "",
    hasDelivery: false,
    hasTakeaway: false,
    hasDineIn: false,
    services: []
  };

  const root = detailRoot || getActiveDetailRoot();
  const nodes = Array.from(root.querySelectorAll(SELECTORS.detailNodes));
  for (const node of nodes) {
    const itemId = (node.getAttribute("data-item-id") || "").toLowerCase();
    const ariaLabel = node.getAttribute("aria-label") || "";
    const text = getText(node);
    const href = node.getAttribute("href") || "";
    const normalized = normalizeText(text || ariaLabel);

    if (itemId.includes("address")) {
      details.fullAddress = details.fullAddress || parseFromAriaLabel(ariaLabel) || text;
    }
    if (itemId.startsWith("phone") || itemId.includes("phone:tel") || href.startsWith("tel:")) {
      const phoneCandidate = pickFirstPhone([href.replace(/^tel:/i, ""), parseFromAriaLabel(ariaLabel), text, ariaLabel, href]);
      if (phoneCandidate) {
        details.phone = details.phone || phoneCandidate;
      }
    }
    if (itemId.includes("authority") || itemId.includes("website")) {
      const websiteCandidate =
        resolveBusinessWebsite(href) ||
        resolveBusinessWebsite(parseFromAriaLabel(ariaLabel)) ||
        resolveBusinessWebsite(text);
      if (websiteCandidate) {
        details.website = details.website || websiteCandidate;
      }
    }
    if (!details.priceText && (normalized.includes("kisi basi") || parsePriceText(text || ariaLabel))) {
      details.priceText = parsePriceText(text || ariaLabel);
    }
    if (normalized.includes("paket servis") || normalized.includes("delivery")) {
      details.hasDelivery = true;
      details.services.push(text || ariaLabel);
    }
    if (normalized.includes("gel al") || normalized.includes("takeaway")) {
      details.hasTakeaway = true;
      details.services.push(text || ariaLabel);
    }
    if (normalized.includes("iceride servis") || normalized.includes("yerinde servis") || normalized.includes("dine in")) {
      details.hasDineIn = true;
      details.services.push(text || ariaLabel);
    }
  }

  const links = Array.from(root.querySelectorAll("a[href]"));
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    if (!href) {
      continue;
    }
    const websiteCandidate = resolveBusinessWebsite(href);
    if (!details.website && websiteCandidate) {
      details.website = websiteCandidate;
    }
  }

  if (!details.phone) {
    const contactNodes = Array.from(root.querySelectorAll("a[href^='tel:'], button[aria-label], span[aria-label], div[aria-label]"));
    for (const node of contactNodes) {
      const href = node.getAttribute("href") || "";
      const aria = node.getAttribute("aria-label") || "";
      const text = getText(node);
      const hint = normalizeText(`${aria} ${text}`);
      if (!href.startsWith("tel:") && !hint.includes("telefon") && !hint.includes("phone")) {
        continue;
      }
      const phoneCandidate = pickFirstPhone([href.replace(/^tel:/i, ""), parseFromAriaLabel(aria), text, aria, href]);
      if (phoneCandidate) {
        details.phone = phoneCandidate;
        break;
      }
    }
  }

  if (!details.phone) {
    details.phone = pickFirstPhone([root.innerText || ""]);
  }

  details.services = Array.from(new Set(details.services.filter(Boolean)));
  details.websiteDomain = parseWebsiteDomain(details.website);
  return details;
}

function buildResultRecord(candidate, detailRoot = null) {
  const pageUrl = window.location.href;
  const root = detailRoot || getActiveDetailRoot();
  const titleNode = root.querySelector("h1.DUwDvf, h1[data-attrid='title'], h1.fontHeadlineLarge");
  const ratingNode = root.querySelector(SELECTORS.ratingLabel);

  const titleName = getText(titleNode);
  const candidateName = String(candidate.nameHint || "").trim();
  const isCandidateListHeading = normalizeText(candidateName) === "sonuclar";
  const name = (!isCandidateListHeading && candidateName) || titleName || "";
  const rating = parseRating(getText(ratingNode) || ratingNode?.getAttribute("aria-label") || "");
  const details = collectDetailFields(root);
  const latLng = extractLatLngFromUrl(candidate.url || candidate.canonicalUrl || pageUrl);
  const fullAddress = details.fullAddress || candidate.listAddress || "";
  const addressParts = parseAddressParts(fullAddress);
  const listPriceText = candidate.listPriceText || "";
  const priceText = details.priceText || listPriceText;
  const priceLevel = parsePriceLevel(priceText);
  const placeId = extractPlaceIdFromUrl(pageUrl) || extractPlaceIdFromUrl(candidate.url);
  const cid = extractCidFromUrl(pageUrl) || extractCidFromUrl(candidate.url);
  const mergedServices = Array.from(new Set([...(details.services || []), ...((candidate.listServices || []).filter(Boolean))]));
  const effectiveRating =
    Number.isFinite(rating) ? rating : Number.isFinite(candidate.listRating) ? candidate.listRating : null;
  const website = details.website || "";

  const record = {
    placeId: placeId || "",
    cid: cid || "",
    mapsUrl: pageUrl,
    name,
    fetchedAt: new Date().toISOString(),
    fullAddress,
    listAddress: candidate.listAddress || "",
    district: addressParts.district || "",
    city: addressParts.city || "",
    lat: Number.isFinite(latLng.lat) ? latLng.lat : null,
    lng: Number.isFinite(latLng.lng) ? latLng.lng : null,
    phone: details.phone || "",
    website,
    websiteDomain: details.websiteDomain || parseWebsiteDomain(website),
    rating: effectiveRating,
    listRating: Number.isFinite(candidate.listRating) ? candidate.listRating : null,
    priceLevel,
    priceText,
    listPriceText,
    isSponsored: Boolean(candidate.isSponsored),
    hasDelivery: details.hasDelivery || mergedServices.some((line) => normalizeText(line).includes("paket servis")),
    hasTakeaway:
      details.hasTakeaway ||
      mergedServices.some((line) => normalizeText(line).includes("gel al") || normalizeText(line).includes("takeaway")),
    hasDineIn:
      details.hasDineIn ||
      mergedServices.some(
        (line) =>
          normalizeText(line).includes("iceride servis") || normalizeText(line).includes("yerinde servis")
      )
  };

  return record;
}

async function buildStableResultRecord(candidate, controller, safeMode) {
  const timeoutMs = 14000;
  const start = Date.now();
  let best = null;
  let iterations = 0;

  await sendLog(controller, "info", "candidate", `Kararli kayit olusturma basladi. Aday: '${candidate?.nameHint || "Bilinmeyen"}'`);

  while (Date.now() - start < timeoutMs) {
    assertNotCancelled(controller);
    iterations += 1;
    const detailsRoot = getActiveDetailRoot();
    best = buildResultRecord(candidate, detailsRoot);

    const hasContact = Boolean((best.phone || "").trim() || (best.website || "").trim());
    const hasAnyDetailContactNode = hasDetailContactNodes(detailsRoot);
    const hasDetailAddress = hasAddressNode(detailsRoot);
    const hasDetailPhoneOrWebsite = hasPhoneOrWebsiteNode(detailsRoot);
    const elapsed = Date.now() - start;

    await sendLog(controller, "info", "candidate", `Detay kontrolu #${iterations} (${elapsed}ms): hasContact=${hasContact} (Telefon: '${best.phone}', Web: '${best.website}'), hasAnyDetailContactNode=${hasAnyDetailContactNode}, hasDetailAddress=${hasDetailAddress}, hasDetailPhoneOrWebsite=${hasDetailPhoneOrWebsite}`);

    if (hasContact) {
      await sendLog(controller, "info", "candidate", `Iletisim bilgisi bulundu (Telefon veya Web), kararli kayit olusturuldu. Gecen sure: ${elapsed}ms`);
      return best;
    }

    // Panelde detay düğümleri varsa ama phone/website yoksa bir süre bekleyip yine de devam et.
    if (hasDetailAddress && !hasDetailPhoneOrWebsite && elapsed > 9000) {
      await sendLog(controller, "warn", "candidate", `Detay panelinde adres dugumu var ancak telefon/web dugumu yok ve 9sn gecti. Mevcut veriyle devam ediliyor.`);
      return best;
    }

    // Hicbir detay dugumu gelmezse panel acilmamis olabilir, bir miktar daha bekle.
    if (!hasAnyDetailContactNode && elapsed > 12000) {
      await sendLog(controller, "warn", "candidate", `12sn gecmesine ragmen DOM'da hicbir detay dugumu bulunamadi. Mevcut veriyle devam ediliyor.`);
      return best;
    }

    await smartDelay(controller, safeMode, 220, 560);
  }

  await sendLog(controller, "warn", "candidate", `Kararli kayit olusturma limitine ulasildi (${timeoutMs}ms). Mevcut veriyle donuluyor.`);
  return best || buildResultRecord(candidate);
}

function buildFallbackRecord(candidate) {
  const url = candidate.url || candidate.canonicalUrl || window.location.href;
  const latLng = extractLatLngFromUrl(url);
  const placeId = extractPlaceIdFromUrl(url);
  const cid = extractCidFromUrl(url);
  const fullAddress = candidate.listAddress || "";
  const addressParts = parseAddressParts(fullAddress);
  const candidateName = String(candidate.nameHint || "").trim();
  const name = normalizeText(candidateName) === "sonuclar" ? "" : candidateName;
  const listServices = Array.isArray(candidate.listServices) ? candidate.listServices : [];
  const serviceText = normalizeText(listServices.join(" "));

  return {
    placeId: placeId || "",
    cid: cid || "",
    mapsUrl: url,
    name,
    fetchedAt: new Date().toISOString(),
    fullAddress,
    listAddress: fullAddress,
    district: addressParts.district || "",
    city: addressParts.city || "",
    lat: Number.isFinite(latLng.lat) ? latLng.lat : null,
    lng: Number.isFinite(latLng.lng) ? latLng.lng : null,
    phone: "",
    website: "",
    websiteDomain: "",
    rating: Number.isFinite(candidate.listRating) ? candidate.listRating : null,
    listRating: Number.isFinite(candidate.listRating) ? candidate.listRating : null,
    priceLevel: parsePriceLevel(candidate.listPriceText || ""),
    priceText: candidate.listPriceText || "",
    listPriceText: candidate.listPriceText || "",
    isSponsored: Boolean(candidate.isSponsored),
    hasDelivery: serviceText.includes("paket servis") || serviceText.includes("delivery"),
    hasTakeaway: serviceText.includes("gel al") || serviceText.includes("takeaway"),
    hasDineIn: serviceText.includes("iceride servis") || serviceText.includes("yerinde servis") || serviceText.includes("dine in")
  };
}

async function collectPendingDetailCandidate(payload, controller, safeMode, knownKeys) {
  const pending = payload?.pendingDetailCandidate;
  if (!pending || typeof pending !== "object") {
    return [];
  }

  const currentUrl = window.location.href;
  const isPlacePage = currentUrl.includes("/maps/place/") || currentUrl.includes("maps?cid=");
  const candidate = {
    ...pending,
    url: pending.url || currentUrl,
    canonicalUrl: pending.canonicalUrl || canonicalizeMapUrl(pending.url || currentUrl)
  };

  if (!isPlacePage && !isCandidateLocationMatch(candidate, currentUrl)) {
    await sendLog(controller, "warn", "candidate", "Bekleyen aday detayi icin detay sayfasi acik degil; normal arama akisina geciliyor.", {
      name: candidate.nameHint || "",
      currentUrl
    });
    return [];
  }

  const recordKey = buildCandidateIdentityKey(candidate);
  if (recordKey && knownKeys?.has(recordKey)) {
    await sendLog(controller, "info", "candidate", "Bekleyen aday arsivde zaten var, detay resume kaydi atlandi.", {
      name: candidate.nameHint || ""
    });
    return [];
  }

  await sendLog(controller, "info", "candidate", "URL yonlendirmesi sonrasi bekleyen aday detayi okunuyor.", {
    name: candidate.nameHint || "",
    currentUrl
  });

  const opened = await waitForCandidateOpen(candidate, controller, 14000);
  if (!opened) {
    await sendLog(controller, "warn", "candidate", "Bekleyen aday detay sayfasinda dogrulanamadi; normal arama akisina geciliyor.", {
      name: candidate.nameHint || "",
      currentUrl: window.location.href
    });
    return [];
  }

  let record = null;
  try {
    record = await runWithTimeout(
      async () => buildStableResultRecord(candidate, controller, safeMode),
      18000,
      "Bekleyen aday detay okuma timeout (18sn)"
    );
  } catch (error) {
    await sendLog(controller, "warn", "candidate", "Bekleyen aday detayindan kararli kayit okunamadi, fallback kullaniliyor.", {
      name: candidate.nameHint || "",
      error: error && error.message ? error.message : String(error)
    });
  }

  if (!record || !record.name) {
    record = buildFallbackRecord(candidate);
  }

  if (!record || !record.name) {
    return [];
  }

  const finalKey = buildRecordIdentityKey(record);
  if (finalKey && knownKeys?.has(finalKey)) {
    await sendLog(controller, "info", "candidate", "Bekleyen aday kaydi mevcut anahtarlarla zaten biliniyor.", {
      name: record.name
    });
    return [];
  }

  if (finalKey && knownKeys) {
    knownKeys.add(finalKey);
  }

  await sendProgress(controller, {
    phase: "toplaniyor",
    progress: 8,
    current: 1,
    total: payload?.settings?.maxResults || 1,
    message: `Yonlendirme sonrasi detay kaydedildi: ${record.name}`,
    record
  });

  await sendLog(controller, "info", "candidate", "Bekleyen aday detayi kaydedildi, normal arama akisina donulecek.", {
    name: record.name
  });

  return [record];
}

function buildNameAddressKey(name, address) {
  const normalizedName = normalizeText(name || "");
  const normalizedAddress = normalizeText(address || "");
  if (!normalizedName && !normalizedAddress) {
    return "";
  }
  return `${normalizedName}|${normalizedAddress}`;
}

function buildRecordIdentityKey(record) {
  if (!record) {
    return "";
  }
  if (record.placeId) {
    return `pid:${String(record.placeId).trim()}`;
  }
  if (record.cid) {
    return `cid:${String(record.cid).trim()}`;
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

function buildCandidateIdentityKey(candidate) {
  if (!candidate) {
    return "";
  }

  const placeId = extractPlaceIdFromUrl(candidate.url || candidate.canonicalUrl || "");
  if (placeId) {
    return `pid:${placeId}`;
  }

  const cid = extractCidFromUrl(candidate.url || candidate.canonicalUrl || "");
  if (cid) {
    return `cid:${cid}`;
  }

  const entityToken = extractEntityTokenFromUrl(candidate.url || candidate.canonicalUrl || "");
  if (entityToken) {
    return `gid:${entityToken}`;
  }

  const hexEntity = extractHexEntityFromUrl(candidate.url || candidate.canonicalUrl || "");
  if (hexEntity) {
    return `hex:${hexEntity}`;
  }

  const canonicalUrl = canonicalizeMapUrl(candidate.url || candidate.canonicalUrl || "");
  if (canonicalUrl) {
    return `url:${canonicalUrl}`;
  }

  const nameAddress = buildNameAddressKey(candidate.nameHint || "", candidate.listAddress || "");
  if (nameAddress) {
    return `na:${nameAddress}`;
  }

  return "";
}

function buildKnownKeySetFromFilters(filters) {
  const knownKeys = new Set();
  if (!filters || typeof filters !== "object") {
    return knownKeys;
  }

  const placeIds = Array.isArray(filters.placeIds) ? filters.placeIds : [];
  const cids = Array.isArray(filters.cids) ? filters.cids : [];
  const entityTokens = Array.isArray(filters.entityTokens) ? filters.entityTokens : [];
  const hexEntities = Array.isArray(filters.hexEntities) ? filters.hexEntities : [];
  const mapsUrls = Array.isArray(filters.mapsUrls) ? filters.mapsUrls : [];
  const nameAddress = Array.isArray(filters.nameAddress) ? filters.nameAddress : [];

  for (const placeId of placeIds) {
    const key = String(placeId || "").trim();
    if (key) {
      knownKeys.add(`pid:${key}`);
    }
  }
  for (const cid of cids) {
    const key = String(cid || "").trim();
    if (key) {
      knownKeys.add(`cid:${key}`);
    }
  }
  for (const entityToken of entityTokens) {
    const key = String(entityToken || "").trim();
    if (key) {
      knownKeys.add(`gid:${key}`);
    }
  }
  for (const hexEntity of hexEntities) {
    const key = String(hexEntity || "").trim().toLowerCase();
    if (key) {
      knownKeys.add(`hex:${key}`);
    }
  }
  for (const url of mapsUrls) {
    const entityToken = extractEntityTokenFromUrl(url || "");
    if (entityToken) {
      knownKeys.add(`gid:${entityToken}`);
    }
    const hexEntity = extractHexEntityFromUrl(url || "");
    if (hexEntity) {
      knownKeys.add(`hex:${hexEntity}`);
    }
    const canonical = canonicalizeMapUrl(url || "");
    if (canonical) {
      knownKeys.add(`url:${canonical}`);
    }
  }
  for (const key of nameAddress) {
    const normalized = normalizeText(key || "");
    if (normalized) {
      knownKeys.add(`na:${normalized}`);
    }
  }

  return knownKeys;
}

async function loadKnownKeySet(existingFilters) {
  return buildKnownKeySetFromFilters(existingFilters);
}

function dedupeRecords(records) {
  const unique = new Map();
  for (const record of records) {
    const key = buildRecordIdentityKey(record);
    if (!key) {
      continue;
    }
    if (!unique.has(key)) {
      unique.set(key, record);
    }
  }
  return Array.from(unique.values());
}

function isCandidateLocationMatch(candidate, currentUrl) {
  const targetCanonical = canonicalizeMapUrl(candidate.url || candidate.canonicalUrl || "");
  const currentCanonical = canonicalizeMapUrl(currentUrl || "");
  if (targetCanonical && currentCanonical && targetCanonical === currentCanonical) {
    return true;
  }

  const targetCid = extractCidFromUrl(candidate.url) || extractCidFromUrl(candidate.canonicalUrl);
  const currentCid = extractCidFromUrl(currentUrl);
  if (targetCid && currentCid && targetCid === currentCid) {
    return true;
  }

  const targetPlaceId = extractPlaceIdFromUrl(candidate.url) || extractPlaceIdFromUrl(candidate.canonicalUrl);
  const currentPlaceId = extractPlaceIdFromUrl(currentUrl);
  if (targetPlaceId && currentPlaceId && targetPlaceId === currentPlaceId) {
    return true;
  }

  const targetEntityToken = extractEntityTokenFromUrl(candidate.url || candidate.canonicalUrl || "");
  const currentEntityToken = extractEntityTokenFromUrl(currentUrl || "");
  if (targetEntityToken && currentEntityToken && targetEntityToken === currentEntityToken) {
    return true;
  }

  const targetHexEntity = extractHexEntityFromUrl(candidate.url || candidate.canonicalUrl || "");
  const currentHexEntity = extractHexEntityFromUrl(currentUrl || "");
  if (targetHexEntity && currentHexEntity && targetHexEntity === currentHexEntity) {
    return true;
  }

  return false;
}

function hasCandidateDetailSignals(candidate) {
  const detailRoot = getActiveDetailRoot();
  const title = document.querySelector(SELECTORS.placeTitle);
  const locationMatches = isCandidateLocationMatch(candidate, window.location.href);
  const hasTitle = Boolean(title && isInteractable(title));
  const normalizedTitle = normalizeText(getText(title));
  const normalizedCandidateName = normalizeText(candidate?.nameHint || "");
  const titleMatchesCandidate =
    Boolean(normalizedTitle && normalizedCandidateName) &&
    (normalizedTitle === normalizedCandidateName ||
      normalizedTitle.includes(normalizedCandidateName) ||
      normalizedCandidateName.includes(normalizedTitle));
  const hasDetailNodes =
    hasDetailContactNodes(detailRoot) ||
    hasAddressNode(detailRoot) ||
    hasPhoneOrWebsiteNode(detailRoot);

  if (locationMatches && (hasTitle || hasDetailNodes)) {
    return true;
  }

  if (titleMatchesCandidate && hasDetailNodes) {
    return true;
  }

  return false;
}

async function waitForCandidateOpen(candidate, controller, timeoutMs = 15000) {
  const start = Date.now();
  let locationMatchedAt = 0;

  while (Date.now() - start < timeoutMs) {
    assertNotCancelled(controller);

    if (hasCandidateDetailSignals(candidate)) {
      return true;
    }

    if (isCandidateLocationMatch(candidate, window.location.href)) {
      if (!locationMatchedAt) {
        locationMatchedAt = Date.now();
      }
      if (Date.now() - locationMatchedAt > 900) {
        return true;
      }
    }

    await sleep(220);
  }

  return isCandidateLocationMatch(candidate, window.location.href);
}

function getCandidateCardElement(anchor) {
  if (!anchor) {
    return null;
  }
  return (
    anchor.closest(SELECTORS.resultArticle) ||
    anchor.closest("div.Nv2PK") ||
    anchor.closest("div[jsaction*='pane.resultSection.click']") ||
    anchor
  );
}

function getElementCenterPoint(element) {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return {
    x: Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
    y: Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
  };
}

function dispatchPointerClickSequence(element) {
  const point = getElementCenterPoint(element);
  if (!point) {
    element?.click?.();
    return element || null;
  }

  const target = document.elementFromPoint(point.x, point.y) || element;
  const pointerBase = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: point.x,
    clientY: point.y,
    screenX: window.screenX + point.x,
    screenY: window.screenY + point.y,
    button: 0,
    buttons: 1
  };
  const mouseBase = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: point.x,
    clientY: point.y,
    screenX: window.screenX + point.x,
    screenY: window.screenY + point.y,
    button: 0,
    buttons: 1
  };

  try {
    target.dispatchEvent(new PointerEvent("pointerover", { ...pointerBase, pointerType: "mouse", pointerId: 1, isPrimary: true }));
    target.dispatchEvent(new PointerEvent("pointermove", { ...pointerBase, pointerType: "mouse", pointerId: 1, isPrimary: true }));
    target.dispatchEvent(new PointerEvent("pointerdown", { ...pointerBase, pointerType: "mouse", pointerId: 1, isPrimary: true }));
  } catch (error) {
    target.dispatchEvent(new MouseEvent("mouseover", mouseBase));
    target.dispatchEvent(new MouseEvent("mousemove", mouseBase));
  }

  target.dispatchEvent(new MouseEvent("mousedown", mouseBase));
  target.dispatchEvent(new MouseEvent("mouseup", { ...mouseBase, buttons: 0 }));

  try {
    target.dispatchEvent(new PointerEvent("pointerup", { ...pointerBase, buttons: 0, pointerType: "mouse", pointerId: 1, isPrimary: true }));
  } catch (error) {
    // PointerEvent desteklenmiyorsa MouseEvent dizisi yeterli olur.
  }

  target.dispatchEvent(new MouseEvent("click", { ...mouseBase, buttons: 0 }));
  return target;
}

function dispatchKeyboardOpen(element) {
  if (!element) {
    return;
  }
  if (typeof element.focus === "function") {
    element.focus({ preventScroll: true });
  }
  const keyboardBase = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  };
  element.dispatchEvent(new KeyboardEvent("keydown", keyboardBase));
  element.dispatchEvent(new KeyboardEvent("keyup", keyboardBase));
}

function serializeCandidateForResume(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  return {
    url: candidate.url || "",
    canonicalUrl: candidate.canonicalUrl || canonicalizeMapUrl(candidate.url || ""),
    nameHint: candidate.nameHint || "",
    identityKey: candidate.identityKey || "",
    listRating: Number.isFinite(candidate.listRating) ? candidate.listRating : null,
    listPriceText: candidate.listPriceText || "",
    listStatus: candidate.listStatus || "",
    listInfoLine: candidate.listInfoLine || "",
    listAddress: candidate.listAddress || "",
    listServices: Array.isArray(candidate.listServices) ? candidate.listServices.slice(0, 12) : [],
    listSnippet: candidate.listSnippet || "",
    isSponsored: Boolean(candidate.isSponsored),
    listActions: Array.isArray(candidate.listActions) ? candidate.listActions.slice(0, 8) : []
  };
}

function buildCandidateNavigationUrl(candidate) {
  const rawCandidates = [candidate?.url, candidate?.canonicalUrl].filter(Boolean);
  for (const raw of rawCandidates) {
    try {
      const absolute = new URL(raw, window.location.origin).toString();
      if (isValidMapsPlaceHref(absolute)) {
        return absolute;
      }
    } catch (error) {
      // Bir sonraki aday URL denenir.
    }
  }
  return "";
}

async function clickCandidate(candidate, controller, safeMode) {
  assertNotCancelled(controller);
  await sendLog(controller, "info", "candidate", "Aday acma basladi.", {
    name: candidate?.nameHint || "",
    url: candidate?.url || "",
    canonicalUrl: candidate?.canonicalUrl || ""
  });

  const navTarget = buildCandidateNavigationUrl(candidate);
  const anchors = Array.from(document.querySelectorAll(SELECTORS.resultAnchors));
  await sendLog(controller, "info", "candidate", `Sayfadaki toplam aday link sayisi: ${anchors.length}`);

  const matched =
    anchors.find((node) => {
      const href = node.getAttribute("href") || "";
      if (!isValidMapsPlaceHref(href)) {
        return false;
      }
      const canonical = canonicalizeMapUrl(href);
      return canonical === candidate.canonicalUrl;
    }) ||
    anchors.find((node) => {
      const href = node.getAttribute("href") || "";
      if (!isValidMapsPlaceHref(href)) {
        return false;
      }
      return candidate.url && href.includes(candidate.url);
    });

  let matchedCard = null;
  if (matched) {
    const matchedHref = matched.getAttribute("href");
    const matchedLabel = matched.getAttribute("aria-label") || getText(matched);
    matchedCard = getCandidateCardElement(matched);
    const clickRect = (matchedCard || matched).getBoundingClientRect();
    await sendLog(controller, "info", "candidate", `Eslesen anchor DOM'da bulundu. Href: '${matchedHref}', Label: '${matchedLabel}'. Tiklama yapiliyor.`, {
      clickTarget: matchedCard && matchedCard !== matched ? "card" : "anchor",
      rect: {
        width: Math.round(clickRect.width),
        height: Math.round(clickRect.height),
        top: Math.round(clickRect.top),
        left: Math.round(clickRect.left)
      }
    });
    assertCandidateStillActive(candidate, controller);
    (matchedCard || matched).scrollIntoView({ block: "center" });
    await smartDelay(controller, safeMode, 120, 320);
    assertCandidateStillActive(candidate, controller);
    matched.click();
  } else {
    await sendLog(controller, "warn", "candidate", `Eslesen anchor DOM'da BULUNAMADI! NavTarget: '${navTarget}'. Sayfa yonlendiriliyor (BU ISLEM SAYFAYI YENIDEN BASLATIR!)`);
    if (!navTarget) {
      throw new Error("Aday isletme linki bulunamadi ve navTarget bos.");
    }
    assertCandidateStillActive(candidate, controller);
    await navigateWithResumeSignal(controller, navTarget, "candidate-anchor-missing", {
      targetUrl: navTarget,
      candidateName: candidate?.nameHint || "",
      pendingCandidate: serializeCandidateForResume(candidate)
    });
  }

  await smartDelay(controller, safeMode, 420, 980);
  assertCandidateStillActive(candidate, controller);
  await sendLog(controller, "info", "candidate", "Detay panelinin acilmasi bekleniyor (Deneme 1, limit 5.2sn)...", {
    currentUrl: window.location.href
  });
  let opened = await waitForCandidateOpen(candidate, controller, 5200);
  assertCandidateStillActive(candidate, controller);
  await sendLog(controller, "info", "candidate", `Detay paneli acilma durumu (Deneme 1): ${opened}`, {
    currentUrl: window.location.href
  });

  if (!opened && matched) {
    await sendLog(controller, "warn", "candidate", "Detay paneli acilamadi, kart uzerinden pointer/mouse click dizisi gonderiliyor...");
    assertCandidateStillActive(candidate, controller);
    const pointerTarget = dispatchPointerClickSequence(matchedCard || matched);
    await smartDelay(controller, safeMode, 380, 820);
    assertCandidateStillActive(candidate, controller);
    await sendLog(controller, "info", "candidate", "Detay panelinin acilmasi bekleniyor (Deneme 2, limit 5.2sn)...", {
      pointerTarget: pointerTarget?.tagName || "",
      currentUrl: window.location.href
    });
    opened = await waitForCandidateOpen(candidate, controller, 5200);
    assertCandidateStillActive(candidate, controller);
    await sendLog(controller, "info", "candidate", `Detay paneli acilma durumu (Deneme 2): ${opened}`, {
      currentUrl: window.location.href
    });
  }

  if (!opened && matched) {
    await sendLog(controller, "warn", "candidate", "Detay paneli hala acilmadi, anchor'a klavye Enter aktivasyonu gonderiliyor...");
    assertCandidateStillActive(candidate, controller);
    dispatchKeyboardOpen(matched);
    await smartDelay(controller, safeMode, 300, 700);
    assertCandidateStillActive(candidate, controller);
    await sendLog(controller, "info", "candidate", "Detay panelinin acilmasi bekleniyor (Deneme 3, limit 3.8sn)...", {
      currentUrl: window.location.href
    });
    opened = await waitForCandidateOpen(candidate, controller, 3800);
    assertCandidateStillActive(candidate, controller);
    await sendLog(controller, "info", "candidate", `Detay paneli acilma durumu (Deneme 3): ${opened}`, {
      currentUrl: window.location.href
    });
  }

  if (!opened && navTarget) {
    if (matched) {
      await sendLog(controller, "warn", "candidate", "DOM'da eslesen anchor var ama tiklama denemeleri detay panelini acmadi; kontrollu URL yonlendirmesi deneniyor.", {
        name: candidate?.nameHint || "",
        url: navTarget
      });
      assertCandidateStillActive(candidate, controller);
      await navigateWithResumeSignal(controller, navTarget, "candidate-click-failed", {
        targetUrl: navTarget,
        candidateName: candidate?.nameHint || "",
        pendingCandidate: serializeCandidateForResume(candidate)
      });
      await smartDelay(controller, safeMode, 900, 1600);
    } else {
      assertCandidateStillActive(candidate, controller);
      await sendLog(controller, "warn", "candidate", `Detay paneli hala acilamadi. URL yonlendirmesi deneniyor: '${navTarget}' (BU ISLEM SAYFAYI YENIDEN BASLATIR!)`);
      await navigateWithResumeSignal(controller, navTarget, "candidate-open-fallback", {
        targetUrl: navTarget,
        candidateName: candidate?.nameHint || "",
        pendingCandidate: serializeCandidateForResume(candidate)
      });
      await smartDelay(controller, safeMode, 700, 1300);
    }
  }
  assertCandidateStillActive(candidate, controller);
  const reopened = opened || (await waitForCandidateOpen(candidate, controller, 7000));
  assertCandidateStillActive(candidate, controller);
  if (!reopened) {
    await sendLog(controller, "error", "candidate", "Aday detay paneli acilamadi.", {
      name: candidate?.nameHint || "",
      url: navTarget || candidate?.url || ""
    });
    throw new Error("Isletme detay paneli acilamadi.");
  }
  await sendLog(controller, "info", "candidate", "Aday detay paneli basariyla acildi.", {
    name: candidate?.nameHint || ""
  });
}

async function returnToResults(query, controller, safeMode) {
  assertNotCancelled(controller);
  const existingList = hasResultsListPresent(document);
  const detailOpen = isDetailPanelStillOpen();
  await sendLog(controller, "info", "navigation", `Sonuc listesine donus baslatildi. resultsFeed var mi: ${existingList}, detay paneli acik mi: ${detailOpen}`);
  if (existingList && !detailOpen) {
    await sendLog(controller, "info", "navigation", "Sonuc listesi zaten DOM'da mevcut, geri donus islemine gerek yok.");
    return;
  }

  // 1. Adim: Detay panelini sinirli sayida deneme ile kapat
  await sendLog(controller, "info", "navigation", "Detay paneli kapatilmaya calisiliyor (Kapat butonu aranıyor)...");
  const closed = await tryCloseDetailPanel(controller, safeMode);
  const hasListNow = hasResultsListPresent(document);
  const detailStillOpen = isDetailPanelStillOpen();
  await sendLog(controller, "info", "navigation", `Kapatma denemeleri sonrasi resultsFeed var mi: ${hasListNow}, detay paneli acik mi: ${detailStillOpen}`);
  if (hasListNow && !detailStillOpen) {
    return;
  }
  if (!closed || !hasListNow || detailStillOpen) {
    const searchUrl = buildMapsSearchUrl(query);
    await sendLog(controller, "warn", "navigation", "Panel kapatilamadi; sonuc listesi yeniden yuklenecek.", {
      searchUrl
    });
    await navigateWithResumeSignal(controller, searchUrl, "results-feed-missing-after-close", {
      targetUrl: searchUrl
    });
    await sleep(3000);
    throw new Error("Sonuc listesi geri getirilemedi; arama sayfasi yeniden yukleniyor.");
  }
}

async function runScrape(payload, controller) {
  const { runId, query, settings, existingFilters } = payload;
  const safeMode = settings.safeMode !== false;
  const maxResults = Number.isFinite(settings.maxResults) ? settings.maxResults : 50;
  const skipExisting = settings.skipExisting !== false;
  const knownKeys = skipExisting ? await loadKnownKeySet(existingFilters) : new Set();
  await sendLog(controller, "info", "run", "Toplama akisi basladi.", {
    runId,
    query,
    maxResults,
    safeMode,
    skipExisting
  });

  await sendProgress(controller, {
    phase: "hazirlaniyor",
    progress: 2,
    current: 0,
    total: maxResults,
    message: "Arama hazirlaniyor..."
  });

  const precollectedRecords = await collectPendingDetailCandidate(payload, controller, safeMode, knownKeys);

  await ensureSearch(query, controller, safeMode);
  const candidateTarget = Math.max(1, maxResults);
  const collectedCandidates = await collectCandidates(candidateTarget, controller, safeMode, {
    skipExisting,
    knownKeys,
    maxCycles: Math.max(70, Math.min(160, Math.ceil(maxResults * 4.5)))
  });
  await sendLog(controller, "info", "run", "Aday listesi elde edildi.", {
    rawCandidateCount: collectedCandidates.length
  });
  const validCandidates = collectedCandidates.filter((candidate) => {
    return candidate && typeof candidate === "object";
  });
  const candidates = skipExisting
    ? validCandidates.filter((candidate) => {
      const key = String(candidate.identityKey || "").trim() || buildCandidateIdentityKey(candidate);
      return !key || !knownKeys.has(key);
    })
    : validCandidates;
  let skippedExistingCount = Math.max(0, collectedCandidates.length - candidates.length);

  await sendProgress(controller, {
    phase: "toplaniyor",
    progress: 8,
    current: 0,
    total: maxResults,
    message: `${candidates.length} aday bulundu, kayitlar toplanıyor...`
  });

  const records = precollectedRecords.slice();
  let uniqueRecordCount = records.length;
  let fallbackCount = 0;
  const attemptLimit = Math.min(candidates.length, maxResults + Math.max(10, Math.ceil(maxResults * 0.45)));
  let consecutiveFailures = 0;

  for (let i = 0; i < attemptLimit; i += 1) {
    assertNotCancelled(controller);
    if (uniqueRecordCount >= maxResults) {
      break;
    }

    const candidate = candidates[i];
    if (!candidate || typeof candidate !== "object") {
      consecutiveFailures += 1;
      await sendLog(controller, "warn", "candidate", "Gecersiz aday atlandi.", {
        index: i
      });
      continue;
    }
    let record = null;
    let detailError = null;
    let candidateSkippedByExisting = false;
    let progressRecord = null;
    const candidateStartAt = Date.now();

    const candidateKey = String(candidate.identityKey || "").trim() || buildCandidateIdentityKey(candidate);
    if (skipExisting && candidateKey && knownKeys.has(candidateKey)) {
      candidateSkippedByExisting = true;
      skippedExistingCount += 1;
    }

    if (!candidateSkippedByExisting) {
      let heartbeatTimer = null;
      const candidateProcessingToken = `${runId}:${i}:${Date.now()}`;
      candidate.processingToken = candidateProcessingToken;
      controller.activeCandidateToken = candidateProcessingToken;
      try {
        heartbeatTimer = setInterval(() => {
          sendLogAsync(controller, "info", "candidate", "Aday isleniyor, bekleme suruyor...", {
            index: i,
            name: candidate?.nameHint || "",
            elapsedMs: Date.now() - candidateStartAt
          });
          sendProgress(controller, {
            phase: "toplaniyor",
            current: uniqueRecordCount,
            total: maxResults,
            message: `${i + 1}. aday isleniyor: ${candidate?.nameHint || "Bilinmeyen"}`
          }).catch(() => {});
        }, 5000);

        await runWithTimeout(async () => {
          await runWithTimeout(
            async () => {
              await clickCandidate(candidate, controller, safeMode);
              record = await buildStableResultRecord(candidate, controller, safeMode);
            },
            36000,
            "Aday isleme timeout (36sn)"
          );
        }, 42000, "Aday dis watchdog timeout (42sn)");
      } catch (error) {
        detailError = error && error.message ? error.message : String(error);
        await sendLog(controller, "warn", "candidate", "Adaydan detay okunamadi, fallback devreye alinabilir.", {
          index: i,
          name: candidate?.nameHint || "",
          error: detailError,
          elapsedMs: Date.now() - candidateStartAt
        });
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
        if (controller.activeCandidateToken === candidateProcessingToken) {
          controller.activeCandidateToken = null;
        }
      }
    }

    if (!candidateSkippedByExisting && (!record || !record.name)) {
      record = buildFallbackRecord(candidate);
      fallbackCount += 1;
      await sendLog(controller, "warn", "candidate", "Fallback kaydi olusturuldu.", {
        index: i,
        nameHint: candidate?.nameHint || ""
      });
    }

    if (record && record.name) {
      const recordKey = buildRecordIdentityKey(record);
      if (skipExisting && recordKey && knownKeys.has(recordKey)) {
        skippedExistingCount += 1;
      } else {
        records.push(record);
        progressRecord = record;
        if (recordKey) {
          knownKeys.add(recordKey);
          uniqueRecordCount += 1;
        }
      }
      consecutiveFailures = 0;
      await sendLog(controller, "info", "candidate", "Aday isleme tamamlandi.", {
        index: i,
        name: record.name,
        elapsedMs: Date.now() - candidateStartAt,
        usedFallback: Boolean(detailError)
      });
    } else {
      consecutiveFailures += 1;
    }

    const progress = Math.min(95, 8 + Math.floor(((i + 1) / Math.max(attemptLimit, 1)) * 80));
    await sendProgress(controller, {
      phase: "toplaniyor",
      progress,
      current: uniqueRecordCount,
      total: maxResults,
      message: `${uniqueRecordCount}/${maxResults} kayit toplandi`,
      lastError: detailError,
      record: progressRecord
    });

    if (i < attemptLimit - 1 && uniqueRecordCount < maxResults) {
      const forceReturn = !candidateSkippedByExisting || consecutiveFailures >= 2 || Boolean(detailError);
      if (forceReturn) {
        try {
          await returnToResults(query, controller, safeMode);
        } catch (error) {
          // Listeye donus gecici olarak basarisiz olabilir; sonraki adayda tekrar dener.
        }
      }
    }

    await smartDelay(controller, safeMode, 180, 650);
  }

  if (!hasResultsListPresent(document)) {
    try {
      await returnToResults(query, controller, safeMode);
    } catch (error) {
      // Son adimda listeye donulemese de toplanan veriyi donduruyoruz.
    }
  }

  await sendProgress(controller, {
    phase: "filtreleniyor",
    progress: 97,
    current: uniqueRecordCount,
    total: maxResults,
    message: "Kayitlar tekillestiriliyor..."
  });

  const deduped = dedupeRecords(records).slice(0, maxResults);

  const summary = {
    requested: maxResults,
    candidateCount: candidates.length,
    rawCandidateCount: collectedCandidates.length,
    attemptLimit,
    collectedRaw: records.length,
    fallbackCount,
    skippedExistingCount,
    finalCount: deduped.length,
    strictLocation: false,
    relaxedFilterApplied: false,
    safeMode: settings.safeMode,
    completedAt: new Date().toISOString()
  };

  await sendLog(controller, "info", "run", "Toplama akisi bitti, sonuc background'a gonderiliyor.", summary);

  await sendRuntimeMessage("SCRAPE_DONE", {
    runId,
    results: deduped,
    summary
  });
}

function startScrape(message) {
  const payload = message.payload || {};
  if (!payload.runId || !payload.settings) {
    throw new Error("SCRAPE_START payload gecersiz.");
  }

  if (activeRun && !activeRun.cancelled) {
    if (activeRun.runId === payload.runId) {
      sendLogAsync(activeRun, "warn", "run", "Ayni runId icin tekrar SCRAPE_START alindi, mevcut akisa devam ediliyor.");
      return;
    }
    activeRun.cancelled = true;
  }

  const runController = {
    runId: payload.runId,
    cancelled: false
  };
  activeRun = runController;

  runScrape(payload, runController).catch(async (error) => {
    if (runController.cancelled) {
      await sendRuntimeMessage("SCRAPE_ERROR", {
        runId: payload.runId,
        error: "Toplama durduruldu."
      });
      return;
    }
    await sendRuntimeMessage("SCRAPE_ERROR", {
      runId: payload.runId,
      error: error && error.message ? error.message : String(error)
    });
  });
}

function stopScrape(message) {
  const runId = message?.payload?.runId || null;
  if (activeRun && (!runId || activeRun.runId === runId)) {
    activeRun.cancelled = true;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: "Mesaj tipi eksik." });
      return false;
    }

    if (message.type === "SCRAPE_START") {
      startScrape(message);
      sendResponse({ ok: true, started: true });
      return false;
    }

    if (message.type === "SCRAPE_STOP") {
      stopScrape(message);
      sendResponse({ ok: true, stopped: true });
      return false;
    }

    sendResponse({ ok: false, error: `Desteklenmeyen mesaj tipi: ${message.type}` });
    return false;
  } catch (error) {
    sendResponse({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
    return false;
  }
});

console.log(`[MAPS-EXT-CONTENT] Content script loaded/initialized on URL: ${window.location.href}. ReadyState: ${document.readyState}`);

// Sayfa yenilendiginde (window.location.assign sonrasi) background'a haber ver.
// Background aktif bir toplama varsa scrape'i otomatik devam ettirir.
(async () => {
  try {
    const currentUrl = window.location.href;
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "CONTENT_INITIALIZED", payload: { url: currentUrl } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))
    ]);

    if (response?.shouldResume && response?.payload) {
      console.log(`[MAPS-EXT-CONTENT] Sayfa yenilenmesi sonrasi toplama devam ettiriliyor. RunId: ${response.payload.runId}`);
      startScrape({ payload: response.payload });
    } else {
      console.log(`[MAPS-EXT-CONTENT] Background'dan resume sinyali gelmedi (shouldResume=${response?.shouldResume}), normal bekleme modunda.`);
    }
  } catch (err) {
    // Background hazir degilse veya mesaj atilamazsa normal mod.
    console.log(`[MAPS-EXT-CONTENT] CONTENT_INITIALIZED mesaji gonderilemedi: ${err?.message || err}`);
  }
})();
