import path from "node:path";
import { existsSync } from "node:fs";
export const CLI_VERSION = "1.2.0";
export const TEMPLATE_VERSION = "1.2.0";
export function getProjectPaths(cwd, framework) {
    const hasSrc = existsSync(path.join(cwd, "src"));
    const baseDir = hasSrc ? path.join(cwd, "src") : cwd;
    let configPath = path.join(baseDir, "subscript.config.ts");
    let componentsDir = path.join(baseDir, "components", "subscript");
    let webhookPath = "";
    let hasBackend = false;
    if (framework === "next-app") {
        const hasAppFolder = existsSync(path.join(cwd, "src", "app")) || existsSync(path.join(cwd, "app"));
        const appBase = hasAppFolder
            ? (existsSync(path.join(cwd, "src", "app")) ? path.join(cwd, "src", "app") : path.join(cwd, "app"))
            : path.join(baseDir, "app");
        webhookPath = path.join(appBase, "api", "webhooks", "subscript", "route.ts");
        hasBackend = true;
    }
    else if (framework === "next-pages") {
        const hasPagesFolder = existsSync(path.join(cwd, "src", "pages")) || existsSync(path.join(cwd, "pages"));
        const pagesBase = hasPagesFolder
            ? (existsSync(path.join(cwd, "src", "pages")) ? path.join(cwd, "src", "pages") : path.join(cwd, "pages"))
            : path.join(baseDir, "pages");
        webhookPath = path.join(pagesBase, "api", "webhooks", "subscript.ts");
        hasBackend = true;
    }
    return {
        configPath,
        componentsDir,
        webhookPath,
        hasBackend
    };
}
