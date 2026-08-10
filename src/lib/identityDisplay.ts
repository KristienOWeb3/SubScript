const SUBSCRIPT_ALIAS_SUFFIX = /\.(?:sub|hq|biz)$/i;

function titleCaseAlias(value: string): string {
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
