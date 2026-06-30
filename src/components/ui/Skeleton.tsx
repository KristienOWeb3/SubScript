"use client";

import React from "react";

interface SkeletonProps {
    className?: string;
    width?: string | number;
    height?: string | number;
    circle?: boolean;
    variant?: "default" | "faint" | "glass";
}

export default function Skeleton({
    className = "",
    width,
    height,
    circle = false,
    variant = "default",
}: SkeletonProps) {
    const style: React.CSSProperties = {};
    if (width !== undefined) style.width = width;
    if (height !== undefined) style.height = height;

    const baseClass = 
        variant === "glass" 
            ? "liquid-glass-skeleton" 
            : variant === "faint"
            ? "subscript-skeleton subscript-skeleton--faint"
            : "subscript-skeleton";

    return (
        <div
            className={`${baseClass} ${
                circle ? "rounded-full" : "rounded-2xl"
            } ${className}`}
            style={style}
        />
    );
}

