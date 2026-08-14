import fs from "fs";
import path from "path";

// Find all icons defined in src/components/icons.tsx and used across the codebase
const iconsFileContent = fs.readFileSync("src/components/icons.tsx", "utf8");
const exportRegex = /export\s+const\s+(\w+)\s*=/g;
const declaredIcons = new Set();
let m;
while ((m = exportRegex.exec(iconsFileContent)) !== null) {
  declaredIcons.add(m[1]);
}

function getFiles(dir, files = []) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (file !== "node_modules" && file !== ".next" && file !== ".git") {
        getFiles(full, files);
      }
    } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = getFiles("src");
const usedIcons = new Set();
const importRegex = /import\s+\{([^}]+)\}\s+from\s+["']@\/components\/icons["']/g;

for (const f of allFiles) {
  const content = fs.readFileSync(f, "utf8");
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const names = match[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    names.forEach(n => {
      if (n !== "type" && !n.startsWith("type ")) usedIcons.add(n);
    });
  }
}

console.log("Declared in icons.tsx:", declaredIcons.size);
console.log("Used in src/ components/dashboard:", usedIcons.size);
console.log("List of used icons:", Array.from(usedIcons).sort().join(", "));
console.log("List of declared icons:", Array.from(declaredIcons).sort().join(", "));
