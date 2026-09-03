const MAX_FILE_SIZE = 10 * 1024 * 1024;
const state = {
    view: "dashboard",
    imageUrl: "",
    imageObjectUrl: false,
    imageMedia: null,
    library: { flyers: [], music: [], videos: [], reels: [] },
    reel: { flyer: null, music: null },
    posts: [],
    history: [],
    editingPostId: null,
    libraryCategory: "flyers"
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
    $("#stat-scheduled").textContent = state.posts.filter((item) => item.status === "scheduled").length;
    $("#stat-published").textContent = state.posts.filter((item) => item.status === "published").length;
    $("#stat-pending").textContent = state.posts.filter((item) => item.status === "pending").length;
    $("#stat-ready").textContent = state.posts.filter((item) => item.status === "ready").length;
    $("#stat-failed").textContent = state.posts.filter((item) => item.status === "failed").length;
    $("#stat-reels").textContent = state.library.reels.length;
}

function postImage(post) {
    if (!post?.media) return "";
    if (post.media.category === "reels") return `/media/generated/reels/${encodeURIComponent(post.media.filename)}`;
    return `/media/${post.media.category}/${encodeURIComponent(post.media.filename)}`;
}

function renderRecentActivity() {
    const activity = state.history.filter((entry) => entry.post).slice(0, 3);
    $("#recent-activity").innerHTML = activity.length ? activity.map((entry) => { const post = entry.post; return `<div class="activity-row"><img class="activity-thumb" src="${escapeHtml(postImage(post))}" alt=""><div class="activity-copy"><b>${escapeHtml(post.caption)}</b><small>${formatDate(entry.createdAt)} · ${entry.action}</small></div><span class="history-state state-${escapeHtml(post.status)}">${statusLabel(post.status)}</span></div>`; }).join("") : '<div class="empty-state">Todavía no hay actividad.</div>';
}

function statusLabel(status) {
    return { published: "Publicada", scheduled: "Programada", ready: "Lista para publicar", pending: "Pendiente", failed: "Fallida", error: "Error" }[status] || status;
}

function renderScheduled() {
    const scheduled = state.posts.filter((item) => item.status === "scheduled");
    $("#scheduled-list").innerHTML = scheduled.length ? scheduled.map((item) => { const date = new Date(item.scheduledAt); return `<article class="panel scheduled-card"><img class="scheduled-image" src="${escapeHtml(postImage(item))}" alt=""><div class="scheduled-body"><div class="scheduled-date">${escapeHtml(date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" }).toUpperCase())} <span>${escapeHtml(date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }))}</span></div><p>${escapeHtml(item.caption)}</p><div class="card-actions"><button data-edit-scheduled="${escapeHtml(item.id)}">Editar</button><button data-delete-scheduled="${escapeHtml(item.id)}">Eliminar</button><span class="history-state state-scheduled">Programada</span></div></div></article>`; }).join("") : '<div class="panel empty-state">No hay publicaciones programadas.</div>';
}

function renderHistory() {
    const filter = $("#history-filter").value;
    const items = state.history.filter((entry) => entry.post && (filter === "all" || entry.post.status === filter));
    $("#history-list").innerHTML = items.length ? items.map((entry) => { const post = entry.post; const date = new Date(entry.createdAt); return `<div class="history-row"><div class="history-post"><img class="history-thumb" src="${escapeHtml(postImage(post))}" alt=""><div><b>${escapeHtml(post.caption)}</b><small>${escapeHtml(entry.action)}</small></div></div><time>${escapeHtml(date.toLocaleDateString("es-AR"))}<br>${escapeHtml(date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }))}</time><span class="history-state state-${escapeHtml(post.status)}">${statusLabel(post.status)}</span><span></span></div>`; }).join("") : '<div class="empty-state">No hay publicaciones con este filtro.</div>';
}

async function setImage(file) {
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
    state.imageMedia = null;
    $("#image-preview").src = state.imageUrl;
    $("#post-preview-image").src = state.imageUrl;
    $("#upload-empty").hidden = true;
    $("#upload-filled").hidden = false;
    $("#preview-placeholder").hidden = true;
    $("#post-preview-image").hidden = false;
    try {
        const formData = new FormData();
        formData.append("category", "flyers");
        formData.append("file", file);
        const response = await fetch("/api/uploads", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo subir la imagen");
        if (state.imageUrl && state.imageObjectUrl) URL.revokeObjectURL(state.imageUrl);
        state.imageUrl = data.url;
        state.imageObjectUrl = false;
        state.imageMedia = { filename: data.name, category: data.category };
        $("#image-preview").src = data.url;
        $("#post-preview-image").src = data.url;
        showToast("Imagen cargada correctamente");
    } catch (error) {
        state.imageMedia = null;
        showToast(error.message, "error");
    }
}

function clearImage() {
    if (state.imageUrl && state.imageObjectUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = "";
    state.imageObjectUrl = false;
    state.imageMedia = null;
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

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "Duración no disponible";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function renderNavigation() {
    $(".main-nav").innerHTML = '<button class="nav-item active" data-view="dashboard"><span class="nav-icon">▦</span>Dashboard</button><button class="nav-item" data-view="new-post"><span class="nav-icon">＋</span>Nueva publicación</button><button class="nav-item" data-view="reel"><span class="nav-icon">▶</span>Crear Reel</button><button class="nav-item" data-view="scheduled"><span class="nav-icon">◷</span>Calendario</button><button class="nav-item" data-view="history"><span class="nav-icon">↺</span>Historial</button><button class="nav-item" data-view="library"><span class="nav-icon">▤</span>Biblioteca</button><button class="nav-item" data-view="settings"><span class="nav-icon">⚙</span>Configuración</button>';
}

function createLibraryViews() {
    const views = `<section class="view" id="view-library" data-view-panel><div class="page-heading"><div><span class="eyebrow">ARCHIVOS LOCALES</span><h1>Biblioteca</h1><p>Contenido original disponible en tu espacio de trabajo.</p></div><span class="status-pill">Solo lectura</span></div><div class="library-tabs" role="tablist"><button class="library-tab active" data-library-tab="flyers">Flyers</button><button class="library-tab" data-library-tab="music">Música</button><button class="library-tab" data-library-tab="videos">Videos</button><button class="library-tab" data-library-tab="reels">Reels</button></div><div class="library-panel panel"><div class="library-heading"><div><span class="eyebrow" id="library-eyebrow">FLYERS</span><h2 id="library-title">Flyers originales</h2></div><div><button class="button button-secondary" id="upload-library">Subir archivo</button><input type="file" id="library-upload-input" hidden><span class="library-count" id="library-count">0 archivos</span></div></div><div id="library-content"></div></div></section><section class="view" id="view-reel" data-view-panel><div class="page-heading"><div><span class="eyebrow">FORMATO VERTICAL</span><h1>Crear Reel</h1><p>Generá un MP4 vertical a partir de un flyer y una pista de tu Biblioteca.</p></div></div><div class="reel-layout"><section class="panel reel-form"><div class="panel-heading"><div><h2>Configuración</h2><p class="panel-description">Elegí contenido de tu Biblioteca.</p></div><span class="draft-badge">Borrador</span></div><div class="reel-field"><label>Flyer</label><button class="picker-button" data-reel-pick="flyer"><span id="reel-flyer-name">Elegir flyer de Biblioteca</span><b>→</b></button></div><div class="reel-field"><label>Música</label><button class="picker-button" data-reel-pick="music"><span id="reel-music-name">Elegir música de Biblioteca</span><b>→</b></button></div><div class="reel-options"><div class="field"><label for="reel-format">Formato</label><select id="reel-format"><option>1080 × 1920</option></select></div><div class="field"><label for="reel-duration">Duración</label><select id="reel-duration"><option value="5">5 segundos</option><option value="8">8 segundos</option><option value="10">10 segundos</option></select></div><div class="field"><label for="reel-animation">Animación</label><select id="reel-animation"><option>Zoom suave</option><option>Fade</option><option>Movimiento vertical</option></select></div><div class="field"><label for="reel-volume">Volumen <output id="reel-volume-value">80%</output></label><input id="reel-volume" type="range" min="0" max="100" value="80"></div><label class="check-row"><input id="reel-fade-in" type="checkbox"> Fade in</label><label class="check-row"><input id="reel-fade-out" type="checkbox"> Fade out</label></div><button class="button button-primary reel-generate" id="generate-reel">Generar Reel <span>→</span></button><div class="reel-result" id="reel-result" hidden><div class="result-status">Reel generado correctamente</div><video id="generated-reel-video" controls playsinline></video><dl><div><dt>Nombre</dt><dd id="generated-reel-name"></dd></div><div><dt>Duración</dt><dd id="generated-reel-duration"></dd></div><div><dt>Resolución</dt><dd>1080 × 1920</dd></div><div><dt>Tamaño</dt><dd id="generated-reel-size"></dd></div></dl><button class="button button-secondary" id="generate-another">Generar otro</button></div></section><aside class="panel reel-preview"><span class="eyebrow">VISTA PREVIA</span><div class="reel-canvas"><img id="reel-flyer-preview" alt="Flyer seleccionado" hidden><span id="reel-placeholder">Seleccioná un flyer para ver la preview</span></div><audio id="reel-audio" controls hidden></audio></aside></div></section>`;
    $(".page-container").insertAdjacentHTML("beforeend", views);
    $("#upload-empty").insertAdjacentHTML("beforeend", '<button class="inline-button library-image-button" id="choose-library-image">Elegir de Biblioteca</button>');
    document.body.insertAdjacentHTML("beforeend", '<div class="media-modal" id="media-modal" hidden><div class="media-modal-inner"><button class="modal-close" id="close-media-modal" aria-label="Cerrar">×</button><img id="modal-image" alt="Vista previa ampliada"></div></div>');
}

function renderFlyers() {
    const files = state.library.flyers;
    $("#library-content").innerHTML = files.length ? `<div class="library-grid">${files.map((file) => `<article class="library-card"><button class="media-preview-button" data-preview-media="${escapeHtml(file.url)}" aria-label="Ver ${escapeHtml(file.name)}"><img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name)}"></button><div class="library-card-body"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span>${file.extension} · ${formatBytes(file.size)}</span><small>${file.dimensions ? `${file.dimensions.width} × ${file.dimensions.height} · ` : ""}${formatDate(file.modifiedAt)}</small><div class="card-actions"><button data-use-post="${escapeHtml(file.url)}" data-file-name="${escapeHtml(file.name)}">Usar para publicación</button><button data-use-reel="${escapeHtml(file.url)}" data-file-name="${escapeHtml(file.name)}">Usar para Reel</button><button data-delete-media="${escapeHtml(file.name)}">Eliminar</button></div></div></article>`).join("")}</div>` : '<div class="empty-state">No hay flyers en data/uploads/flyers/.</div>';
}

function renderMusic() {
    const files = state.library.music;
    $("#library-content").innerHTML = files.length ? `<div class="audio-list">${files.map((file) => `<article class="audio-row"><div class="audio-icon">♪</div><div class="audio-info"><strong>${escapeHtml(file.name)}</strong><span>${file.extension} · ${formatBytes(file.size)} · <span data-duration-for="${escapeHtml(file.url)}">Duración pendiente</span></span><audio controls preload="metadata" src="${escapeHtml(file.url)}" data-library-audio="${escapeHtml(file.url)}"></audio></div><button class="button button-secondary" data-use-reel-audio="${escapeHtml(file.url)}" data-file-name="${escapeHtml(file.name)}">Usar para Reel</button></article>`).join("")}</div>` : '<div class="empty-state">No hay música en data/uploads/music/.</div>';
}

function renderVideos() {
    const files = state.library.videos;
    $("#library-content").innerHTML = files.length ? `<div class="library-grid video-grid">${files.map((file) => `<article class="library-card"><video controls preload="metadata" src="${escapeHtml(file.url)}"></video><div class="library-card-body"><strong>${escapeHtml(file.name)}</strong><span>${file.extension} · ${formatBytes(file.size)}</span><small>${formatDate(file.modifiedAt)}</small><button data-delete-media="${escapeHtml(file.name)}">Eliminar</button></div></article>`).join("")}</div>` : '<div class="empty-state">No hay videos en data/uploads/videos/.</div>';
}

function renderReels() {
    const files = state.library.reels;
    $("#library-content").innerHTML = files.length ? `<div class="library-grid reel-grid">${files.map((file) => `<article class="library-card reel-card"><video controls playsinline preload="metadata" src="${escapeHtml(file.url)}"></video><div class="library-card-body"><strong title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</strong><span>${formatDuration(file.duration)} · ${file.width || "-"}×${file.height || "-"} · ${formatBytes(file.size)}</span><small>${formatDate(file.createdAt)}</small><button class="button button-secondary reel-play-button" data-play-reel>▶ Reproducir</button><button data-delete-media="${escapeHtml(file.filename)}">Eliminar</button></div></article>`).join("")}</div>` : '<div class="empty-state library-empty">No hay Reels generados todavía.<button class="button button-primary" data-navigate="reel">Crear Reel</button></div>';
}

function renderLibrary(category = "flyers") {
    state.libraryCategory = category;
    const titles = { flyers: ["FLYERS", "Flyers originales"], music: ["MÚSICA", "Pistas originales"], videos: ["VIDEOS", "Videos originales"], reels: ["REELS", "Reels generados"] };
    $("#library-eyebrow").textContent = titles[category][0];
    $("#library-title").textContent = titles[category][1];
    $("#library-count").textContent = `${state.library[category].length} archivos`;
    $$("[data-library-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.libraryTab === category));
    ({ flyers: renderFlyers, music: renderMusic, videos: renderVideos, reels: renderReels }[category])();
}

async function loadLibrary(category = "flyers") {
    try {
        const response = await fetch(category === "reels" ? "/api/reels" : `/api/library/${category}`);
        if (!response.ok) throw new Error("library");
        state.library[category] = await response.json();
        updateStats();
        renderLibrary(category);
    } catch (error) { $("#library-content").innerHTML = '<div class="empty-state">No se pudo cargar esta biblioteca.</div>'; }
}

function setLibraryImage(url, fileName) {
    if (state.imageUrl && state.imageObjectUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = url;
    state.imageObjectUrl = false;
    state.imageMedia = { filename: fileName, category: "flyers" };
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

function renderGeneratedReel(data) {
    $("#generated-reel-video").src = data.url;
    $("#generated-reel-name").textContent = data.name;
    $("#generated-reel-duration").textContent = `${data.duration} segundos`;
    $("#generated-reel-size").textContent = formatBytes(data.size);
    $("#reel-result").hidden = false;
}

async function generateReel() {
    if (!state.reel.flyer || !state.reel.music) { showToast("Elegí un flyer y una música", "error"); return; }
    const button = $("#generate-reel");
    button.disabled = true;
    button.textContent = "Generando Reel...";
    try {
        const response = await fetch("/api/reels/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flyer: state.reel.flyer.name, music: state.reel.music.name, duration: Number($("#reel-duration").value) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo generar el Reel");
        renderGeneratedReel(data);
        showToast("Reel generado correctamente");
    } catch (error) { showToast(error.message, "error"); }
    finally { button.disabled = false; button.innerHTML = "Generar Reel <span>→</span>"; }
}

function resetReel() {
    state.reel.flyer = null; state.reel.music = null;
    $("#reel-flyer-name").textContent = "Elegir flyer de Biblioteca";
    $("#reel-music-name").textContent = "Elegir música de Biblioteca";
    $("#reel-result").hidden = true;
    $("#generated-reel-video").removeAttribute("src");
    updateReelPreview();
}

function bindLibraryEvents() {
    $("#choose-library-image").addEventListener("click", () => { navigate("library"); renderLibrary("flyers"); });
    $("#upload-library").addEventListener("click", () => { if (!["flyers", "videos"].includes(state.libraryCategory)) { showToast("Seleccioná Flyers o Videos para subir un archivo", "error"); return; } $("#library-upload-input").accept = state.libraryCategory === "flyers" ? ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" : ".mp4,.mov,video/mp4,video/quicktime"; $("#library-upload-input").click(); });
    $("#library-upload-input").addEventListener("change", async (event) => { const file = event.target.files[0]; if (!file) return; try { const formData = new FormData(); formData.append("category", state.libraryCategory); formData.append("file", file); const response = await fetch("/api/uploads", { method: "POST", body: formData }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo subir el archivo"); await loadLibrary(state.libraryCategory); showToast("Archivo cargado correctamente"); } catch (error) { showToast(error.message, "error"); } finally { event.target.value = ""; } });
    $("#generate-reel").addEventListener("click", generateReel);
    $("#generate-another").addEventListener("click", resetReel);
    $$('[data-reel-pick]').forEach((button) => button.addEventListener("click", () => { navigate("library"); loadLibrary(button.dataset.reelPick === "flyer" ? "flyers" : "music"); }));
    $("#reel-volume").addEventListener("input", (event) => { $("#reel-volume-value").textContent = `${event.target.value}%`; if (state.reel.music) $("#reel-audio").volume = event.target.value / 100; });
    $("[data-library-tab]").parentElement.addEventListener("click", (event) => { const tab = event.target.closest("[data-library-tab]"); if (tab) loadLibrary(tab.dataset.libraryTab); });
    $("#library-content").addEventListener("click", async (event) => { const preview = event.target.closest("[data-preview-media]"); const post = event.target.closest("[data-use-post]"); const reel = event.target.closest("[data-use-reel]"); const audio = event.target.closest("[data-use-reel-audio]"); const play = event.target.closest("[data-play-reel]"); const deleteButton = event.target.closest("[data-delete-media]"); const create = event.target.closest('[data-navigate="reel"]'); if (preview) { $("#modal-image").src = preview.dataset.previewMedia; $("#media-modal").hidden = false; } if (post) { setLibraryImage(post.dataset.usePost, post.dataset.fileName); navigate("new-post"); } if (reel) selectReelFlyer(reel.dataset.useReel, reel.dataset.fileName); if (audio) selectReelMusic(audio.dataset.useReelAudio, audio.dataset.fileName); if (play) { const video = play.closest(".reel-card").querySelector("video"); video.play(); } if (create) navigate("reel"); if (deleteButton) { if (!window.confirm("¿Eliminar este archivo?")) return; try { const response = await fetch(`/api/library/${encodeURIComponent(state.libraryCategory)}/${encodeURIComponent(deleteButton.dataset.deleteMedia)}`, { method: "DELETE" }); const data = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error(data?.error || "No se pudo eliminar el archivo"); await loadLibrary(state.libraryCategory); showToast("Archivo eliminado"); } catch (error) { showToast(error.message, "error"); } } });
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
    $("#publish-button").innerHTML = state.editingPostId ? "Guardar cambios <span>→</span>" : (scheduled ? "Programar publicación <span>→</span>" : "Publicar ahora <span>→</span>");
}

async function startEditPost(postId) {
    try {
        const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`);
        const post = await response.json();
        if (!response.ok) throw new Error(post.error || "No se pudo cargar la publicación");
        state.editingPostId = post.id;
        if (post.media.category === "flyers") setLibraryImage(postImage(post), post.media.filename);
        $("#caption").value = post.caption;
        updateCaption();
        document.querySelector('input[name="publish-mode"][value="scheduled"]').checked = post.status === "scheduled";
        document.querySelector('input[name="publish-mode"][value="now"]').checked = post.status !== "scheduled";
        if (post.scheduledAt) {
            const date = new Date(post.scheduledAt);
            $("#publish-date").value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            $("#publish-time").value = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        }
        updatePublishMode();
        navigate("new-post");
    } catch (error) { showToast(error.message, "error"); }
}

async function loadPersistentState() {
    try {
        const [postsResponse, historyResponse] = await Promise.all([fetch("/api/posts"), fetch("/api/history")]);
        if (!postsResponse.ok || !historyResponse.ok) throw new Error("persistence");
        state.posts = await postsResponse.json();
        state.history = await historyResponse.json();
        updateStats(); renderRecentActivity(); renderScheduled(); renderHistory();
    } catch (error) { showToast("No se pudieron cargar las publicaciones", "error"); }
}

async function publish() {
    const caption = $("#caption").value.trim();
    const scheduled = document.querySelector('input[name="publish-mode"]:checked').value === "scheduled";
    if (!state.imageMedia) {
        showToast("Elegí un flyer de la Biblioteca; la carga de archivos se habilitará próximamente", "error");
        return;
    }
    if (scheduled && (!$("#publish-date").value || !$("#publish-time").value)) {
        showToast("Elegí una fecha y hora para programar", "error");
        return;
    }
    const localDate = scheduled ? new Date(`${$("#publish-date").value}T${$("#publish-time").value}`) : null;
    if (scheduled && Number.isNaN(localDate.getTime())) { showToast("Fecha u hora inválida", "error"); return; }
    const scheduledAt = scheduled ? localDate.toISOString() : null;
    try {
        const method = state.editingPostId ? "PUT" : "POST";
        const endpoint = state.editingPostId ? `/api/posts/${encodeURIComponent(state.editingPostId)}` : "/api/posts";
        const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "image", media: state.imageMedia, caption, status: scheduled ? "scheduled" : "pending", scheduledAt }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo guardar la publicación");
        state.editingPostId = null;
        await loadPersistentState();
        showToast(method === "PUT" ? "Publicación actualizada correctamente" : (scheduled ? "Publicación programada correctamente" : "Publicación guardada como pendiente correctamente"));
        navigate(scheduled ? "scheduled" : "history");
    } catch (error) { showToast(error.message, "error"); }
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
    $("#scheduled-list").addEventListener("click", async (event) => { const deleteButton = event.target.closest("[data-delete-scheduled]"); const editButton = event.target.closest("[data-edit-scheduled]"); if (deleteButton) { if (!window.confirm("¿Eliminar esta publicación programada?")) return; try { const response = await fetch(`/api/posts/${encodeURIComponent(deleteButton.dataset.deleteScheduled)}`, { method: "DELETE" }); const data = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error(data?.error || "No se pudo eliminar la publicación"); await loadPersistentState(); showToast("Publicación eliminada"); } catch (error) { showToast(error.message, "error"); } } else if (editButton) { await startEditPost(editButton.dataset.editScheduled); } });
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
loadPersistentState();
loadStatus();
loadLibrary("flyers");
loadLibrary("music");
loadLibrary("videos");
loadLibrary("reels");
