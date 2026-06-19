import crypto from "crypto";

export interface CaptchaData {
    code: string;
    svg: string;
}

/**
 * Generates a random alphanumeric captcha code and draws it in an SVG string with visual noise.
 * Avoids visually ambiguous characters (like 0, O, 1, I).
 */
export function generateCaptcha(): CaptchaData {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 5; i++) {
        code += chars[crypto.randomInt(chars.length)];
    }

    const width = 150;
    const height = 50;
    
    // Premium dark-glass background style
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background: rgba(15, 23, 42, 0.6); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);">`;

    // Add noise lines
    for (let i = 0; i < 4; i++) {
        const x1 = crypto.randomInt(width);
        const y1 = crypto.randomInt(height);
        const x2 = crypto.randomInt(width);
        const y2 = crypto.randomInt(height);
        const color = `rgba(${crypto.randomInt(100, 255)}, ${crypto.randomInt(100, 255)}, ${crypto.randomInt(100, 255)}, 0.25)`;
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" />`;
    }

    // Add characters with random offset, scale, rotation and color
    for (let i = 0; i < code.length; i++) {
        const char = code[i];
        const fontSize = crypto.randomInt(24, 30);
        const angle = crypto.randomInt(-20, 20);
        const x = 18 + i * 24 + crypto.randomInt(-2, 2);
        const y = 35 + crypto.randomInt(-4, 4);
        
        // Use vibrant neon colors suitable for dark backgrounds
        const colors = [
            "rgb(0, 210, 180)", // neon teal
            "rgb(99, 102, 241)", // indigo
            "rgb(244, 63, 94)",  // rose
            "rgb(234, 179, 8)",  // yellow
            "rgb(168, 85, 247)"  // purple
        ];
        const color = colors[crypto.randomInt(colors.length)];
        
        svg += `<text x="${x}" y="${y}" font-family="monospace, sans-serif" font-weight="900" font-size="${fontSize}" fill="${color}" transform="rotate(${angle} ${x} ${y})">${char}</text>`;
    }

    // Add noise dots
    for (let i = 0; i < 40; i++) {
        const cx = crypto.randomInt(width);
        const cy = crypto.randomInt(height);
        const r = crypto.randomInt(1, 3) / 2;
        const color = `rgba(${crypto.randomInt(100, 255)}, ${crypto.randomInt(100, 255)}, ${crypto.randomInt(100, 255)}, 0.2)`;
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" />`;
    }

    svg += "</svg>";

    return { code, svg };
}

/**
 * Creates a signed token containing the captcha code and expiration time.
 */
export function createCaptchaToken(code: string): string {
    const expiresAt = Date.now() + 5 * 60 * 1000; // Valid for 5 minutes
    const secret = process.env.JWT_SECRET || "subscript_default_captcha_secret_key_443";
    const data = `${code.toUpperCase()}.${expiresAt}`;
    
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(data);
    const signature = hmac.digest("hex");
    
    return `${data}.${signature}`;
}

/**
 * Verifies that the entered code matches the one signed in the captcha token,
 * and confirms that the token has not expired.
 */
export function verifyCaptchaToken(token: string | null | undefined, enteredCode: string | null | undefined): boolean {
    if (!token || !enteredCode) return false;
    
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [signedCode, expiresAtStr, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
        console.warn("Captcha verification failed: Token expired");
        return false;
    }

    if (signedCode.toUpperCase() !== enteredCode.toUpperCase().trim()) {
        return false;
    }

    const secret = process.env.JWT_SECRET || "subscript_default_captcha_secret_key_443";
    const data = `${signedCode}.${expiresAt}`;
    
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(data);
    const expectedSignature = hmac.digest("hex");

    try {
        const sigBuffer = Buffer.from(signature, "hex");
        const expectedBuffer = Buffer.from(expectedSignature, "hex");
        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
        return false;
    }
}
