import { supabaseAdmin } from "./supabaseAdmin";

/**
 * Parses a Data URL (base64 image) and uploads it to Supabase Storage.
 * Returns the public URL of the uploaded asset, or falls back to the original Base64 if storage is not configured.
 */
export async function uploadProfilePicture(
    base64DataUrl: string,
    walletAddress: string
): Promise<string> {
    if (!supabaseAdmin) {
        console.warn("[Storage Utility] Supabase admin client not configured. Falling back to storing Base64 directly in database.");
        return base64DataUrl;
    }

    try {
        // Parse data URL format: data:image/png;base64,...
        // Only raster image types are accepted — never image/svg+xml, which can carry
        // executable script and would be a stored-XSS vector if ever rendered inline.
        const match = base64DataUrl.match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/);
        if (!match) {
            console.warn("[Storage Utility] Unsupported or non-raster image data URL. Rejecting upload.");
            return "";
        }

        const [, mimeType, base64Data] = match;
        const extension = mimeType.split("/")[1] || "png";
        
        // Generate a clean, unique file path: profile_<wallet>_<timestamp>.<ext>
        const filename = `profile_${walletAddress.toLowerCase().replace(/[^a-z0-9]/g, "")}_${Date.now()}.${extension}`;
        
        // Convert base64 to binary buffer
        const buffer = Buffer.from(base64Data, "base64");

        // Ensure the public bucket "profiles" exists
        const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
        if (listError) {
            console.error("[Storage Utility] Failed to list buckets:", listError);
            return base64DataUrl;
        }

        const bucketName = "profiles";
        const bucketExists = buckets?.some((b) => b.name === bucketName);

        if (!bucketExists) {
            console.log(`[Storage Utility] Bucket "${bucketName}" not found. Creating a public bucket...`);
            const { error: createError } = await supabaseAdmin.storage.createBucket(bucketName, {
                public: true,
                fileSizeLimit: 2097152, // 2MB
                allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"]
            });
            if (createError) {
                console.error("[Storage Utility] Failed to create bucket:", createError);
                return base64DataUrl;
            }
        }

        // Upload the file buffer
        const { error: uploadError } = await supabaseAdmin.storage
            .from(bucketName)
            .upload(filename, buffer, {
                contentType: mimeType,
                cacheControl: "31536000", // 1 year cache for CDN optimization
                upsert: true,
            });

        if (uploadError) {
            console.error("[Storage Utility] Upload failed:", uploadError);
            return base64DataUrl;
        }

        // Get public CDN-compatible URL
        const { data: urlData } = supabaseAdmin.storage
            .from(bucketName)
            .getPublicUrl(filename);

        if (!urlData || !urlData.publicUrl) {
            console.error("[Storage Utility] Failed to generate public URL.");
            return base64DataUrl;
        }

        console.log(`[Storage Utility] File uploaded successfully. Reference URL: ${urlData.publicUrl}`);
        return urlData.publicUrl;
    } catch (err) {
        console.error("[Storage Utility] Unexpected error during file storage upload:", err);
        return base64DataUrl;
    }
}
