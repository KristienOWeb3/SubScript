/**
 * Client-side avatar image downscaler and compressor.
 * Prevents "413 Payload Too Large" errors by resizing camera/RAW photos (3MB-15MB+)
 * to a crisp 512x512 avatar (typically 30KB-90KB) in WebP or JPEG format.
 */
export async function compressAvatarImage(
    file: File,
    maxDim: number = 512,
    quality: number = 0.85
): Promise<string> {
    if (!file.type.startsWith("image/")) {
        throw new Error("Selected file must be an image.");
    }

    return new Promise<string>((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            try {
                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;

                if (!width || !height) {
                    throw new Error("Unable to read image dimensions.");
                }

                // Square crop or fit within maxDim x maxDim
                if (width > height) {
                    if (width > maxDim) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    throw new Error("Canvas 2D context not supported.");
                }

                // Smooth resizing
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(img, 0, 0, width, height);

                // Prefer WebP for high compression efficiency; fallback to JPEG
                let dataUrl = "";
                try {
                    dataUrl = canvas.toDataURL("image/webp", quality);
                } catch {
                    dataUrl = canvas.toDataURL("image/jpeg", quality);
                }

                if (!dataUrl || !dataUrl.startsWith("data:image/")) {
                    dataUrl = canvas.toDataURL("image/jpeg", quality);
                }

                resolve(dataUrl);
            } catch (err) {
                reject(err);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Failed to load image for compression."));
        };

        img.src = objectUrl;
    });
}
