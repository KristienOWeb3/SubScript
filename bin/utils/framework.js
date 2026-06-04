import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
export async function detectFramework(cwd) {
    const pkgJsonPath = path.join(cwd, "package.json");
    if (!existsSync(pkgJsonPath)) {
        return "unsupported";
    }
    try {
        const pkgContent = await readFile(pkgJsonPath, "utf8");
        const pkg = JSON.parse(pkgContent);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const hasNext = !!deps["next"];
        const hasReact = !!deps["react"];
        if (!hasReact) {
            return "unsupported";
        }
        if (hasNext) {
            // Check for App Router vs Pages Router (Next.js)
            const hasAppDir = existsSync(path.join(cwd, "src", "app")) || existsSync(path.join(cwd, "app"));
            const hasPagesDir = existsSync(path.join(cwd, "src", "pages")) || existsSync(path.join(cwd, "pages"));
            if (hasAppDir) {
                return "next-app";
            }
            if (hasPagesDir) {
                return "next-pages";
            }
            return "next-app"; // Default fallback if next exists
        }
        // Standard React project (Vite / CRA)
        return "react-spa";
    }
    catch {
        return "unsupported";
    }
}
