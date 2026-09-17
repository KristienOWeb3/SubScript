import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: "/",
            disallow: ["/dashboard/", "/merchant/", "/user/", "/admin/", "/api/"],
        },
        sitemap: "https://www.subscriptonarc.com/sitemap.xml",
        host: "https://www.subscriptonarc.com",
    };
}
