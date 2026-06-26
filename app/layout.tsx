import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Walkabout — Australian Address Explorer",
  description:
    "Enter an Australian address to map nearby transport, food, shops, parks, schools and amenities using OpenStreetMap data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Warm up the basemap tile connections the map needs immediately. Tiles
            are plain <img> (non-CORS), so these preconnects must NOT set
            crossOrigin or the tile requests can't reuse the warmed connection.
            The tile layer rotates across the a-d subdomains. */}
        <link rel="preconnect" href="https://a.basemaps.cartocdn.com" />
        <link rel="preconnect" href="https://b.basemaps.cartocdn.com" />
        <link rel="preconnect" href="https://c.basemaps.cartocdn.com" />
        <link rel="dns-prefetch" href="https://d.basemaps.cartocdn.com" />
        <link rel="dns-prefetch" href="https://maps.mail.ru" />
        <link rel="dns-prefetch" href="https://overpass-api.de" />
        <link rel="dns-prefetch" href="https://overpass.private.coffee" />
      </head>
      <body>{children}</body>
    </html>
  );
}
