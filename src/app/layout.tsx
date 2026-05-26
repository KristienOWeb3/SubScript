import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";
import PrivyProviderWrapper from "@/components/PrivyProviderWrapper";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
});

const instrumentSerif = Instrument_Serif({
    subsets: ["latin"],
    weight: ["400"],
    style: ["normal", "italic"],
    variable: "--font-instrument",
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
            <body className={`${inter.variable} ${instrumentSerif.variable} font-sans antialiased`}>
                <PrivyProviderWrapper>
                    {children}
                </PrivyProviderWrapper>
            </body>
        </html>
    );
}
