import type { NextConfig } from "next";

// No script-src/style-src on purpose: a strict CSP needs nonces for Next's inline scripts and would break the app unseen.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // Los changelogs se leen con fs en runtime: sin esto Vercel no los mete al
  // bundle de la ruta y la página quedaría vacía en producción.
  outputFileTracingIncludes: {
    '/dashboard/changelog': ['./CHANGELOG.md'],
    '/dashboard/changelog/actividad': ['./DYMMSA/06-Changelog/*.md'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
