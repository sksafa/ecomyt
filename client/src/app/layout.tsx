import type { Metadata } from "next";
import { Hind_Siliguri, Inter } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Bengali text (addresses, notes, risk warnings) renders in Hind Siliguri
const hind = Hind_Siliguri({ subsets: ["bengali", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-hind" });

export const metadata: Metadata = {
  title: { default: "Bent & Bound", template: "%s · Bent & Bound" },
  description: "Premium embroidered orna from Bangladesh",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${hind.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
