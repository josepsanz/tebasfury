import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /**
     * The one place player portraits come from.
     *
     * Pinned as narrowly as the API allows — one host, one path prefix, no query string
     * — because this list is what stops the optimizer being pointed at arbitrary URLs.
     * Every one of the 840 catalogued players carries an image on exactly this host,
     * measured before the pattern was written.
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets-fantasy.llt-services.com",
        port: "",
        pathname: "/players/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
