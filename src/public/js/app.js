const MAX_FILE_SIZE = 10 * 1024 * 1024;
const state = {
    view: "dashboard",
    imageUrl: "",
    imageObjectUrl: false,
    library: { flyers: [], music: [], videos: [] },
    reel: { flyer: null, music: null },
    scheduled: [
        { id: 1, date: "27 AGO", time: "18:00", caption: "Un vistazo detrás de escena. Preparando algo nuevo para ustedes...", image: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=700&q=80" },
        { id: 2, date: "30 AGO", time: "11:30", caption: "Ideas que se convierten en proyectos. Buen viernes para crear.", image: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=700&q=80" },
        { id: 3, date: "02 SEP", time: "09:00", caption: "Pequeños detalles, grandes diferencias. Muy pronto.", image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=700&q=80" }
    ],
    history: [
        { id: 10, date: "22 AGO 2026", time: "14:30", caption: "Una mirada a lo que estamos construyendo.", status: "published", image: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=140&q=80" },
        { id: 11, date: "27 AGO 2026", time: "18:00", caption: "Un vistazo detrás de escena. Preparando algo nuevo...", status: "scheduled", image: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=140&q=80" },
        { id: 12, date: "21 AGO 2026", time: "10:15", caption: "Contenido pendiente de revisión.", status: "pending", image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=140&q=80" }
    ]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    $("#toast-container").append(toast);
    window.setTimeout(() => toast.remove(), 3600);
}

function navigate(view) {
    state.view = view;
    $$('[data-view-panel]').forEach((panel) => panel.classList.toggle("active", panel.id === `view-${view}`));
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    $("#page-label").textContent = document.querySelector(`[data-view="${view}"]`)?.textContent.trim() || "Dashboard";
    $("#sidebar").classList.remove("open");
    $(".mobile-backdrop").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateStats() {
    $("#stat-scheduled").textContent = state.scheduled.length;
    $("#stat-published").textContent = state.history.filter((item) => item.status === "published").length;
    $("#stat-pending").textContent = state.history.filter((item) => item.status === "pending").length;
}

function renderRecentActivity() {
    const activity = state.history.slice(0, 3);
    $("#recent-activity").innerHTML = activity.length ? activity.map((item) => `<div class="activity-row"><img class="activity-thumb" src="${item.image}" alt=""><div class="activity-copy"><b>${item.caption}</b><small>${item.date} · ${statusLabel(item.status)}</small></div><span class="history-state state-${item.status}">${statusLabel(item.status)}</span></div>`).join("") : '<div class="empty-state">Todavía no hay actividad.</div>';
}

function statusLabel(status) {
    return { published: "Publicada", scheduled: "Programada", pending: "Pendiente", error: "Error" }[status] || status;
}

function renderScheduled() {
    $("#scheduled-list").innerHTML = state.scheduled.length ? state.scheduled.map((item) => `<article class="panel scheduled-card"><img class="scheduled-image" src="${item.image}" alt=""><div class="scheduled-body"><div class="scheduled-date">${item.date} <span>${item.time}</span></div><p>${item.caption}</p><div class="card-actions"><button data-edit-scheduled="${item.id}">Editar</button><button data-delete-scheduled="${item.id}">Eliminar</button><span class="history-state state-scheduled">Programada</span></div></div></article>`).join("") : '<div class="panel empty-state">No hay publicaciones programadas.</div>';
}

function renderHistory() {
    const filter = $("#history-filter").value;
    const items = state.history.filter((item) => filter === "all" || item.status === filter);
    $("#history-list").innerHTML = items.length ? items.map((item) => `<div class="history-row"><div class="history-post"><img class="history-thumb" src="${item.image}" alt=""><div><b>${item.caption}</b><small>Instagram · instaauto</small></div></div><time>${item.date}<br>${item.time}</time><span class="history-state state-${item.status}">${statusLabel(item.status)}</span><span></span></div>`).join("") : '<div class="empty-state">No hay publicaciones con este filtro.</div>';
}

function setImage(file) {
    if (!file || !file.type.startsWith("image/") || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        showToast("No se pudo procesar la imagen", "error");
        return;
    }
    if (file.size > MAX_FILE_SIZE) {
        showToast("La imagen supera el límite de 10 MB", "error");
        return;
    }
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = URL.createObjectURL(file);
    state.imageObjectUrl = true;
    $("#image-preview").src = state.imageUrl;
    $("#post-preview-image").src = state.imageUrl;
    $("#upload-empty").hidden = true;
    $("#upload-filled").hidden = false;
    $("#preview-placeholder").hidden = true;
    $("#post-preview-image").hidden = false;
    showToast("Imagen cargada correctamente");
}

function clearImage() {
    if (state.imageUrl && state.imageObjectUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = "";
    state.imageObjectUrl = false;
    $("#image-input").value = "";
    $("#upload-empty").hidden = false;
    $("#upload-filled").hidden = true;
    $("#preview-placeholder").hidden = false;
    $("#post-preview-image").hidden = true;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[character]));
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date) {
    return new Date(date).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

function renderNavigation() {
    $(".main-nav").innerHTML = '<button class="nav-item active" data-view="dashboard"><span class="nav-icon">▦</span>Dashboard</button><button class="nav-item" data-view="new-post"><span class="nav-icon">＋</span>Nueva publicación</button><button class="nav-item" data-view="reel"><span class="nav-icon">▶</span>Crear Reel</button><button class="nav-item" data-view="scheduled"><span class="nav-icon">◷</span>Calendario</button><button class="nav-item" data-view="library"><span class="nav-icon">▤</span>Biblioteca</button><button class="nav-item" data-view="settings"><span class="nav-icon">⚙</span>Configuración</button>';
}

function createLibraryViews() {
    const views = `<section class="view" id="view-library" data-view-panel><div class="page-heading"><div><span class="eyebrow">ARCHIVOS LOCALES</span><h1>Biblioteca</h1><p>Contenido original disponible en tu espacio de trabajo.</p></div><span class="status-pill">Solo lectura</span></div><div class="library-tabs" role="tablist"><button class="library-tab active" data-library-tab="flyers">Flyers</button><button class="library-tab" data-library-tab="music">Música</button><button class="library-tab" data-library-tab="videos">Videos</button></div><div class="library-panel panel"><div class="library-heading"><div><span class="eyebrow" id="library-eyebrow">FLYERS</span><h2 id="library-title">Flyers originales</h2></div><span class="library-count" id="library-count">0 archivos</span></div><div id="library-content"></div></div></section><section class="view" id="view-reel" data-view-panel><div class="page-heading"><div><span class="eyebrow">FORMATO VERTICAL</span><h1>Crear Reel</h1><p>Prepará los elementos del Reel. El motor de generación estará disponible próximamente.</p></div></div><div class="reel-layout"><section class="panel reel-form"><div class="panel-heading"><div><h2>Configuración</h2><p class="panel-description">Elegí contenido de tu Biblioteca.</p></div><span class="draft-badge">Borrador</span></div><div class="reel-field"><label>Flyer</label><button class="picker-button" data-reel-pick="flyer"><span id="reel-flyer-name">Elegir flyer de Biblioteca</span><b>→</b></button></div><div class="reel-field"><label>Música</label><button class="picker-button" data-reel-pick="music"><span id="reel-music-name">Elegir música de Biblioteca</span><b>→</b></button></div><div class="reel-options"><div class="field"><label for="reel-format">Formato</label><select id="reel-format"><option>1080 × 1920</option></select></div><div class="field"><label for="reel-duration">Duración</label><select id="reel-duration"><option>5 segundos</option><option>8 segundos</option><option>10 segundos</option></select></div><div class="field"><label for="reel-animation">Animación</label><select id="reel-animation"><option>Zoom suave</option><option>Fade</option><option>Movimiento vertical</option></select></div><div class="field"><label for="reel-volume">Volumen <output id="reel-volume-value">80%</output></label><input id="reel-volume" type="range" min="0" max="100" value="80"></div><label class="check-row"><input id="reel-fade-in" type="checkbox"> Fade in</label><label class="check-row"><input id="reel-fade-out" type="checkbox"> Fade out</label></div><button class="button button-primary reel-generate" id="generate-reel">Generar Reel <span>→</span></button></section><aside class="panel reel-preview"><span class="eyebrow">VISTA PREVIA</span><div class="reel-canvas"><img id="reel-flyer-preview" alt="Flyer seleccionado" hidden><span id="reel-placeholder">Seleccioná un flyer para ver la preview</span></div><audio id="reel-audio" controls hidden></audio></aside></div></section>`;
    $(".page-container").insertAdjacentHTML("beforeend", views);
    $("#upload-empty").insertAdjacentHTML("beforeend", '<button class="inline-button library-image-button" id="choose-library-image">Elegir de Biblioteca</button>');
    document.body.insertAdjacentHTML("beforeend", '<div class="media-modal" id="media-modal" hidden><div class="media-modal-inner"><button class="modal-close" id="close-media-modal" aria-label="Cerrar">×</button><img id="modal-image" alt="Vista previa ampliada"></div></div>');
}

function renderFlyers() {
    const files = state.library.flyers;
    $("#library-content").innerHTML = files.length ? `<div class="library-grid">${files.map((file) => `<article class="library-card"><button class="media-preview-button" data-preview-media="${escapeHtml(file.url)}" aria-label="Ver ${escapeHtml(file.name)}"><img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name)}"></button><div class="library-card-body"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span>${file.extension} · ${formatBytes(file.size)}</span><small>${file.dimensions ? `${file.dimensions.width} × ${file.dimensions.height} · ` : ""}${formatDate(file.modifiedAt)}</small><div class="card-actions"><button data-use-post="${escapeHtml(file.url)}" data-file-name="${escapeHtml(file.name)}">Usar para publicación</button><button data-use-reel="${escapeHtml(file.url)}" data-file-name="${escapeHtml(file.name)}">Usar para Reel</button></div></div></article>`).join("")}</div>` : '<div class="empty-state">No hay flyers en data/uploads/flyers/.</div>';
}

function renderMusic() {
    const files = state.library.music;
    $("#library-content").innerHTML = files.length ? `<div class="audio-list">${files.map((file) => `<article class="audio-row"><div class="audio-icon">♪</div><div class="audio-info"><strong>${escapeHtml(file.name)}</strong><span>${file.extension} · ${formatBytes(file.size)} · <span data-duration-for="${escapeHtml(file.url)}">Duración pendiente</span></span><audio controls preload="metadata" src="${escapeHtml(file.url)}" data-library-audio="${escapeHtml(file.url)}"></audio></div><button class="button button-secondary" data-use-reel-audio="${escapeHtml(file.url)}" data-file-name="${escapeHtml(file.name)}">Usar para Reel</button></article>`).join("")}</div>` : '<div class="empty-state">No hay música en data/uploads/music/.</div>';
}

function renderVideos() {
    const files = state.library.videos;
    $("#library-content").innerHTML = files.length ? `<div class="library-grid video-grid">${files.map((file) => `<article class="library-card"><video controls preload="metadata" src="${escapeHtml(file.url)}"></video><div class="library-card-body"><strong>${escapeHtml(file.name)}</strong><span>${file.extension} · ${formatBytes(file.size)}</span><small>${formatDate(file.modifiedAt)}</small></div></article>`).join("")}</div>` : '<div class="empty-state">No hay videos en data/uploads/videos/.</div>';
}

function renderLibrary(category = "flyers") {
    const titles = { flyers: ["FLYERS", "Flyers originales"], music: ["MÚSICA", "Pistas originales"], videos: ["VIDEOS", "Videos originales"] };
    $("#library-eyebrow").textContent = titles[category][0];
    $("#library-title").textContent = titles[category][1];
    $("#library-count").textContent = `${state.library[category].length} archivos`;
    $$("[data-library-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.libraryTab === category));
    ({ flyers: renderFlyers, music: renderMusic, videos: renderVideos }[category])();
}

async function loadLibrary(category = "flyers") {
    try {
        const response = await fetch(`/api/library/${category}`);
        if (!response.ok) throw new Error("library");
        state.library[category] = await response.json();
        renderLibrary(category);
    } catch (error) { $("#library-content").innerHTML = '<div class="empty-state">No se pudo cargar esta biblioteca.</div>'; }
}

function setLibraryImage(url, fileName) {
    if (state.imageUrl && state.imageObjectUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = url;
    state.imageObjectUrl = false;
    $("#image-preview").src = url;
    $("#post-preview-image").src = url;
    $("#upload-empty").hidden = true; $("#upload-filled").hidden = false;
    $("#preview-placeholder").hidden = true; $("#post-preview-image").hidden = false;
    showToast(`${fileName} seleccionado desde la Biblioteca`);
}

function updateReelPreview() {
    const flyer = state.reel.flyer;
    $("#reel-flyer-preview").hidden = !flyer; $("#reel-placeholder").hidden = Boolean(flyer);
    if (flyer) $("#reel-flyer-preview").src = flyer.url;
    $("#reel-audio").hidden = !state.reel.music;
    if (state.reel.music) $("#reel-audio").src = state.reel.music.url;
}

function selectReelFlyer(url, name) { state.reel.flyer = { url, name }; $("#reel-flyer-name").textContent = name; updateReelPreview(); navigate("reel"); }
function selectReelMusic(url, name) { state.reel.music = { url, name }; $("#reel-music-name").textContent = name; updateReelPreview(); navigate("reel"); }

function bindLibraryEvents() {
    $("#choose-library-image").addEventListener("click", () => { navigate("library"); renderLibrary("flyers"); });
    $("#generate-reel").addEventListener("click", () => showToast("Motor de generación próximamente.", "info"));
    $$('[data-reel-pick]').forEach((button) => button.addEventListener("click", () => { navigate("library"); loadLibrary(button.dataset.reelPick === "flyer" ? "flyers" : "music"); }));
    $("#reel-volume").addEventListener("input", (event) => { $("#reel-volume-value").textContent = `${event.target.value}%`; if (state.reel.music) $("#reel-audio").volume = event.target.value / 100; });
    $("[data-library-tab]").parentElement.addEventListener("click", (event) => { const tab = event.target.closest("[data-library-tab]"); if (tab) loadLibrary(tab.dataset.libraryTab); });
    $("#library-content").addEventListener("click", (event) => { const preview = event.target.closest("[data-preview-media]"); const post = event.target.closest("[data-use-post]"); const reel = event.target.closest("[data-use-reel]"); const audio = event.target.closest("[data-use-reel-audio]"); if (preview) { $("#modal-image").src = preview.dataset.previewMedia; $("#media-modal").hidden = false; } if (post) { setLibraryImage(post.dataset.usePost, post.dataset.fileName); navigate("new-post"); } if (reel) selectReelFlyer(reel.dataset.useReel, reel.dataset.fileName); if (audio) selectReelMusic(audio.dataset.useReelAudio, audio.dataset.fileName); });
    $("#close-media-modal").addEventListener("click", () => { $("#media-modal").hidden = true; });
    $("#media-modal").addEventListener("click", (event) => { if (event.target.id === "media-modal") $("#media-modal").hidden = true; });
    $("#library-content").addEventListener("loadedmetadata", (event) => { if (event.target.matches("audio")) { const duration = event.target.duration; const target = document.querySelector(`[data-duration-for="${CSS.escape(event.target.dataset.libraryAudio)}"]`); if (target && Number.isFinite(duration)) target.textContent = `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`; } }, true);
}

function updateCaption() {
    const caption = $("#caption").value;
    $("#caption-count").textContent = `${caption.length} / 2200`;
    $("#preview-caption").textContent = caption || "Tu caption aparecerá acá...";
}

function updatePublishMode() {
    const scheduled = document.querySelector('input[name="publish-mode"]:checked').value === "scheduled";
    $("#schedule-fields").hidden = !scheduled;
    $("#publish-button").innerHTML = scheduled ? "Programar publicación <span>→</span>" : "Publicar ahora <span>→</span>";
}

function publish() {
    const caption = $("#caption").value.trim();
    const scheduled = document.querySelector('input[name="publish-mode"]:checked').value === "scheduled";
    if (scheduled && (!$("#publish-date").value || !$("#publish-time").value)) {
        showToast("Elegí una fecha y hora para programar", "error");
        return;
    }
    const item = { id: Date.now(), caption: caption || "Publicación sin caption", image: state.imageUrl || "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=700&q=80", status: scheduled ? "scheduled" : "pending", date: scheduled ? new Date(`${$("#publish-date").value}T00:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "short" }).toUpperCase() : "AHORA", time: scheduled ? $("#publish-time").value : "" };
    if (scheduled) state.scheduled.unshift(item);
    state.history.unshift(item);
    updateStats(); renderRecentActivity(); renderScheduled(); renderHistory();
    showToast(scheduled ? "Publicación programada correctamente" : "Publicación guardada como pendiente correctamente");
    navigate(scheduled ? "scheduled" : "history");
}

function bindEvents() {
    renderNavigation();
    createLibraryViews();
    $$("[data-view]").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
    $$("[data-navigate]").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.navigate)));
    $$(".connect-action").forEach((item) => item.addEventListener("click", () => showToast("La conexión con Instagram estará disponible próximamente.", "info")));
    $("[data-menu-toggle]").addEventListener("click", () => { $("#sidebar").classList.add("open"); $(".mobile-backdrop").classList.add("open"); });
    $("[data-menu-close]").addEventListener("click", () => navigate(state.view));
    $("#select-image").addEventListener("click", () => $("#image-input").click());
    $("#change-image").addEventListener("click", () => $("#image-input").click());
    $("#remove-image").addEventListener("click", clearImage);
    $("#image-input").addEventListener("change", (event) => setImage(event.target.files[0]));
    $("#caption").addEventListener("input", updateCaption);
    $$('input[name="publish-mode"]').forEach((input) => input.addEventListener("change", updatePublishMode));
    $("#publish-button").addEventListener("click", publish);
    $("#history-filter").addEventListener("change", renderHistory);
    $("#upload-zone").addEventListener("dragover", (event) => { event.preventDefault(); $("#upload-zone").classList.add("dragover"); });
    $("#upload-zone").addEventListener("dragleave", () => $("#upload-zone").classList.remove("dragover"));
    $("#upload-zone").addEventListener("drop", (event) => { event.preventDefault(); $("#upload-zone").classList.remove("dragover"); setImage(event.dataTransfer.files[0]); });
    $("#scheduled-list").addEventListener("click", (event) => { const deleteButton = event.target.closest("[data-delete-scheduled]"); if (deleteButton) { state.scheduled = state.scheduled.filter((item) => item.id !== Number(deleteButton.dataset.deleteScheduled)); renderScheduled(); updateStats(); showToast("Publicación eliminada"); } if (event.target.closest("[data-edit-scheduled]")) { navigate("new-post"); showToast("Podés editar el contenido del borrador", "info"); } });
    bindLibraryEvents();
}

async function loadStatus() {
    try {
        const response = await fetch("/api/status");
        const data = await response.json();
        if (data.instagram === "connected") { $("#sidebar-status").textContent = "Instagram conectado"; }
    } catch (error) { showToast("No se pudo consultar el estado de la aplicación", "error"); }
}

bindEvents();
updateStats();
renderRecentActivity();
renderScheduled();
renderHistory();
loadStatus();
loadLibrary("flyers");
loadLibrary("music");
loadLibrary("videos");
