const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");
const multer = require("multer");
const { readJson, writeJsonAtomic, ensureJsonFile } = require("./persistence/jsonStore");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsRoot = path.resolve(__dirname, "..", "data", "uploads");
const generatedRoot = path.resolve(__dirname, "..", "data", "generated", "reels");
const appDataRoot = path.resolve(__dirname, "..", "data", "app");
const postsFile = path.join(appDataRoot, "posts.json");
const historyFile = path.join(appDataRoot, "history.json");
const ffmpegRoot = path.resolve(__dirname, "..", "tools", "ffmpeg", "ffmpeg-9.0.1-full_build", "bin");
const toolConfig = {
    ffmpegPath: path.resolve(process.env.FFMPEG_PATH || path.join(ffmpegRoot, "ffmpeg.exe")),
    ffprobePath: path.resolve(process.env.FFPROBE_PATH || path.join(ffmpegRoot, "ffprobe.exe"))
};
const libraryConfig = {
    flyers: { directory: "flyers", extensions: [".jpg", ".jpeg", ".png", ".webp"] },
    music: { directory: "music", extensions: [".mp3", ".wav", ".m4a"] },
    videos: { directory: "videos", extensions: [".mp4", ".mov", ".webm"] }
};
const reelDurations = [5, 10, 15, 20, 30, 45, 60];
const reelAnimations = ["Sin animación", "Zoom suave", "Fade", "Movimiento vertical"];
let reelGenerationInProgress = false;
const postStatuses = ["draft", "scheduled", "ready", "pending", "published", "failed"];
const postTypes = ["image", "reel"];
const schedulerIntervalMs = 30000;
const uploadLimits = { fileSize: 50 * 1024 * 1024, files: 1 };
const uploadMimeTypes = {
    flyers: ["image/jpeg", "image/png", "image/webp"],
    music: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/ogg"],
    videos: ["video/mp4", "video/quicktime"]
};

const uploadExtensions = {
    flyers: [".jpg", ".jpeg", ".png", ".webp"],
    music: [".mp3", ".wav", ".m4a", ".aac", ".ogg"],
    videos: [".mp4", ".mov"]
};
const upload = multer({ storage: multer.memoryStorage(), limits: uploadLimits });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/media/") && /(?:%2e|%2f|%5c|\.\.)/i.test(req.originalUrl)) return apiError(res, 400, "Ruta inválida");
    next();
});

app.use(express.static(path.join(__dirname, "public")));

function getDimensions(buffer, extension) {
    if (extension === ".png" && buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (extension === ".webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        if (buffer.toString("ascii", 12, 16) === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if ([".jpg", ".jpeg"].includes(extension) && buffer.length > 4 && buffer.readUInt16BE(0) === 0xffd8) {
        let offset = 2;
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) { offset += 1; continue; }
            const marker = buffer[offset + 1];
            const length = buffer.readUInt16BE(offset + 2);
            if (marker >= 0xc0 && marker <= 0xc3) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
            if (!length) break;
            offset += 2 + length;
        }
    }
    return null;
}

async function readLibrary(category) {
    const config = libraryConfig[category];
    if (!config) return null;
    const directory = path.join(uploadsRoot, config.directory);
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.filter((entry) => entry.isFile() && config.extensions.includes(path.extname(entry.name).toLowerCase())).map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = await fs.promises.stat(filePath);
        const extension = path.extname(entry.name).toLowerCase();
        const dimensions = category === "flyers" ? getDimensions(await fs.promises.readFile(filePath, { encoding: null, flag: "r" }).then((buffer) => buffer.subarray(0, 65536)), extension) : null;
        return { name: entry.name, extension: extension.slice(1).toUpperCase(), size: stats.size, modifiedAt: stats.mtime.toISOString(), dimensions, url: `/media/${category}/${encodeURIComponent(entry.name)}` };
    }));
    return files.sort((first, second) => first.name.localeCompare(second.name, "es", { numeric: true }));
}

function safeInputName(value) {
    return typeof value === "string" && value.length > 0 && value === path.basename(value) && !value.includes("\0") && !value.includes("/") && !value.includes("\\") && !path.isAbsolute(value);
}

function isValidDate(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function apiError(res, status, message) {
    return res.status(status).json({ ok: false, error: message });
}

async function resolveMedia(media) {
    if (!media || !postTypes.includes(media.category === "reels" ? "reel" : "image") || !safeInputName(media.filename)) return null;
    const root = media.category === "reels" ? generatedRoot : path.resolve(uploadsRoot, "flyers");
    const extension = path.extname(media.filename).toLowerCase();
    const allowedExtensions = media.category === "reels" ? [".mp4"] : libraryConfig.flyers.extensions;
    if (!allowedExtensions.includes(extension)) return null;
    const filePath = path.resolve(root, media.filename);
    if (!filePath.startsWith(`${root}${path.sep}`)) return null;
    try {
        const stats = await fs.promises.stat(filePath);
        return stats.isFile() ? filePath : null;
    } catch (error) {
        return null;
    }
}

async function loadPosts() {
    const posts = await readJson(postsFile, []);
    return Array.isArray(posts) ? posts : [];
}

async function loadHistory() {
    const history = await readJson(historyFile, []);
    return Array.isArray(history) ? history : [];
}

async function recordHistory(action, post, details = {}) {
    const history = await loadHistory();
    history.unshift({ id: crypto.randomUUID(), postId: post?.id, action, status: post?.status || null, createdAt: new Date().toISOString(), post: post ? { ...post, media: { ...post.media } } : null, ...details });
    await writeJsonAtomic(historyFile, history);
}

async function updatePostStatus(postId, status) {
    const posts = await loadPosts();
    const index = posts.findIndex((post) => post.id === postId);
    if (index === -1 || posts[index].status !== "scheduled" || new Date(posts[index].scheduledAt) > new Date()) return false;
    const post = { ...posts[index], status, updatedAt: new Date().toISOString() };
    posts[index] = post;
    await writeJsonAtomic(postsFile, posts);
    await recordHistory("ready_to_publish", post);
    return true;
}

async function processScheduledPosts() {
    try {
        const posts = await loadPosts();
        const duePosts = posts.filter((post) => post.status === "scheduled" && isValidDate(post.scheduledAt) && new Date(post.scheduledAt) <= new Date());
        for (const post of duePosts) {
            if (await updatePostStatus(post.id, "ready")) console.log(`Publicación lista para preparar: ${post.id}`);
        }
    } catch (error) {
        console.error("Error en scheduler local:", error.message);
    }
}

function validatePostInput(input, existingPost) {
    const value = input || {};
    const type = value.type ?? existingPost?.type;
    const media = value.media ?? existingPost?.media;
    const caption = value.caption ?? existingPost?.caption;
    const status = value.status ?? existingPost?.status ?? "draft";
    const scheduledAt = value.scheduledAt === undefined ? (existingPost?.scheduledAt ?? null) : value.scheduledAt;
    if (!postTypes.includes(type)) return { error: "Tipo de publicación inválido" };
    if (!media || !["flyers", "reels"].includes(media.category) || !safeInputName(media.filename)) return { error: "Referencia multimedia inválida" };
    if ((type === "image" && media.category !== "flyers") || (type === "reel" && media.category !== "reels")) return { error: "El tipo no coincide con la categoría multimedia" };
    if (typeof caption !== "string" || caption.length > 2200) return { error: "Caption inválido" };
    if (!postStatuses.includes(status)) return { error: "Estado de publicación inválido" };
    if (status === "scheduled" && (!isValidDate(scheduledAt) || new Date(scheduledAt) <= new Date())) return { error: "scheduledAt debe ser una fecha futura válida" };
    if (status !== "scheduled" && scheduledAt !== null && !isValidDate(scheduledAt)) return { error: "scheduledAt inválido" };
    return { value: { type, media: { filename: media.filename, category: media.category }, caption, status, scheduledAt: scheduledAt || null } };
}

async function resolveUpload(name, category) {
    const config = libraryConfig[category];
    if (!config || !safeInputName(name) || !config.extensions.includes(path.extname(name).toLowerCase())) return null;
    const categoryRoot = path.resolve(uploadsRoot, config.directory);
    const filePath = path.resolve(categoryRoot, name);
    if (!filePath.startsWith(`${categoryRoot}${path.sep}`)) return null;
    try {
        const stats = await fs.promises.stat(filePath);
        return stats.isFile() ? filePath : null;
    } catch (error) {
        return null;
    }
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const process = spawn(toolConfig.ffmpegPath, args, { windowsHide: true });
        let stderr = "";
        process.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        process.on("error", reject);
        process.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-4000) || `FFmpeg terminó con código ${code}`)));
    });
}

function runFfprobe(args) {
    return new Promise((resolve, reject) => {
        const process = spawn(toolConfig.ffprobePath, args, { windowsHide: true });
        let stdout = "";
        let stderr = "";
        process.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        process.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        process.on("error", reject);
        process.on("close", (code) => {
            if (code !== 0) return reject(new Error(stderr.slice(-1000) || `FFprobe terminó con código ${code}`));
            try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
        });
    });
}

async function getMediaDuration(filePath) {
    const probe = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath]);
    const duration = Number(probe.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function generatedName() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `reel-${stamp}-${crypto.randomBytes(3).toString("hex")}.mp4`;
}

async function readGeneratedReels() {
    const entries = await fs.promises.readdir(generatedRoot, { withFileTypes: true });
    const reels = await Promise.all(entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp4").map(async (entry) => {
        const filePath = path.join(generatedRoot, entry.name);
        const stats = await fs.promises.stat(filePath);
        let metadata = {};
        try {
            const probe = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height", "-of", "json", filePath]);
            const video = probe.streams?.find((stream) => stream.codec_type === "video");
            metadata = { duration: Number(probe.format?.duration), width: video?.width, height: video?.height };
        } catch (error) {
            console.error("No se pudo leer metadata del Reel:", entry.name, error.message);
        }
        return { filename: entry.name, url: `/media/generated/reels/${encodeURIComponent(entry.name)}`, size: stats.size, createdAt: stats.birthtime.toISOString(), ...metadata };
    }));
    return reels.sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
}

app.get("/api/library/:category", async (req, res) => {
    try {
        const files = await readLibrary(req.params.category);
        if (!files) return apiError(res, 404, "Categoría no válida");
        res.json(files);
    } catch (error) {
        if (error.code === "ENOENT") return res.json([]);
        apiError(res, 500, "No se pudo leer la biblioteca");
    }
});

app.get("/media/:category/:filename", async (req, res) => {
    const config = libraryConfig[req.params.category];
    const filename = req.params.filename;
    if (!config || !filename || filename !== path.basename(filename) || filename.includes("\\") || filename.includes("/") || path.extname(filename).toLowerCase() !== path.extname(filename).toLowerCase()) return apiError(res, 404, "Archivo no encontrado");
    if (!config.extensions.includes(path.extname(filename).toLowerCase())) return apiError(res, 404, "Archivo no encontrado");
    const filePath = path.resolve(uploadsRoot, config.directory, filename);
    const categoryRoot = path.resolve(uploadsRoot, config.directory);
    if (!filePath.startsWith(`${categoryRoot}${path.sep}`)) return apiError(res, 403, "Ruta inválida");
    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
        res.sendFile(filePath);
    } catch (error) {
        apiError(res, 404, "Archivo no encontrado");
    }
});

app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        app: "InstaAuto",
        instagram: "not_connected"
    });
});

app.get("/api/posts", async (req, res) => {
    try {
        res.json(await loadPosts());
    } catch (error) {
        console.error("No se pudieron leer las publicaciones:", error.message);
        apiError(res, 500, "No se pudieron leer las publicaciones");
    }
});

app.post("/api/posts", async (req, res) => {
    try {
        const validation = validatePostInput(req.body);
        if (validation.error) return apiError(res, 400, validation.error);
        if (!await resolveMedia(validation.value.media)) return apiError(res, 404, "El archivo multimedia no existe");
        const now = new Date().toISOString();
        const post = { id: crypto.randomUUID(), ...validation.value, createdAt: now, updatedAt: now };
        const posts = await loadPosts();
        if (posts.some((item) => item.id === post.id)) return apiError(res, 409, "ID duplicado");
        posts.unshift(post);
        await writeJsonAtomic(postsFile, posts);
        await recordHistory("created", post);
        if (post.status === "scheduled") await recordHistory("scheduled", post);
        res.status(201).json(post);
    } catch (error) {
        console.error("No se pudo crear la publicación:", error.message);
        apiError(res, 500, "No se pudo crear la publicación");
    }
});

app.get("/api/posts/:id", async (req, res) => {
    try {
        const post = (await loadPosts()).find((item) => item.id === req.params.id);
        if (!post) return apiError(res, 404, "Publicación no encontrada");
           res.status(200).json(post);
    } catch (error) {
           apiError(res, 500, "Error interno al leer la publicación");
    }
});

app.put("/api/posts/:id", async (req, res) => {
    try {
        const posts = await loadPosts();
        const index = posts.findIndex((item) => item.id === req.params.id);
        if (index === -1) return apiError(res, 404, "Publicación no encontrada");
        const validation = validatePostInput(req.body, posts[index]);
        if (validation.error) return apiError(res, 400, validation.error);
        if (!await resolveMedia(validation.value.media)) return apiError(res, 404, "El archivo multimedia no existe");
        const post = { ...posts[index], ...validation.value, updatedAt: new Date().toISOString() };
        posts[index] = post;
        await writeJsonAtomic(postsFile, posts);
        await recordHistory("updated", post);
        if (post.status === "scheduled") await recordHistory("scheduled", post);
        res.json(post);
    } catch (error) {
        console.error("No se pudo actualizar la publicación:", error.message);
        apiError(res, 500, "No se pudo actualizar la publicación");
    }
});

app.delete("/api/posts/:id", async (req, res) => {
    try {
        const posts = await loadPosts();
        const index = posts.findIndex((item) => item.id === req.params.id);
        if (index === -1) return apiError(res, 404, "Publicación no encontrada");
        const [post] = posts.splice(index, 1);
        await writeJsonAtomic(postsFile, posts);
        await recordHistory("deleted", post);
        res.status(204).end();
    } catch (error) {
        console.error("No se pudo eliminar la publicación:", error.message);
        apiError(res, 500, "No se pudo eliminar la publicación");
    }
});

app.get("/api/history", async (req, res) => {
    try {
        res.json(await loadHistory());
    } catch (error) {
        console.error("No se pudo leer el historial:", error.message);
        apiError(res, 500, "No se pudo leer el historial");
    }
});

app.post("/api/uploads", upload.single("file"), async (req, res) => {
    try {
        const category = req.body?.category;
        const file = req.file;
        if (!uploadExtensions[category] || !file) return apiError(res, 400, "Archivo o categoría inválidos");
        const extension = path.extname(file.originalname || "").toLowerCase();
        if (!uploadExtensions[category].includes(extension) || !uploadMimeTypes[category].includes(file.mimetype)) return apiError(res, 400, "Formato de archivo no permitido");
        const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`;
        const directory = path.resolve(uploadsRoot, category);
        const filePath = path.resolve(directory, filename);
        if (!filePath.startsWith(`${directory}${path.sep}`)) return apiError(res, 400, "Nombre de archivo inválido");
        await fs.promises.mkdir(directory, { recursive: true });
        await fs.promises.writeFile(filePath, file.buffer, { flag: "wx" });
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile() || stats.size === 0) {
            await fs.promises.rm(filePath, { force: true });
            return apiError(res, 400, "El archivo subido no es válido");
        }
        await recordHistory("upload", null, { media: { filename, category }, size: stats.size });
        res.status(201).json({ ok: true, name: filename, category, url: `/media/${category}/${encodeURIComponent(filename)}`, size: stats.size });
    } catch (error) {
        console.error("No se pudo guardar el upload:", error.message);
        if (error.code === "LIMIT_FILE_SIZE") return apiError(res, 400, "El archivo supera el límite permitido");
        res.status(500).json({ ok: false, error: "No se pudo guardar el archivo" });
    }
});

app.delete("/api/library/:category/:filename", async (req, res) => {
    try {
        const category = req.params.category;
        const filename = req.params.filename;
        const root = category === "reels" ? generatedRoot : uploadExtensions[category] ? path.resolve(uploadsRoot, category) : null;
        const allowed = category === "reels" ? [".mp4"] : uploadExtensions[category];
        if (!root || !allowed || !safeInputName(filename) || !allowed.includes(path.extname(filename).toLowerCase())) return apiError(res, 404, "Archivo no encontrado");
        const filePath = path.resolve(root, filename);
        if (!filePath.startsWith(`${root}${path.sep}`)) return apiError(res, 403, "Ruta inválida");
        const posts = await loadPosts();
        if (posts.some((post) => post.media?.category === category && post.media.filename === filename)) return apiError(res, 409, "El archivo está utilizado por una publicación");
        await fs.promises.unlink(filePath);
        res.status(204).end();
    } catch (error) {
        if (error.code === "ENOENT") return apiError(res, 404, "Archivo no encontrado");
        console.error("No se pudo eliminar el archivo:", error.message);
        res.status(500).json({ ok: false, error: "No se pudo eliminar el archivo" });
    }
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) return apiError(res, 400, error.code === "LIMIT_FILE_SIZE" ? "El archivo supera el límite permitido" : "Error de upload");
    if (error instanceof SyntaxError && error.status === 400 && error.type === "entity.parse.failed") return apiError(res, 400, "JSON inválido");
    console.error("Error interno no controlado:", error.message);
    res.status(500).json({ ok: false, error: "Error interno del servidor" });
});

Promise.all([ensureJsonFile(postsFile, []), ensureJsonFile(historyFile, [])]).then(() => {
    app.listen(PORT, () => {
        console.log(`InstaAuto funcionando en http://localhost:${PORT}`);
    });
    processScheduledPosts();
    setInterval(processScheduledPosts, schedulerIntervalMs).unref();
}).catch((error) => {
    console.error("No se pudo inicializar la persistencia:", error.message);
    process.exitCode = 1;
});

app.post("/api/reels/generate", async (req, res) => {
    if (reelGenerationInProgress) return apiError(res, 409, "Ya hay una generación en curso");
    const { flyer, music, duration, start = 0, volume = 100, fadeIn = false, fadeOut = false, animation = "Zoom suave" } = req.body || {};
    const requestedDuration = Number(duration);
    const requestedStart = Number(start);
    const requestedVolume = Number(volume);
    if (!reelDurations.includes(requestedDuration)) return apiError(res, 400, "Duración inválida");
    if (!Number.isFinite(requestedStart) || requestedStart < 0) return apiError(res, 400, "Inicio de audio inválido");
    if (!Number.isFinite(requestedVolume) || requestedVolume < 0 || requestedVolume > 100) return apiError(res, 400, "Volumen inválido");
    if (!reelAnimations.includes(animation) || typeof fadeIn !== "boolean" || typeof fadeOut !== "boolean") return apiError(res, 400, "Configuración de Reel inválida");
    const [flyerPath, musicPath] = await Promise.all([resolveUpload(flyer, "flyers"), resolveUpload(music, "music")]);
    if (!flyerPath) return apiError(res, 404, "Flyer inexistente o inválido");
    if (!musicPath) return apiError(res, 404, "Música inexistente o inválida");
    let musicDuration;
    try {
        musicDuration = await getMediaDuration(musicPath);
    } catch (error) {
        console.error("No se pudo leer la duración de la música:", error.message);
        return apiError(res, 400, "La música no se puede procesar");
    }
    if (!musicDuration || requestedStart >= musicDuration) return apiError(res, 400, "El inicio de audio supera la duración de la música");
    if (musicDuration > requestedDuration && requestedStart + requestedDuration > musicDuration) return apiError(res, 400, "El fragmento de audio excede la duración de la música");
    try {
        await fs.promises.mkdir(generatedRoot, { recursive: true });
        await fs.promises.access(toolConfig.ffmpegPath, fs.constants.X_OK);
    } catch (error) {
        console.error("FFmpeg no encontrado:", toolConfig.ffmpegPath, error.message);
        return apiError(res, 503, "FFmpeg no está disponible");
    }
    const filename = generatedName();
    const outputPath = path.resolve(generatedRoot, filename);
    reelGenerationInProgress = true;
    const animationFilter = animation === "Zoom suave"
        ? `zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30`
        : animation === "Movimiento vertical"
            ? `zoompan=z=1.05:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*on/(30*${requestedDuration})':d=1:s=1080x1920:fps=30`
            : "";
    const visualFade = animation === "Fade" ? `fade=t=in:st=0:d=${Math.min(0.5, requestedDuration / 2)},fade=t=out:st=${Math.max(0, requestedDuration - Math.min(0.5, requestedDuration / 2))}:d=${Math.min(0.5, requestedDuration / 2)},` : "";
    const filter = `[0:v]split=2[background][foreground];[background]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[blurred];[foreground]scale=1080:1920:force_original_aspect_ratio=decrease[sharp];[blurred][sharp]overlay=(W-w)/2:(H-h)/2,format=yuv420p[base];[base]${animationFilter ? `${animationFilter},` : ""}${visualFade}format=yuv420p[v]`;
    const audioFadeDuration = Math.min(2, requestedDuration / 2);
    const audioFilters = [`volume=${requestedVolume / 100}`];
    if (fadeIn) audioFilters.push(`afade=t=in:st=0:d=${audioFadeDuration}`);
    if (fadeOut) audioFilters.push(`afade=t=out:st=${Math.max(0, requestedDuration - audioFadeDuration)}:d=${audioFadeDuration}`);
    try {
        await runFfmpeg(["-y", "-loop", "1", "-framerate", "30", "-i", flyerPath, "-stream_loop", "-1", "-ss", String(requestedStart), "-i", musicPath, "-filter_complex", filter, "-map", "[v]", "-map", "1:a:0", "-af", audioFilters.join(","), "-t", String(requestedDuration), "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath]);
        const stats = await fs.promises.stat(outputPath);
        if (!stats.isFile() || stats.size === 0) throw new Error("El archivo generado no existe o está vacío");
        const result = { name: filename, url: `/media/generated/reels/${encodeURIComponent(filename)}`, duration: requestedDuration, size: stats.size };
        await recordHistory("reel_generated", null, { media: { filename, category: "reels" }, result });
        res.status(201).json(result);
    } catch (error) {
        console.error("Error generando Reel:", error.message);
        await fs.promises.rm(outputPath, { force: true }).catch(() => {});
        if (error.code === "ENOENT") return apiError(res, 503, "FFmpeg no está disponible");
        apiError(res, 500, "No se pudo generar el Reel");
    } finally {
        reelGenerationInProgress = false;
    }
});

app.get("/media/generated/reels/:filename", async (req, res) => {
    const filename = req.params.filename;
    if (!safeInputName(filename) || path.extname(filename).toLowerCase() !== ".mp4") return apiError(res, 404, "Reel no encontrado");
    const filePath = path.resolve(generatedRoot, filename);
    if (!filePath.startsWith(`${generatedRoot}${path.sep}`)) return apiError(res, 403, "Ruta inválida");
    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
        res.sendFile(filePath);
    } catch (error) {
        apiError(res, 404, "Reel no encontrado");
    }
});

app.get("/api/reels", async (req, res) => {
    try {
        res.json(await readGeneratedReels());
    } catch (error) {
        if (error.code === "ENOENT") return res.json([]);
        console.error("No se pudo leer los Reels generados:", error.message);
        apiError(res, 500, "No se pudo leer los Reels generados");
    }
});