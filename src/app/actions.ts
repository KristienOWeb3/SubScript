"use server";

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type WaitlistResult = {
    success: boolean;
    message: string;
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
        return { success: true, message: "Demo mode: You're on the list! (Configure Supabase to save data)" };
    }

    try {
        // Check if email already exists
        const { data: existingEmail } = await supabase!
            .from("waitlist")
            .select("email")
            .eq("email", email.toLowerCase())
            .single();

        if (existingEmail) {
            return { success: false, message: "This email is already on the waitlist!" };
        }

        // Check if wallet already exists
        const { data: existingWallet } = await supabase!
            .from("waitlist")
            .select("wallet_address")
            .eq("wallet_address", walletAddress.toLowerCase())
            .single();

        if (existingWallet) {
            return { success: false, message: "This wallet address is already registered!" };
        }

        // Insert new waitlist entry
        const { error } = await supabase!.from("waitlist").insert({
            email: email.toLowerCase(),
            wallet_address: walletAddress.toLowerCase(),
            created_at: new Date().toISOString(),
        });

        if (error) {
            console.error("Supabase insert error:", error);
            return { success: false, message: "Something went wrong. Please try again." };
        }

        return { success: true, message: "You're on the list! We'll be in touch soon." };
    } catch (error) {
        console.error("Waitlist submission error:", error);
        return { success: false, message: "Something went wrong. Please try again." };
    }
}
