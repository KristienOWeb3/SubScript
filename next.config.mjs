import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/* Pin the output-file-tracing root to this project. Without it, Next infers the root from the
   nearest parent lockfile and can pick a directory above the repo (there are multiple
   package-lock.json files in play), which bundles the wrong files and emits a build-time warning. */
const projectRoot = dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    // camera=(self) so the in-app QR scanner can use the device camera; everything else stays denied.
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/premium',
        destination: 'https://dashboard.subscriptonarc.com/merchant',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/.well-known/mcp/server-card.json',
        destination: '/api/mcp-server-card',
      },
      {
        source: '/openapi.json',
        destination: '/api/openapi',
      },
    ];
  },
  /* Turbopack became the default bundler in Next 16, and a `webpack` key with no `turbopack` key is
     a hard build error there rather than a warning — Next cannot tell whether the webpack config
     still matters. Both are kept, so `next build` (Turbopack) and `next build --webpack` behave the
     same: the only customization is stubbing out an optional React Native dependency that
     WalletConnect pulls in and never uses on the web. webpack takes `false` for that; Turbopack
     wants a module path, hence the stub file. */
  turbopack: {
    resolveAlias: {
      "@react-native-async-storage/async-storage": "./src/stubs/empty.js",
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
