const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsRoot = path.resolve(__dirname, "..", "data", "uploads");
const libraryConfig = {
    flyers: { directory: "flyers", extensions: [".jpg", ".jpeg", ".png", ".webp"] },
    music: { directory: "music", extensions: [".mp3", ".wav", ".m4a"] },
    videos: { directory: "videos", extensions: [".mp4", ".mov", ".webm"] }
};

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