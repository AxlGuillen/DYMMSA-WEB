import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Asegura que CHANGELOG.md (leído con fs en /dashboard/changelog) se incluya
  // en el bundle de producción / trace de Vercel.
  outputFileTracingIncludes: {
    '/dashboard/changelog': ['./CHANGELOG.md'],
  },
};

export default nextConfig;
