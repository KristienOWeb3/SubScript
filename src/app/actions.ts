"use server";

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type WaitlistResult = {
    success: boolean;
    message: string;
    isAlreadyRegistered?: boolean;
};

export async function submitWaitlist(formData: FormData): Promise<WaitlistResult> {
    const email = formData.get("email") as string;
    const walletAddress = formData.get("walletAddress") as string;

    // Basic validation
    if (!email || !email.includes("@")) {
        return { success: false, message: "Please enter a valid email address." };
    }

    if (!walletAddress || walletAddress.length < 10) {
        return { success: false, message: "Please enter a valid wallet address." };
    }

    // Guard clause: Check if Supabase is configured
    if (!isSupabaseConfigured || !supabase) {
        console.log("Demo mode - Supabase not configured. Email:", email, "Wallet:", walletAddress);
        return { success: true, message: "Added to the waitlist! Follow our X for more updates." };
    }

    try {
        // Check if email OR wallet already exists (single query for efficiency)
        const { data: existingEmail } = await supabase
            .from("waitlist")
            .select("email")
            .eq("email", email.toLowerCase())
            .maybeSingle();

        if (existingEmail) {
            return {
                success: true,
                message: "You're already on the list! Follow our X for updates.",
                isAlreadyRegistered: true
            };
        }

        const { data: existingWallet } = await supabase
            .from("waitlist")
            .select("wallet_address")
            .eq("wallet_address", walletAddress.toLowerCase())
            .maybeSingle();

        if (existingWallet) {
            return {
                success: true,
                message: "You're already on the list! Follow our X for updates.",
                isAlreadyRegistered: true
            };
        }

        // Insert new waitlist entry
        const { error } = await supabase.from("waitlist").insert({
            email: email.toLowerCase(),
            wallet_address: walletAddress.toLowerCase(),
            created_at: new Date().toISOString(),
        });

        if (error) {
            console.error("Supabase insert error:", error);
            // Handle unique constraint violation gracefully
            if (error.code === "23505") {
                return {
                    success: true,
                    message: "You're already on the list! Follow our X for updates.",
                    isAlreadyRegistered: true
                };
            }
            return { success: false, message: "Something went wrong. Please try again." };
        }

        return { success: true, message: "Added to the waitlist! Follow our X for more updates." };
    } catch (error) {
        console.error("Waitlist submission error:", error);
        return { success: false, message: "Something went wrong. Please try again." };
    }
}
