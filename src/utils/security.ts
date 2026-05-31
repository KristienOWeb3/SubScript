/* Utility to recursively sanitize user input on POST/PUT requests */
export function sanitizeInput<T>(input: T): T {
    if (typeof input === "string") {
        /* Strip script tags, HTML tags, and trim whitespace */
        const inputStr = input as string;
        let cleaned = inputStr;
        
        /* Remove script blocks: <script>...</script> */
        cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
        
        /* Remove other html tags */
        cleaned = cleaned.replace(/<[^>]*>/g, "");
        
        return cleaned.trim() as unknown as T;
    }
    
    if (Array.isArray(input)) {
        return input.map(item => sanitizeInput(item)) as unknown as T;
    }
    
    if (input !== null && typeof input === "object") {
        const cleanedObj: Record<string, any> = {};
        for (const [key, value] of Object.entries(input)) {
            /* Prevent prototype pollution */
            if (key === "__proto__" || key === "constructor" || key === "prototype") {
                continue;
            }
            cleanedObj[key] = sanitizeInput(value);
        }
        return cleanedObj as unknown as T;
    }
    
    return input;
}
