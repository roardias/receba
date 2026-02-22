import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import AuthGuard from "@/components/AuthGuard";

export const metadata: Metadata = {
  title: "Receba - Controle de Cobranças",
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
