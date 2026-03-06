// Proxies CamelCamelCamel chart images, filtering out "no data" error images.
// Error images are ~8 KB (all-white); real charts are 15 KB+.

import { NextRequest, NextResponse } from "next/server";

const SIZE_THRESHOLD = 10_000; // bytes — error images are ~8.5 KB

export async function GET(request: NextRequest) {
  const asin = request.nextUrl.searchParams.get("asin");
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  // Use amazon-new to include both Amazon-sold and 3rd party new prices.
  // The plain "amazon" endpoint only has Amazon-direct prices, which many
  // products lack, causing false "no data" errors.
  const chartUrl =
    `https://charts.camelcamelcamel.com/us/${asin}/amazon-new.png` +
    `?force=1&zero=0&w=500&h=200&desired=false&legend=1&ilt=1&tp=all&fo=0`;

  try {
    const res = await fetch(chartUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: "Chart not available" },
        { status: 502 },
      );
    }

    const buf = await res.arrayBuffer();

    if (buf.byteLength < SIZE_THRESHOLD) {
      return NextResponse.json(
        { error: "No price history available for this product" },
        { status: 404 },
      );
    }

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch chart" },
      { status: 502 },
    );
  }
}
