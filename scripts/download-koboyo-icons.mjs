import fs from "fs";
import path from "path";

// Mapping of project icon names to candidate slugs on Koboyo
const ICON_SLUG_CANDIDATES = {
  Activity: ["activity", "pulse", "heartbeat", "waveform", "vital-signs"],
  AlertCircle: ["alert-circle", "warning-circle", "info-circle", "info", "warning"],
  AlertTriangle: ["alert-triangle", "warning-triangle", "warning", "caution"],
  ArrowDown: ["arrow-down", "arrow-bottom", "down-arrow"],
  ArrowDownToLine: ["arrow-down-to-line", "arrow-line-down", "download-arrow", "arrow-down"],
  ArrowLeft: ["arrow-left", "left-arrow", "back-arrow"],
  ArrowRight: ["arrow-right", "right-arrow", "forward-arrow"],
  ArrowRightLeft: ["arrow-right-left", "arrows-left-right", "transfer", "exchange", "switch"],
  ArrowUp: ["arrow-up", "up-arrow"],
  ArrowUpRight: ["arrow-up-right", "arrow-top-right", "external-link", "diagonal-arrow-right-up"],
  Award: ["award", "badge", "trophy", "medal", "ribbon"],
  Ban: ["ban", "block", "prohibited", "forbidden", "cancel"],
  BarChart3: ["bar-chart-3", "bar-chart", "chart-bar", "barchart", "chart", "analytics"],
  Bell: ["bell", "notification", "alarm", "chime"],
  BookOpen: ["book-open", "open-book", "book", "reading"],
  Broadcast: ["broadcast", "megaphone", "bullhorn", "antenna", "signal", "radio"],
  Building2: ["bank", "skyscraper", "building", "hotel", "tower", "office"],
  Calendar: ["calendar", "calendar-days", "date", "schedule"],
  Camera: ["camera", "photo", "snapshot"],
  Check: ["check", "checkmark", "tick", "check-mark"],
  CheckCircle: ["check-circle", "circle-check", "checkmark-circle", "success-circle", "check"],
  CheckCircle2: ["check-circle-2", "circle-check", "check-circle", "success", "check"],
  ChevronDown: ["chevron-down", "caret-down", "arrow-down", "down"],
  ChevronLeft: ["chevron-left", "caret-left", "arrow-left", "back"],
  ChevronRight: ["chevron-right", "caret-right", "arrow-right", "forward"],
  ChevronUp: ["chevron-up", "caret-up", "arrow-up", "up"],
  Clock: ["clock", "time", "timer", "watch", "hour"],
  Code: ["code", "coding", "source-code", "brackets", "programming"],
  Code2: ["code-2", "code-block", "code", "terminal"],
  Copy: ["copy", "clipboard", "duplicate", "clone", "document-copy"],
  CreditCard: ["credit-card", "payment-card", "card", "bank-card", "debit-card"],
  Crown: ["crown", "king", "queen", "vip", "royal"],
  DollarSign: ["dollar-sign", "dollar", "currency-dollar", "money", "cash"],
  Download: ["download", "arrow-down-tray", "saving", "file-download"],
  ExternalLink: ["external-link", "arrow-up-right", "link-external", "open-new-window", "share"],
  Eye: ["eye", "visible", "show", "view", "vision"],
  EyeOff: ["eye-off", "eye-slash", "hidden", "invisible", "hide"],
  FileText: ["file-text", "document", "file", "text-file", "page"],
  Filter: ["filter", "funnel", "sort"],
  Gift: ["gift", "present", "box-gift", "reward"],
  Globe: ["globe", "world", "earth", "internet", "web"],
  Globe2: ["globe-2", "globe", "world", "earth"],
  Heart: ["heart", "like", "love", "favorite"],
  HelpCircle: ["help-circle", "question-circle", "question", "help", "support"],
  Home: ["home", "house", "dashboard", "homepage"],
  Inbox: ["inbox", "tray", "incoming", "mail-box"],
  Key: ["key", "passkey", "access-key", "lock-key"],
  KeyRound: ["key-round", "key", "password-key", "access-key"],
  Layers: ["layers", "stack", "layer", "stack-overflow"],
  Link2: ["link-2", "link", "chain", "hyperlink", "connection"],
  Loader2: ["loader-2", "spinner", "loader", "loading", "progress"],
  Lock: ["lock", "padlock", "security", "locked", "vault"],
  LockKeyhole: ["lock-keyhole", "lock", "padlock", "secure"],
  LogOut: ["log-out", "sign-out", "logout", "exit", "door"],
  Mail: ["mail", "envelope", "email", "letter", "message"],
  MailCheck: ["mail-check", "mail-sent", "envelope", "mail"],
  Menu: ["menu", "hamburger-menu", "list", "options"],
  MessageSquare: ["message-square", "chat", "speech-bubble", "comment", "message"],
  Pause: ["pause", "pause-circle", "break"],
  Pencil: ["pencil", "edit", "pen", "write"],
  PieChart: ["pie-chart", "chart-pie", "piechart", "analytics"],
  Play: ["play", "play-circle", "start"],
  PlayCircle: ["play-circle", "play", "start-circle"],
  PlugZap: ["plug-zap", "plug", "power-cord", "lightning", "socket"],
  Plus: ["plus", "add", "cross-add", "create"],
  Power: ["power", "power-button", "power-off", "shutdown", "switch"],
  QrCode: ["qr-code", "qrcode", "barcode", "scan"],
  ReceiptText: ["receipt-text", "receipt", "invoice", "bill", "ticket"],
  RefreshCcw: ["refresh-ccw", "arrow-counter-clockwise", "rotate-ccw", "undo", "reload"],
  RefreshCw: ["refresh-cw", "arrows-clockwise", "rotate-cw", "reload", "refresh", "sync"],
  RotateCw: ["rotate-cw", "arrow-clockwise", "rotate", "reload", "redo"],
  Save: ["save", "floppy-disk", "diskette", "storage"],
  Search: ["search", "magnifying-glass", "find", "lookup"],
  Send: ["send", "paper-plane", "paperplane", "submit"],
  Server: ["server", "database", "data-server", "datacenter"],
  Share2: ["share-2", "share", "share-network", "social-share"],
  Shield: ["shield", "security", "protection", "safe"],
  ShieldAlert: ["shield-alert", "shield-warning", "security-alert", "shield-exclamation"],
  ShieldCheck: ["shield-check", "security-check", "verified-shield", "shield"],
  ShieldOff: ["shield-off", "shield-slash", "shield-disabled"],
  ShieldX: ["shield-x", "shield-warning", "shield-alert", "shield-cross"],
  ShoppingBag: ["shopping-bag", "bag", "cart", "store-bag", "purchase"],
  Sliders: ["toggle", "settings", "adjust", "controls"],
  Sparkles: ["sparkles", "sparkle", "magic", "stars", "glitter"],
  SquaresFour: ["squares-four", "grid", "four-squares", "dashboard", "apps", "menu"],
  Tag: ["tag", "price-tag", "label", "badge"],
  Terminal: ["terminal", "command-line", "console", "cli", "prompt"],
  TimerReset: ["timer-reset", "timer", "stopwatch", "clock-timer"],
  Trash2: ["trash-2", "trash", "trash-can", "bin", "delete"],
  TrendingDown: ["trending-down", "trend-down", "down-trend", "graph-down"],
  TrendingUp: ["trending-up", "trend-up", "up-trend", "graph-up"],
  Trophy: ["trophy", "cup", "award", "winner", "prize"],
  Upload: ["upload", "arrow-up-tray", "file-upload", "publish"],
  User: ["user", "person", "account", "profile", "avatar"],
  UserCheck: ["user-check", "person-check", "verified-user", "user-verified"],
  UserPlus: ["user-plus", "add-user", "person-plus", "invite-user"],
  UserX: ["user-x", "user-minus", "remove-user", "block-user"],
  Users: ["users", "people", "group", "team", "community"],
  Wallet: ["wallet", "billfold", "purse", "money-bag"],
  WalletCards: ["wallet-cards", "cardholder", "wallet", "cards"],
  Webhook: ["webhook", "webhooks", "api", "network", "integration"],
  X: ["x", "cross", "close", "cancel", "dismiss"],
  XCircle: ["x-circle", "circle-x", "close-circle", "cross-circle", "cancel-circle"],
  Zap: ["zap", "lightning", "bolt", "energy", "flash"]
};

const outputDir = path.join(process.cwd(), "public", "icons", "koboyo");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function resolveAndDownload() {
  console.log(`Resolving and downloading ${Object.keys(ICON_SLUG_CANDIDATES).length} icons from Koboyo...`);
  const resolved = {};
  const failed = [];

  for (const [iconName, candidates] of Object.entries(ICON_SLUG_CANDIDATES)) {
    let found = false;
    for (const slug of candidates) {
      const url = `https://koboyo.com/icons/svg/${slug}.svg`;
      try {
        const res = await fetch(url);
        if (res.status === 200) {
          const svgText = await res.text();
          if (svgText && svgText.includes("<svg")) {
            const destPath = path.join(outputDir, `${iconName}.svg`);
            fs.writeFileSync(destPath, svgText, "utf8");
            resolved[iconName] = {
              slug,
              url,
              destPath: path.relative(process.cwd(), destPath).replaceAll(path.sep, "/"),
            };
            console.log(`[SUCCESS] ${iconName} -> ${slug}.svg`);
            found = true;
            break;
          }
        }
      } catch (err) {
        // continue
      }
    }
    if (!found) {
      console.warn(`[FAILED] Could not find SVG for ${iconName} (tested: ${candidates.join(", ")})`);
      failed.push(iconName);
    }
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Downloaded: ${Object.keys(resolved).length}/${Object.keys(ICON_SLUG_CANDIDATES).length}`);
  if (failed.length > 0) {
    console.log(`Missing: ${failed.join(", ")}`);
  }
  
  // Write index manifest
  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(resolved, null, 2),
    "utf8"
  );
}

resolveAndDownload();

