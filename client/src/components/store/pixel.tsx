"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { captureAttribution, track } from "./tracking";

/**
 * Loads the Meta Pixel (standard fbq snippet) only when a pixel id is configured, fires PageView on
 * first load and on client-side route changes, and captures first/last-touch attribution on landing.
 */
export function StoreTracking({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    captureAttribution();
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false; // the snippet itself sends the landing PageView
      return;
    }
    if (pixelId) track("PageView");
  }, [pathname, pixelId]);

  if (!pixelId || !/^\d{5,20}$/.test(pixelId)) return null;
  return (
    <Script id="bb-meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId}');fbq('track','PageView');
(window.__bbPixelQ||[]).forEach(function(a){fbq.apply(null,a)});window.__bbPixelQ=[];`}
    </Script>
  );
}
