"use client";

import { useState, useEffect, useCallback } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "subscript_theme";

export function useTheme() {
    const [theme, setThemeState] = useState<Theme>("light");
    const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
    const [mounted, setMounted] = useState(false);

    const applyTheme = useCallback((targetTheme: Theme) => {
        let isDark = false;
        if (targetTheme === "system") {
            isDark = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        } else {
            isDark = targetTheme === "dark";
        }

        const effective = isDark ? "dark" : "light";
        setResolvedTheme(effective);

        if (typeof document !== "undefined") {
            const root = document.documentElement;
            root.classList.remove("light", "dark");
            root.classList.add(effective);
            root.setAttribute("data-theme", effective);
            root.style.colorScheme = effective;
        }
    }, []);

    useEffect(() => {
        setMounted(true);
        let savedTheme: Theme = "light";
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored === "dark" || stored === "light" || stored === "system") {
                savedTheme = stored;
            }
        } catch {
            /* ignore storage access issues */
        }

        setThemeState(savedTheme);
        applyTheme(savedTheme);

        const handleStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark" || e.newValue === "system")) {
                setThemeState(e.newValue);
                applyTheme(e.newValue);
            }
        };

        const handleCustom = (e: CustomEvent<Theme>) => {
            if (e.detail && (e.detail === "light" || e.detail === "dark" || e.detail === "system")) {
                setThemeState(e.detail);
                applyTheme(e.detail);
            }
        };

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleMedia = () => {
            try {
                const cur = (localStorage.getItem(STORAGE_KEY) || "light") as Theme;
                if (cur === "system") {
                    applyTheme("system");
                }
            } catch {
                /* ignore */
            }
        };

        window.addEventListener("storage", handleStorage);
        window.addEventListener("subscript-theme-change" as any, handleCustom as any);
        mediaQuery.addEventListener("change", handleMedia);

        return () => {
            window.removeEventListener("storage", handleStorage);
            window.removeEventListener("subscript-theme-change" as any, handleCustom as any);
            mediaQuery.removeEventListener("change", handleMedia);
        };
    }, [applyTheme]);

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme);
        try {
            localStorage.setItem(STORAGE_KEY, newTheme);
        } catch {
            /* ignore */
        }
        applyTheme(newTheme);
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("subscript-theme-change", { detail: newTheme }));
        }
    }, [applyTheme]);

    const toggleTheme = useCallback(() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        setTheme(next);
    }, [resolvedTheme, setTheme]);

    return {
        theme,
        setTheme,
        toggleTheme,
        resolvedTheme,
        isDark: resolvedTheme === "dark",
        mounted,
    };
}
