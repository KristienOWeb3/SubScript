import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
// TODO: Re-enable PrivyProviderWrapper once API keys are configured
// import PrivyProviderWrapper from "@/components/PrivyProviderWrapper";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
});

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
};

export const metadata: Metadata = {
    title: "SubScript | Automated Crypto Subscriptions",
    description: "SubScript is the best platform to automate your crypto life, manage recurring expenses, and handle subscriptions on-chain.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${inter.variable} font-sans antialiased`}>
                {/* TODO: Re-enable PrivyProviderWrapper once API keys are configured */}
                {/* <PrivyProviderWrapper> */}
                {children}
                {/* </PrivyProviderWrapper> */}
            </body>
        </html>
    );
}
