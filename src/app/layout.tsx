import type { Metadata } from "next";
import { Barlow, IBM_Plex_Mono } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/**
 * The figure face. Every number a reader compares against another number — points,
 * values, deltas, ranks — is set in it, because columns of figures only line up when
 * the digits are the same width. Text is never set in it: this is instrumentation, not
 * a typewriter effect.
 */
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "TebasFury",
  description: "Management portal for our private LaLiga Fantasy league",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppNav />
        <main className="px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
