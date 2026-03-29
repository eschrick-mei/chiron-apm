/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["@tremor/react", "lucide-react"],
  },
};

module.exports = nextConfig;
