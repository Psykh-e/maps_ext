const elements = {
  metaText: document.getElementById("metaText"),
  saveArchiveBtn: document.getElementById("saveArchiveBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  groqApiKeyInput: document.getElementById("groqApiKeyInput"),
  groqModelInput: document.getElementById("groqModelInput"),
  saveAiConfigBtn: document.getElementById("saveAiConfigBtn"),
  searchInput: document.getElementById("searchInput"),
  cityInput: document.getElementById("cityInput"),
  districtInput: document.getElementById("districtInput"),
  domainInput: document.getElementById("domainInput"),
  ratingMinInput: document.getElementById("ratingMinInput"),
  ratingMaxInput: document.getElementById("ratingMaxInput"),
  websiteFilter: document.getElementById("websiteFilter"),
  phoneFilter: document.getElementById("phoneFilter"),
  messageFilter: document.getElementById("messageFilter"),
  messagePresenceFilter: document.getElementById("messagePresenceFilter"),
  statusFilter: document.getElementById("statusFilter"),
  savedMessageSearch: document.getElementById("savedMessageSearch"),
  dateFromInput: document.getElementById("dateFromInput"),
  dateToInput: document.getElementById("dateToInput"),
  sortField: document.getElementById("sortField"),
  sortDirection: document.getElementById("sortDirection"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  archiveBody: document.getElementById("archiveBody"),
  errorText: document.getElementById("errorText"),
  composerDrawer: document.getElementById("composerDrawer"),
  closeComposerBtn: document.getElementById("closeComposerBtn"),
  messageTarget: document.getElementById("messageTarget"),
  messageOutput: document.getElementById("messageOutput"),
  copyMessageBtn: document.getElementById("copyMessageBtn"),
  regenerateMessageBtn: document.getElementById("regenerateMessageBtn"),
  sendMessageBtn: document.getElementById("sendMessageBtn")
};

let allRecords = [];
const AI_CONFIG_KEY = "maps_ultra_ai_config_v1";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const generatedMessageByRow = new Map();
let activeComposerRow = null;

function getMessageText() {
  if (!elements.messageOutput) {
    return "";
  }
  return safeText(elements.messageOutput.textContent || "").trim();
}

function setMessageText(text) {
  if (!elements.messageOutput) {
    return;
  }
  elements.messageOutput.textContent = safeText(text);
}

function openComposer() {
  if (!elements.composerDrawer) {
    return;
  }
  elements.composerDrawer.classList.remove("hidden");
}

function closeComposer() {
  if (!elements.composerDrawer) {
    return;
  }
  elements.composerDrawer.classList.add("hidden");
  setActiveComposerRow(null);
}

function safeText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function createLink(url, label) {
  const text = String(url || "").trim();
  if (!text) {
    return document.createTextNode("");
  }
  const anchor = document.createElement("a");
  anchor.href = text;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = label || text;
  return anchor;
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

function formatDate(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return date.toLocaleString("tr-TR");
}

function showError(text) {
  elements.errorText.textContent = safeText(text);
  elements.errorText.classList.remove("hidden");
}

function clearError() {
  elements.errorText.textContent = "";
  elements.errorText.classList.add("hidden");
}

function showMessageTarget(text) {
  elements.messageTarget.textContent = safeText(text) || "Mesaj hedefi secilmedi.";
}

function setActiveComposerRow(row) {
  activeComposerRow = row || null;
  if (elements.regenerateMessageBtn) {
    elements.regenerateMessageBtn.disabled = !activeComposerRow;
  }
  if (elements.sendMessageBtn) {
    elements.sendMessageBtn.disabled = !activeComposerRow;
  }
}

function rowIdentity(row) {
  const parts = [row.placeId, row.cid, row.mapsUrl, row.name, row.phone];
  return parts.map((part) => safeText(part).trim()).filter(Boolean).join("|");
}

function hasWebsite(row) {
  return Boolean(String(row.website || "").trim() || String(row.websiteDomain || "").trim());
}

function hasPhone(row) {
  return Boolean(String(row.phone || "").trim());
}

function isMessageEligible(row) {
  return hasPhone(row);
}

function getMessageStatus(row) {
  return String(row?.messageStatus || "").trim();
}

function getMessageStatusLabel(value) {
  const status = String(value || "").trim();
  if (status === "sent") {
    return "Mesaj Gonderilenler";
  }
  if (status === "followup") {
    return "Takip";
  }
  if (status === "replied") {
    return "Yanitlandi";
  }
  if (status === "meeting") {
    return "Gorusme";
  }
  if (status === "closed") {
    return "Tamamlandi";
  }
  if (status === "draft") {
    return "Taslak";
  }
  return "Bekleyen";
}

function hasSavedMessage(row) {
  return Boolean(String(row?.sentMessage || "").trim());
}

function getSavedMessageText(row) {
  return String(row?.sentMessage || "").trim();
}

function getSavedMessagePreview(row) {
  const text = getSavedMessageText(row);
  if (!text) {
    return "";
  }
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function parseDateBoundary(value, endOfDay) {
  const text = String(value || "").trim();
  if (!text) {
    return Number.NaN;
  }
  const boundary = endOfDay ? `${text}T23:59:59.999` : `${text}T00:00:00.000`;
  const ts = new Date(boundary).getTime();
  return Number.isFinite(ts) ? ts : Number.NaN;
}

function loadAiConfig() {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    elements.groqApiKeyInput.value = safeText(parsed.apiKey);
    elements.groqModelInput.value = safeText(parsed.model || DEFAULT_GROQ_MODEL);
  } catch (error) {
    elements.groqModelInput.value = DEFAULT_GROQ_MODEL;
  }
}

function saveAiConfig() {
  const config = {
    apiKey: String(elements.groqApiKeyInput.value || "").trim(),
    model: String(elements.groqModelInput.value || "").trim() || DEFAULT_GROQ_MODEL
  };
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
  showMessageTarget("AI ayarlari kaydedildi.");
}

function getAiConfig() {
  const apiKey = String(elements.groqApiKeyInput.value || "").trim();
  const model = String(elements.groqModelInput.value || "").trim() || DEFAULT_GROQ_MODEL;
  return { apiKey, model };
}

function buildMessagePrompt(row) {
  const businessName = safeText(row.name) || "isletme";
  const city = safeText(row.city);
  const district = safeText(row.district);
  const address = safeText(row.fullAddress || row.listAddress);
  const website = safeText(row.website || row.websiteDomain);

  // if (hasWebsite(row)) {
  //   return [
  //     "Bu işletmeye CeplyTech adına ilk iletişim mesajı yaz.",
  //     "CeplyTech; yapay zeka, otomasyon, web, mobil ve özel yazılım çözümleri geliştirir.",
  //     "İşletmenin mevcut bir web sitesi var gibi davran. Mesajda web sitesi yapma teklifini ön plana çıkarma.",
  //     "Bunun yerine satış, otomasyon, yapay zeka destekli süreçler, müşteri iletişimi, rezervasyon, takip ve özel yazılım gibi alanlardan doğal şekilde bahset.",
  //     "Etkileyici ve profesyonel olsun.",
  //     "Sadece mesaj metnini döndür.",
  //     "Türkçe yaz.",
  //     "En fazla 2 paragraf olsun",
  //     "Sonunda 10 dakikalık görüşme öner ve son satıra iletişim için websitemiz olan https://ceplytech.com/ ekle.",
  //     "",
  //     `İşletme: ${businessName}`,
  //     `Şehir: ${city}`,
  //     `İlçe: ${district}`,
  //     `Adres: ${address}`,
  //     `İşletme web sitesi: ${website}`
  //   ].join("\n");
  // }

  // return [
  //   "Bu işletmeye CeplyTech adına ilk iletişim mesajı yaz.",
  //   "CeplyTech; yapay zeka, otomasyon, web, mobil ve özel yazılım çözümleri geliştirir.",
  //   "İşletmeye en uygun hizmeti doğal şekilde öner. Öncelikli olarak web sitesi geliştirme fakat diğer hizmetlerimizden de bahset",
  //   "Etkileyici ve profesyonel olsun.",
  //   "Sadece mesaj metnini döndür.",
  //   "Türkçe yaz.",
  //   "En fazla 2 paragraf olsun",
  //   "Sonunda 10 dakikalık görüşme öner ve son satıra iletişim için websitemiz olan https://ceplytech.com/ ekle.",
  //   "",
  //   `İşletme: ${businessName}`,
  //   `Şehir: ${city}`,
  //   `İlçe: ${district}`,
  //   `Adres: ${address}`
  // ].join("\n");
  if (hasWebsite(row)) {
  return [
    "Bu işletmeye CeplyTech adına ilk iletişim mesajı yaz.",
    "CeplyTech; yapay zeka, otomasyon, web, mobil ve özel yazılım çözümleri geliştirir.",
    "İşletmenin mevcut bir web sitesi olduğunu kabul et. Web sitesi yapma veya yenileme teklifini ön plana çıkarma.",
    "İşletmenin adı, konumu ve web sitesini dikkate alarak faaliyet alanını tahmin et.",
    "Bu işletme için en uygun 1 veya en fazla 2 hizmeti seç ve yalnızca bunlara odaklan.",
    "Yapay zeka, otomasyon, CRM, müşteri iletişimi, rezervasyon, teklif süreçleri, operasyon yönetimi, mobil uygulama veya özel yazılım gibi alanlardan gerçekten fayda sağlayacak olanları öner.",
    "İşletmenin yaşayabileceği olası bir problemi doğal şekilde hissettir ve çözümün sağlayacağı faydayı anlat.",
    "Uzun hizmet listeleri yazma.",
    "Reklam dili, klişe ifadeler ve abartılı vaatler kullanma.",
    "\"Umarım iyisinizdir\", \"Biz CeplyTech olarak\", \"Değerli işletmeniz\", \"Yenilikçi çözümler\", \"Dijital dönüşüm\" gibi kalıp ifadeleri kullanma.",
    "Mesaj tamamen doğal ve kişiye özel yazılmış hissi vermeli. Yapay zeka tarafından üretildiği anlaşılmamalı.",
    "Amaç satış yapmak değil, işletmenin ilgisini çekip cevap almaktır.",
    "Sadece mesaj metnini döndür.",
    "Türkçe yaz.",
    "En fazla 2 paragraf olsun.",
    "Son paragrafta baskı kurmadan, uygun görmeleri halinde 10 dakikalık kısa bir görüşme veya mesajlaşma ile fikir alışverişi yapmayı teklif et.",
    "Son satıra yalnızca iletişim için https://ceplytech.com/ ekle.",
    "",
    `İşletme: ${businessName}`,
    `Şehir: ${city}`,
    `İlçe: ${district}`,
    `Adres: ${address}`,
    `İşletme web sitesi: ${website}`
  ].join("\n");
}

return [
  "Bu işletmeye CeplyTech adına ilk iletişim mesajı yaz.",
  "CeplyTech; yapay zeka, otomasyon, web, mobil ve özel yazılım çözümleri geliştirir.",
  "İşletmenin mevcut bir web sitesi olmadığını varsay.",
  "Öncelikli önerin profesyonel bir web sitesi oluşturmak olsun ancak yalnızca web sitesinden bahsetme.",
  "Web sitesinin yanında işletmeye değer katabilecek en uygun 1 veya en fazla 2 hizmeti de doğal şekilde öner.",
  "İşletmenin adı ve konumunu dikkate alarak faaliyet alanını tahmin et.",
  "Web sitesinin işletmeye sağlayacağı güven, görünürlük ve müşteri kazanımı gibi faydaları doğal şekilde vurgula.",
  "Ardından yapay zeka, otomasyon, müşteri iletişimi, rezervasyon, teklif süreçleri, mobil uygulama veya özel yazılım gibi hizmetlerden işletmeye gerçekten uygun olanları ilişkilendir.",
  "Uzun hizmet listeleri yazma.",
  "Reklam dili, klişe ifadeler ve abartılı vaatler kullanma.",
  "\"Umarım iyisinizdir\", \"Biz CeplyTech olarak\", \"Değerli işletmeniz\", \"Yenilikçi çözümler\", \"Dijital dönüşüm\" gibi kalıp ifadeleri kullanma.",
  "Mesaj tamamen doğal ve kişiye özel yazılmış hissi vermeli. Yapay zeka tarafından üretildiği anlaşılmamalı.",
  "Amaç satış yapmak değil, işletmenin ilgisini çekip cevap almaktır.",
  "Sadece mesaj metnini döndür.",
  "Türkçe yaz.",
  "En fazla 2 paragraf olsun.",
  "Son paragrafta baskı kurmadan, uygun görmeleri halinde 10 dakikalık kısa bir görüşme veya mesajlaşma ile fikir alışverişi yapmayı teklif et.",
  "Son satıra yalnızca iletişim için https://ceplytech.com/ ekle.",
  "",
  `İşletme: ${businessName}`,
  `Şehir: ${city}`,
  `İlçe: ${district}`,
  `Adres: ${address}`
].join("\n");
}

async function generateMessageWithGroq(row) {
  const { apiKey, model } = getAiConfig();
  if (!apiKey) {
    throw new Error("Once Groq API key gir.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content:
            "Sen CeplyTech'in B2B satis temsilcisisin. Kisa, dogal ve profesyonel ilk temas mesajlari yazarsin. Amacin satis yapmak degil, merak uyandirip cevap almaktir. Isletmeye en uygun hizmeti (web, yapay zeka, otomasyon, mobil, ozel yazilim veya siber guvenlik) kendin sec. Reklam dili ve kliseler kullanma."
        },
        {
          role: "user",
          content: buildMessagePrompt(row)
        }
      ]
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Groq hatasi: ${response.status} ${raw.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = safeText(data?.choices?.[0]?.message?.content).trim();
  if (!content) {
    throw new Error("Groq bos mesaj dondurdu.");
  }
  return content;
}

async function updateArchiveRecord(row, updates) {
  const response = await sendMessage({
    type: "UPDATE_ARCHIVE_RECORD",
    payload: { row, updates }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Kayit guncellenemedi.");
  }
  return response.record;
}

async function handleGenerateMessage(row, button) {
  const key = rowIdentity(row);
  setActiveComposerRow(row);
  showMessageTarget(`Mesaj hedefi: ${safeText(row.name)} | ${safeText(row.phone)}`);
  setMessageText("");
  openComposer();
  clearError();

  const hadText = button.textContent;
  button.disabled = true;
  button.textContent = "Uretiliyor...";

  try {
    const message = await generateMessageWithGroq(row);
    generatedMessageByRow.set(key, message);
    setMessageText(message);
    renderArchiveTable();
  } catch (error) {
    showError(error && error.message ? error.message : String(error));
  } finally {
    button.disabled = false;
    button.textContent = hadText;
  }
}

async function regenerateActiveMessage() {
  if (!activeComposerRow) {
    showError("Tekrar uretmek icin aktif bir hedef sec.");
    return;
  }
  const tempButton = elements.regenerateMessageBtn || document.createElement("button");
  await handleGenerateMessage(activeComposerRow, tempButton);
}

function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("00")) {
    return digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return `90${digits.slice(1)}`;
  }
  if (digits.startsWith("90")) {
    return digits;
  }
  return digits;
}

function sendActiveMessageToWhatsApp() {
  if (!activeComposerRow) {
    showError("Gonderilecek aktif bir hedef sec.");
    return;
  }

  const message = getMessageText();
  if (!message) {
    showError("Gonderilecek mesaj yok.");
    return;
  }

  const phone = normalizePhoneForWhatsApp(activeComposerRow.phone);
  if (!phone) {
    showError("WhatsApp icin gecerli telefon numarasi bulunamadi.");
    return;
  }

  const encodedMessage = encodeURIComponent(message);
  const deepLink = `whatsapp://send?phone=${phone}&text=${encodedMessage}`;
  const webLink = `https://wa.me/${phone}?text=${encodedMessage}`;

  updateArchiveRecord(activeComposerRow, {
    messageStatus: "sent",
    sentMessage: message,
    messageSentAt: new Date().toISOString()
  })
    .then((updatedRecord) => {
      if (updatedRecord && typeof updatedRecord === "object") {
        Object.assign(activeComposerRow, updatedRecord);
      }
      renderArchiveTable();
    })
    .catch((error) => {
      showError(error && error.message ? error.message : String(error));
    });

  window.location.href = deepLink;
  setTimeout(() => {
    window.open(webLink, "_blank", "noopener,noreferrer");
  }, 250);
}

function normalizeText(value) {
  return safeText(value).toLocaleLowerCase("tr-TR");
}

function toNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return Number.NaN;
  }
  const num = Number(text.replace(",", "."));
  return Number.isFinite(num) ? num : Number.NaN;
}

function getSortableValue(row, field) {
  if (field === "rating") {
    const num = toNumber(row[field]);
    return Number.isFinite(num) ? num : -1;
  }
  if (field === "fetchedAt") {
    const ts = new Date(row.fetchedAt || "").getTime();
    return Number.isFinite(ts) ? ts : 0;
  }
  return normalizeText(row[field]);
}

function getFilteredAndSortedRows(records) {
  const searchText = normalizeText(elements.searchInput.value).trim();
  const cityText = normalizeText(elements.cityInput.value).trim();
  const districtText = normalizeText(elements.districtInput.value).trim();
  const domainText = normalizeText(elements.domainInput.value).trim();
  const ratingMin = toNumber(elements.ratingMinInput.value);
  const ratingMax = toNumber(elements.ratingMaxInput.value);
  const websiteFilter = elements.websiteFilter.value || "all";
  const phoneFilter = elements.phoneFilter.value || "all";
  const messageFilter = elements.messageFilter.value || "all";
  const messagePresenceFilter = elements.messagePresenceFilter.value || "all";
  const statusFilter = elements.statusFilter.value || "all";
  const savedMessageText = normalizeText(elements.savedMessageSearch.value).trim();
  const dateFromTs = parseDateBoundary(elements.dateFromInput.value, false);
  const dateToTs = parseDateBoundary(elements.dateToInput.value, true);
  const sortField = elements.sortField.value || "fetchedAt";
  const sortDirection = elements.sortDirection.value === "asc" ? "asc" : "desc";
  const direction = sortDirection === "asc" ? 1 : -1;

  const filtered = (Array.isArray(records) ? records : []).filter((row) => {
    const cityValue = normalizeText(row.city);
    if (cityText && !cityValue.includes(cityText)) {
      return false;
    }
    const districtValue = normalizeText(row.district);
    if (districtText && !districtValue.includes(districtText)) {
      return false;
    }
    const domainValue = normalizeText(row.websiteDomain);
    if (domainText && !domainValue.includes(domainText)) {
      return false;
    }

    const rowHasWebsite = hasWebsite(row);
    if (websiteFilter === "with" && !rowHasWebsite) {
      return false;
    }
    if (websiteFilter === "without" && rowHasWebsite) {
      return false;
    }

    const rowHasPhone = hasPhone(row);
    if (phoneFilter === "with" && !rowHasPhone) {
      return false;
    }
    if (phoneFilter === "without" && rowHasPhone) {
      return false;
    }

    const rowIsEligible = isMessageEligible(row);
    const rowKey = rowIdentity(row);
    const rowHasGeneratedMessage = generatedMessageByRow.has(rowKey);
    if (messageFilter === "eligible" && !rowIsEligible) {
      return false;
    }
    if (messageFilter === "generated" && !rowHasGeneratedMessage) {
      return false;
    }

    const rowHasSavedMessage = hasSavedMessage(row);
    if (messagePresenceFilter === "with" && !rowHasSavedMessage) {
      return false;
    }
    if (messagePresenceFilter === "without" && rowHasSavedMessage) {
      return false;
    }

    const rowStatus = getMessageStatus(row);
    if (statusFilter === "none" && rowStatus) {
      return false;
    }
    if (statusFilter !== "all" && statusFilter !== "none" && rowStatus !== statusFilter) {
      return false;
    }

    if (savedMessageText) {
      const savedMessageHaystack = normalizeText(row.sentMessage);
      if (!savedMessageHaystack.includes(savedMessageText)) {
        return false;
      }
    }

    const rowRating = toNumber(row.rating);
    if (Number.isFinite(ratingMin)) {
      if (!Number.isFinite(rowRating) || rowRating < ratingMin) {
        return false;
      }
    }
    if (Number.isFinite(ratingMax)) {
      if (!Number.isFinite(rowRating) || rowRating > ratingMax) {
        return false;
      }
    }

    const rowDateTs = new Date(row.fetchedAt || "").getTime();
    if (Number.isFinite(dateFromTs)) {
      if (!Number.isFinite(rowDateTs) || rowDateTs < dateFromTs) {
        return false;
      }
    }
    if (Number.isFinite(dateToTs)) {
      if (!Number.isFinite(rowDateTs) || rowDateTs > dateToTs) {
        return false;
      }
    }

    if (!searchText) {
      return true;
    }
    const haystack = [
      row.name,
      row.phone,
      row.website,
      row.websiteDomain,
      row.fullAddress,
      row.listAddress,
      row.district,
      row.city
    ]
      .map(normalizeText)
      .join(" ");
    return haystack.includes(searchText);
  });

  filtered.sort((a, b) => {
    const left = getSortableValue(a, sortField);
    const right = getSortableValue(b, sortField);
    if (left < right) {
      return -1 * direction;
    }
    if (left > right) {
      return 1 * direction;
    }
    const aDate = new Date(a.fetchedAt || "").getTime() || 0;
    const bDate = new Date(b.fetchedAt || "").getTime() || 0;
    return (bDate - aDate) * direction;
  });

  return filtered;
}

function renderRows(rows) {
  elements.archiveBody.innerHTML = "";
  const data = Array.isArray(rows) ? rows : [];
  if (data.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = 12;
    td.dataset.label = "Durum";
    td.textContent = "Arsiv bos.";
    tr.appendChild(td);
    elements.archiveBody.appendChild(tr);
    return;
  }

  for (const row of data) {
    const tr = document.createElement("tr");
    const rowKey = rowIdentity(row);

    appendCell(tr, "Isletme", row.name);
    appendCell(tr, "Telefon", row.phone);

    const webTd = document.createElement("td");
    webTd.dataset.label = "Web";
    webTd.className = "link-cell";
    webTd.appendChild(createLink(row.website, row.website));
    tr.appendChild(webTd);

    appendCell(tr, "Domain", row.websiteDomain);
    appendCell(tr, "Adres", row.fullAddress || row.listAddress);
    appendCell(tr, "Ilce", row.district);
    appendCell(tr, "Sehir", row.city);
    appendCell(tr, "Puan", row.rating);

    const mapsTd = document.createElement("td");
    mapsTd.dataset.label = "Maps";
    mapsTd.className = "link-cell";
    mapsTd.appendChild(createLink(row.mapsUrl, row.mapsUrl ? "Harita" : ""));
    tr.appendChild(mapsTd);

    appendCell(tr, "Tarih", formatDate(row.fetchedAt));

    const statusTd = document.createElement("td");
    statusTd.dataset.label = "Durum";
    statusTd.className = "status-cell";
    const statusSelect = document.createElement("select");
    statusSelect.className = "status-select";
    const statusValue = getMessageStatus(row) || "";
    statusSelect.title = getMessageStatusLabel(statusValue);
    const statusOptions = [
      { value: "", label: "Bekleyen" },
      { value: "sent", label: "Mesaj Gonderilenler" },
      { value: "followup", label: "Takip" },
      { value: "replied", label: "Yanitlandi" },
      { value: "meeting", label: "Gorusme" },
      { value: "closed", label: "Tamamlandi" },
      { value: "draft", label: "Taslak" }
    ];
    for (const option of statusOptions) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === statusValue) {
        opt.selected = true;
      }
      statusSelect.appendChild(opt);
    }
    statusSelect.addEventListener("change", async () => {
      statusSelect.disabled = true;
      try {
        const updated = await updateArchiveRecord(row, { messageStatus: statusSelect.value });
        Object.assign(row, updated || {}, { messageStatus: statusSelect.value });
        statusSelect.title = getMessageStatusLabel(statusSelect.value);
        if (activeComposerRow && rowIdentity(activeComposerRow) === rowKey) {
          activeComposerRow = { ...activeComposerRow, ...updated };
        }
        renderArchiveTable();
      } catch (error) {
        showError(error && error.message ? error.message : String(error));
        statusSelect.value = getMessageStatus(row) || "";
      } finally {
        statusSelect.disabled = false;
      }
    });
    statusTd.appendChild(statusSelect);
    const statusLabel = document.createElement("div");
    statusLabel.className = "status-label";
    statusLabel.textContent = getMessageStatusLabel(statusValue);
    statusTd.appendChild(statusLabel);
    if (row.messageSentAt) {
      const sentAt = document.createElement("div");
      sentAt.className = "status-meta";
      sentAt.textContent = `Gonderim: ${formatDate(row.messageSentAt)}`;
      statusTd.appendChild(sentAt);
    }
    if (hasSavedMessage(row)) {
      const saved = document.createElement("div");
      saved.className = "saved-message";
      saved.textContent = getSavedMessagePreview(row);
      statusTd.appendChild(saved);
    }
    tr.appendChild(statusTd);

    const actionTd = document.createElement("td");
    actionTd.dataset.label = "Mesaj";
    actionTd.className = "action-cell";
    const messageBtn = document.createElement("button");
    const hasMessage = generatedMessageByRow.has(rowKey);
    messageBtn.type = "button";
    messageBtn.textContent = hasMessage ? "Mesaji Goster" : "Mesaj Uret";
    if (!String(row.phone || "").trim()) {
      messageBtn.disabled = true;
      messageBtn.textContent = "Telefon Yok";
    }
    messageBtn.addEventListener("click", async () => {
      const cached = generatedMessageByRow.get(rowKey);
      showMessageTarget(`Mesaj hedefi: ${safeText(row.name)} | ${safeText(row.phone)}`);
      setActiveComposerRow(row);
      openComposer();
      if (cached) {
        setMessageText(cached);
        return;
      }
      await handleGenerateMessage(row, messageBtn);
    });
    actionTd.appendChild(messageBtn);
    tr.appendChild(actionTd);

    elements.archiveBody.appendChild(tr);
  }
}

function renderArchiveTable() {
  const rows = getFilteredAndSortedRows(allRecords);
  renderRows(rows);
  elements.metaText.textContent = `${rows.length}/${allRecords.length} kayit gosteriliyor | ${elements.metaText.dataset.baseMeta || ""}`.trim();
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

async function saveArchiveJson() {
  if (elements.saveArchiveBtn) {
    elements.saveArchiveBtn.disabled = true;
  }
  elements.metaText.textContent = "Arsiv JSON olarak kaydediliyor...";
  clearError();
  const response = await sendMessage({ type: "SAVE_ARCHIVE_JSON" });
  if (!response?.ok) {
    showError(response?.error || "Arsiv kaydedilemedi.");
    elements.metaText.textContent = "Arsiv kaydedilemedi.";
    return;
  }

  const savedFile = safeText(response.savedFile);
  const count = Number.isFinite(response.count) ? response.count : allRecords.length;
  elements.metaText.dataset.baseMeta = `Kaynak: IndexedDB | JSON yedegi: ${savedFile || elements.metaText.dataset.baseMeta || ""}`;
  elements.metaText.textContent = `${count} kayit kaydedildi | ${elements.metaText.dataset.baseMeta}`;
  showMessageTarget(savedFile ? `Arsiv kaydedildi: ${savedFile}` : "Arsiv kaydedildi.");
}

async function loadArchive() {
  elements.metaText.textContent = "IndexedDB arsivi okunuyor...";
  clearError();
  const response = await sendMessage({ type: "GET_ARCHIVE_VIEW_DATA" });
  if (!response?.ok) {
    showError(response?.error || "Arsiv verisi alinamadi.");
    elements.metaText.textContent = "Arsiv okunamadi.";
    renderRows([]);
    return;
  }

  const records = Array.isArray(response.records) ? response.records : [];
  allRecords = records;
  const filePath = safeText(response.archiveFilePath);
  const count = Number.isFinite(response.count) ? response.count : records.length;
  const updatedAt = formatDate(response.updatedAt);
  elements.metaText.dataset.baseMeta = `Kaynak: IndexedDB | JSON yedegi: ${filePath}${updatedAt ? ` | Guncelleme: ${updatedAt}` : ""}`;
  elements.metaText.textContent = `${count} kayit | ${elements.metaText.dataset.baseMeta}`;
  renderArchiveTable();
}

elements.reloadBtn.addEventListener("click", loadArchive);
if (elements.saveArchiveBtn) {
  elements.saveArchiveBtn.addEventListener("click", async () => {
    try {
      await saveArchiveJson();
    } finally {
      if (elements.saveArchiveBtn) {
        elements.saveArchiveBtn.disabled = false;
      }
    }
  });
}
elements.saveAiConfigBtn.addEventListener("click", saveAiConfig);
elements.searchInput.addEventListener("input", renderArchiveTable);
elements.cityInput.addEventListener("input", renderArchiveTable);
elements.districtInput.addEventListener("input", renderArchiveTable);
elements.domainInput.addEventListener("input", renderArchiveTable);
elements.ratingMinInput.addEventListener("input", renderArchiveTable);
elements.ratingMaxInput.addEventListener("input", renderArchiveTable);
elements.websiteFilter.addEventListener("change", renderArchiveTable);
elements.phoneFilter.addEventListener("change", renderArchiveTable);
elements.messageFilter.addEventListener("change", renderArchiveTable);
elements.messagePresenceFilter.addEventListener("change", renderArchiveTable);
elements.statusFilter.addEventListener("change", renderArchiveTable);
elements.savedMessageSearch.addEventListener("input", renderArchiveTable);
elements.dateFromInput.addEventListener("change", renderArchiveTable);
elements.dateToInput.addEventListener("change", renderArchiveTable);
elements.sortField.addEventListener("change", renderArchiveTable);
elements.sortDirection.addEventListener("change", renderArchiveTable);
elements.copyMessageBtn.addEventListener("click", async () => {
  const text = getMessageText();
  if (!text) {
    showError("Kopyalanacak mesaj yok.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    clearError();
    showMessageTarget("Mesaj panoya kopyalandi.");
  } catch (error) {
    showError("Mesaj kopyalanamadi.");
  }
});
if (elements.regenerateMessageBtn) {
  elements.regenerateMessageBtn.addEventListener("click", regenerateActiveMessage);
}
if (elements.sendMessageBtn) {
  elements.sendMessageBtn.addEventListener("click", sendActiveMessageToWhatsApp);
}
if (elements.closeComposerBtn) {
  elements.closeComposerBtn.addEventListener("click", closeComposer);
}
elements.clearFiltersBtn.addEventListener("click", () => {
  elements.searchInput.value = "";
  elements.cityInput.value = "";
  elements.districtInput.value = "";
  elements.domainInput.value = "";
  elements.ratingMinInput.value = "";
  elements.ratingMaxInput.value = "";
  elements.websiteFilter.value = "all";
  elements.phoneFilter.value = "all";
  elements.messageFilter.value = "all";
  elements.messagePresenceFilter.value = "all";
  elements.statusFilter.value = "all";
  elements.savedMessageSearch.value = "";
  elements.dateFromInput.value = "";
  elements.dateToInput.value = "";
  elements.sortField.value = "fetchedAt";
  elements.sortDirection.value = "desc";
  renderArchiveTable();
});

loadAiConfig();
if (!elements.groqModelInput.value) {
  elements.groqModelInput.value = DEFAULT_GROQ_MODEL;
}
setActiveComposerRow(null);
setMessageText("");
loadArchive();
