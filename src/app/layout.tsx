import type { Metadata } from "next";
import { Barlow, IBM_Plex_Mono } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import { getEnv } from "@/lib/env";
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

/**
 * `opengraph-image.jpg` sitting beside this file is the whole of the link preview:
 * Next reads the file convention and emits `og:image` and the twitter card with their
 * type and dimensions, against a content-hashed URL, so there is no path to keep in
 * step here and a replaced image cannot serve stale from a scraper's cache.
 *
 * There is no `og:image:alt`. `opengraph-image.alt.txt` is documented in this version's
 * own docs but 16.3.4 emits nothing for it — checked in dev and in the build output —
 * and the only way to supply the alt is to declare `openGraph.images` by hand, which
 * gives up the content hash above. Not worth that trade; if a later version honours the
 * file, adding it back is one line.
 *
 * `metadataBase` is required for that to become an absolute URL, which is the only
 * kind a scraper can fetch. It is read from BETTER_AUTH_URL rather than hard-coded
 * because that variable already holds the deployment's public origin, and a second
 * copy of it would be a second thing to get wrong.
 *
 * Worth knowing: the preview is the ONE thing the allowlist does not gate. Everything
 * else now needs an address on the list; this image renders for anybody the link
 * reaches.
 */
export const metadata: Metadata = {
  metadataBase: new URL(getEnv().BETTER_AUTH_URL),
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
