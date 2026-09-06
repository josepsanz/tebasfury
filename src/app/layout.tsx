import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["200", "400"],
});

export const metadata: Metadata = {
  title: "TebasFury",
  description: "Management portal for our private LaLiga Fantasy league",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppNav />
        <main className="px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
