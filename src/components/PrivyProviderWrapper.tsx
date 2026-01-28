"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export default function PrivyProviderWrapper({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <PrivyProvider
            appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || "your-privy-app-id"}
            config={{
                appearance: {
                    theme: "dark",
                    accentColor: "#00b8a3",
                    logo: undefined,
                },
                loginMethods: ["email", "wallet"],
                embeddedWallets: {
                    createOnLogin: "users-without-wallets",
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}
