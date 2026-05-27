"use server";

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type WaitlistResult = {
    success: boolean;
    message: string;
    isAlreadyRegistered?: boolean;
};

export async function submitWaitlist(formData: FormData): Promise<WaitlistResult> {
    const email = formData.get("email") as string;
    const userType = (formData.get("userType") as string) || "user";
    const walletAddress = formData.get("walletAddress") as string;
    const companyName = formData.get("companyName") as string;
    const useCase = formData.get("useCase") as string;
    const monthlyVolume = formData.get("monthlyVolume") as string;

    // Basic validation
    if (!email || !email.includes("@")) {
        return { success: false, message: "Please enter a valid email address." };
    }

    // Guard clause: Check if Supabase is configured
    if (!isSupabaseConfigured || !supabase) {
        console.log("Demo mode - Supabase not configured. Email:", email, "userType:", userType);
        return { success: true, message: "Added to the waitlist! Follow our X for more updates." };
    }

    try {
        // Check if email already exists
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

        if (walletAddress) {
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
        }

        const insertPayload: Record<string, any> = {
            email: email.toLowerCase(),
            user_type: userType,
            created_at: new Date().toISOString(),
        };

        if (walletAddress) {
            insertPayload.wallet_address = walletAddress.toLowerCase();
        }
        if (companyName) {
            insertPayload.company_name = companyName;
        }
        if (useCase) {
            insertPayload.use_case = useCase;
        }
        if (monthlyVolume) {
            insertPayload.monthly_volume = monthlyVolume;
        }

        // Insert new waitlist entry
        const { error } = await supabase.from("waitlist").insert(insertPayload);

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
