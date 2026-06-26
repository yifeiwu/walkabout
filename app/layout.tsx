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
        {/* Warm up the connections the first interaction needs. */}
        <link rel="preconnect" href="https://tile.openstreetmap.org" crossOrigin="" />
        <link rel="preconnect" href="https://nominatim.openstreetmap.org" crossOrigin="" />
        <link rel="dns-prefetch" href="https://maps.mail.ru" />
        <link rel="dns-prefetch" href="https://overpass-api.de" />
        <link rel="dns-prefetch" href="https://overpass.private.coffee" />
      </head>
      <body>{children}</body>
    </html>
  );
}
