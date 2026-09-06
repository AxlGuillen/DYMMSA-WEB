import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los changelogs se leen con fs en runtime: sin esto Vercel no los mete al
  // bundle de la ruta y la página quedaría vacía en producción.
  outputFileTracingIncludes: {
    '/dashboard/changelog': ['./CHANGELOG.md'],
    '/dashboard/changelog/actividad': ['./DYMMSA/06-Changelog/*.md'],
  },
};

export default nextConfig;
