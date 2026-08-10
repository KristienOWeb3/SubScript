const SUBSCRIPT_ALIAS_SUFFIX = /\.(?:sub|hq|biz)$/i;

export function titleCaseAlias(value: string): string {
    if (!value) return "";
    if (value.toLowerCase().startsWith("anonymous-")) {
        const shortId = value.split("-")[1]?.slice(0, 6) || "";
        return shortId ? `User #${shortId}` : "SubScript User";
    }
    const words = value
        .replace(SUBSCRIPT_ALIAS_SUFFIX, "")
        .replace(/[._-]+/g, " ")
        .trim();
    if (!words) return "";
    if (/^subscript$/i.test(words)) return "SubScript";
    return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function accountDisplayName(alias: unknown, fallback = "SubScript account"): string {
    if (typeof alias !== "string") return fallback;
    return titleCaseAlias(alias) || fallback;
}

export function merchantDisplayName(alias: unknown): string {
    return accountDisplayName(alias, "SubScript merchant");
}
