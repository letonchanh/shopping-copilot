// Extracts current and lowest Amazon price from a CamelCamelCamel chart.
// Server fetches the chart (direct or via allorigins.win fallback),
// converts to base64, and uses Gemini vision to read prices.

import { NextRequest, NextResponse } from "next/server";
import { llmConfig } from "@/config";

interface CachedPrice {
  currentPrice: number;
  lowestPrice: number;
  ts: number;
}

// In-memory cache: ASIN -> prices
const cache = new Map<string, CachedPrice>();
const CACHE_TTL = 3600_000; // 1 hour
const SIZE_THRESHOLD = 10_000; // bytes — error images are ~8.5 KB

async function fetchChartBase64(asin: string): Promise<string | null> {
  const chartUrl =
    `https://charts.camelcamelcamel.com/us/${asin}/amazon-new.png` +
    `?force=1&zero=0&w=500&h=200&desired=false&legend=1&ilt=1&tp=all&fo=0`;

  // Try direct first (with short timeout), fall back to allorigins.win
  let res: Response | null = null;
  try {
    res = await fetch(chartUrl, { signal: AbortSignal.timeout(3000) });
  } catch { /* timeout or network error — try fallback */ }

  if (!res?.ok) {
    try {
      res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(chartUrl)}`);
    } catch {
      console.error(`[price-check] All chart fetches failed for ${asin}`);
      return null;
    }
  }
  if (!res?.ok) {
    console.error(`[price-check] Chart fetch failed for ${asin}: ${res?.status}`);
    return null;
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < SIZE_THRESHOLD) {
    console.log(`[price-check] ${asin}: chart too small (no data)`);
    return null;
  }

  return Buffer.from(buf).toString("base64");
}

async function extractPricesFromBase64(
  asin: string,
  base64: string,
): Promise<{ currentPrice: number; lowestPrice: number } | null> {
  const llmRes = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64}` },
            },
            {
              type: "text",
              text: 'This is a CamelCamelCamel price history chart. Read the legend table at the bottom. First look for the "Amazon" row. If the Amazon row has no data or is missing, use the "3rd Party New" row instead. Return ONLY a JSON object with the "Current" price and "Lowest" price as numbers (no $ sign). Format: {"currentPrice":123.45,"lowestPrice":67.89}. If neither row has data or the image is blank/error, return {"currentPrice":null,"lowestPrice":null}.',
            },
          ],
        },
      ],
      max_tokens: 100,
    }),
  });

  if (!llmRes.ok) {
    console.error(`LLM vision error for ${asin}: ${llmRes.status}`);
    return null;
  }

  const llmData = await llmRes.json();
  const text = llmData.choices?.[0]?.message?.content?.trim();
  if (!text) return null;

  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const current = typeof parsed.currentPrice === "number" ? parsed.currentPrice : null;
    const lowest = typeof parsed.lowestPrice === "number" ? parsed.lowestPrice : null;
    if (current == null && lowest == null) return null;
    const result = {
      currentPrice: current ?? 0,
      lowestPrice: lowest ?? 0,
    };
    console.log(`[price-check] ${asin}: current=$${result.currentPrice}, lowest=$${result.lowestPrice}`);
    return result;
  } catch {
    console.error(`Failed to parse LLM response for ${asin}: ${text}`);
    return null;
  }
}

// GET: /api/price-check?asin=B09KVJ5197
export async function GET(request: NextRequest) {
  const asin = request.nextUrl.searchParams.get("asin");

  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  console.log(`[price-check] GET request for asin=${asin}`);

  // Check in-memory cache first
  const cached = cache.get(asin);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[price-check] ${asin}: cache hit`);
    return NextResponse.json({ asin, currentPrice: cached.currentPrice, lowestPrice: cached.lowestPrice });
  }

  try {
    const base64 = await fetchChartBase64(asin);
    if (!base64) {
      return NextResponse.json({ error: "Chart not available" }, { status: 404 });
    }

    const prices = await extractPricesFromBase64(asin, base64);
    if (!prices) {
      console.log(`[price-check] ${asin}: no prices extracted from chart`);
      return NextResponse.json({ error: "Price not found" }, { status: 404 });
    }

    cache.set(asin, { ...prices, ts: Date.now() });
    return NextResponse.json({ asin, ...prices });
  } catch (err) {
    console.error(`Price check error for ${asin}:`, err);
    return NextResponse.json({ error: "Failed to check price" }, { status: 502 });
  }
}
