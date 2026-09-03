const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsRoot = path.resolve(__dirname, "..", "data", "uploads");
const generatedRoot = path.resolve(__dirname, "..", "data", "generated", "reels");
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
const reelDurations = [5, 8, 10];
let reelGenerationInProgress = false;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/media/") && /(?:%2e|%2f|%5c|\.\.)/i.test(req.originalUrl)) return res.status(400).end();
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
        if (!files) return res.status(404).json({ error: "Categoría no válida" });
        res.json(files);
    } catch (error) {
        if (error.code === "ENOENT") return res.json([]);
        res.status(500).json({ error: "No se pudo leer la biblioteca" });
    }
});

app.get("/media/:category/:filename", async (req, res) => {
    const config = libraryConfig[req.params.category];
    const filename = req.params.filename;
    if (!config || !filename || filename !== path.basename(filename) || filename.includes("\\") || filename.includes("/") || path.extname(filename).toLowerCase() !== path.extname(filename).toLowerCase()) return res.status(404).end();
    if (!config.extensions.includes(path.extname(filename).toLowerCase())) return res.status(404).end();
    const filePath = path.resolve(uploadsRoot, config.directory, filename);
    const categoryRoot = path.resolve(uploadsRoot, config.directory);
    if (!filePath.startsWith(`${categoryRoot}${path.sep}`)) return res.status(403).end();
    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
        res.sendFile(filePath);
    } catch (error) {
        res.status(404).end();
    }
});

app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        app: "InstaAuto",
        instagram: "not_connected"
    });
});

app.listen(PORT, () => {
    console.log(`InstaAuto funcionando en http://localhost:${PORT}`);
});

app.post("/api/reels/generate", async (req, res) => {
    if (reelGenerationInProgress) return res.status(409).json({ error: "Ya hay una generación en curso" });
    const { flyer, music, duration } = req.body || {};
    const requestedDuration = Number(duration);
    if (!reelDurations.includes(requestedDuration)) return res.status(400).json({ error: "Duración inválida" });
    const [flyerPath, musicPath] = await Promise.all([resolveUpload(flyer, "flyers"), resolveUpload(music, "music")]);
    if (!flyerPath) return res.status(404).json({ error: "Flyer inexistente o inválido" });
    if (!musicPath) return res.status(404).json({ error: "Música inexistente o inválida" });
    try {
        await fs.promises.mkdir(generatedRoot, { recursive: true });
        await fs.promises.access(toolConfig.ffmpegPath, fs.constants.X_OK);
    } catch (error) {
        console.error("FFmpeg no encontrado:", toolConfig.ffmpegPath, error.message);
        return res.status(503).json({ error: "FFmpeg no está disponible" });
    }
    const filename = generatedName();
    const outputPath = path.resolve(generatedRoot, filename);
    reelGenerationInProgress = true;
    const filter = "[0:v]split=2[background][foreground];[background]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[blurred];[foreground]scale=1080:1920:force_original_aspect_ratio=decrease[sharp];[blurred][sharp]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]";
    try {
        await runFfmpeg(["-y", "-loop", "1", "-i", flyerPath, "-stream_loop", "-1", "-i", musicPath, "-filter_complex", filter, "-map", "[v]", "-map", "1:a:0", "-t", String(requestedDuration), "-r", "30", "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath]);
        const stats = await fs.promises.stat(outputPath);
        if (!stats.isFile() || stats.size === 0) throw new Error("El archivo generado no existe o está vacío");
        res.status(201).json({ name: filename, url: `/media/generated/reels/${encodeURIComponent(filename)}`, duration: requestedDuration, size: stats.size });
    } catch (error) {
        console.error("Error generando Reel:", error.message);
        await fs.promises.rm(outputPath, { force: true }).catch(() => {});
        if (error.code === "ENOENT") return res.status(503).json({ error: "FFmpeg no está disponible" });
        res.status(500).json({ error: "No se pudo generar el Reel" });
    } finally {
        reelGenerationInProgress = false;
    }
});

app.get("/media/generated/reels/:filename", async (req, res) => {
    const filename = req.params.filename;
    if (!safeInputName(filename) || path.extname(filename).toLowerCase() !== ".mp4") return res.status(404).end();
    const filePath = path.resolve(generatedRoot, filename);
    if (!filePath.startsWith(`${generatedRoot}${path.sep}`)) return res.status(403).end();
    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
        res.sendFile(filePath);
    } catch (error) {
        res.status(404).end();
    }
});

app.get("/api/reels", async (req, res) => {
    try {
        res.json(await readGeneratedReels());
    } catch (error) {
        if (error.code === "ENOENT") return res.json([]);
        console.error("No se pudo leer los Reels generados:", error.message);
        res.status(500).json({ error: "No se pudo leer los Reels generados" });
    }
});