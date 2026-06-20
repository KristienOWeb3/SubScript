import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/premium',
        destination: '/merchant',
        permanent: true,
      },
      {
        source: '/dashboard',
        destination: '/merchant',
        permanent: true,
      },
      {
        source: '/dashboard/user',
        destination: '/user',
        permanent: true,
      },
      {
        source: '/dashboard/upgrade',
        destination: '/merchant/upgrade',
        permanent: true,
      },
      {
        source: '/dashboard/payroll',
        destination: '/merchant/payroll',
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
    ];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
