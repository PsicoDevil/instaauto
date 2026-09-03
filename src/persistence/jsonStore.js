const fs = require("fs");
const path = require("path");

async function readJson(filePath, fallback) {
    try {
        const content = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(content);
    } catch (error) {
        if (error.code === "ENOENT") return fallback;
        throw error;
    }
}

async function writeJsonAtomic(filePath, value) {
    const directory = path.dirname(filePath);
    await fs.promises.mkdir(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
    }
}

async function ensureJsonFile(filePath, fallback) {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await writeJsonAtomic(filePath, fallback);
    }
}

module.exports = { readJson, writeJsonAtomic, ensureJsonFile };
