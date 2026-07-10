import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Necesario para que Next resuelva URLs absolutas (og:image que comparten
  // Slack/WhatsApp requieren URL absoluta, no relativa).
  metadataBase: new URL("https://dymmsa-web.vercel.app"),
  title: {
    default: "DYMMSA - Sistema de Cotizaciones",
    template: "%s | DYMMSA",
  },
  description:
    "Sistema de cotizaciones y gestión de inventario para DYMMSA, distribuidor autorizado de herramientas URREA en Morelia, México.",
  keywords: [
    "DYMMSA",
    "URREA",
    "cotizaciones",
    "herramientas",
    "inventario",
    "Morelia",
    "distribuidor",
  ],
  authors: [{ name: "DYMMSA" }],
  creator: "DYMMSA",
  robots: {
    index: false,
    follow: false,
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DYMMSA",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: "DYMMSA",
    title: "DYMMSA - Sistema Modular",
    description:
      "Sistema de cotizaciones y gestión de inventario para DYMMSA, distribuidor autorizado de herramientas URREA.",
  },
  // La imagen (og:image / twitter:image) la aporta automáticamente
  // src/app/opengraph-image.tsx; summary_large_image la muestra en grande.
  twitter: {
    card: "summary_large_image",
    title: "DYMMSA - Sistema Modular",
    description:
      "Sistema de cotizaciones y gestión de inventario para DYMMSA, distribuidor autorizado de herramientas URREA.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
        >
          <QueryProvider>{children}</QueryProvider>
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
