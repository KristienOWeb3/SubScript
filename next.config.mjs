/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/.well-known/mcp/server-card.json',
        destination: '/api/mcp-server-card',
      },
    ];
  },
};

export default nextConfig;
