import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/layout/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chiron APM - Solar Fleet Monitor",
  description: "High-performance solar portfolio monitoring dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            {/* ml-16 matches collapsed sidebar width; expanded sidebar overlaps slightly */}
            <main className="flex-1 ml-16 lg:ml-64 transition-all duration-200">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
