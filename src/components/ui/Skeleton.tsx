"use client";

import React from "react";

interface SkeletonProps {
    className?: string;
    width?: string | number;
    height?: string | number;
    circle?: boolean;
}

export default function Skeleton({
    className = "",
    width,
    height,
    circle = false,
}: SkeletonProps) {
    const style: React.CSSProperties = {};
    if (width !== undefined) style.width = width;
    if (height !== undefined) style.height = height;

    return (
        <div
            className={`liquid-glass-skeleton ${
                circle ? "rounded-full" : "rounded-2xl"
            } ${className}`}
            style={style}
        />
    );
}
