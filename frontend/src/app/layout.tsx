import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import AuthGuard from "@/components/AuthGuard";

// Evita prerender estático no build (ex.: Vercel); as páginas usam Supabase e precisam das env vars em runtime.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recebi$ - Controle de Cobranças",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <AuthGuard>{children}</AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
