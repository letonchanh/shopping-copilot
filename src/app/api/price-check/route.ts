// Extracts current and lowest Amazon price from a CamelCamelCamel chart.
// The client fetches the chart via /api/chart proxy (same-origin, avoids
// CORS) and sends the image as base64 via POST. The server uses Gemini
// vision to read prices from the chart legend.

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

// POST: client sends { asin, imageBase64 } — chart fetched via /api/chart proxy
export async function POST(request: NextRequest) {
  const { asin, imageBase64 } = (await request.json()) as {
    asin?: string;
    imageBase64?: string;
  };

  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }
  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
  }

  console.log(`[price-check] POST request for asin=${asin}`);

  // Check in-memory cache first
  const cached = cache.get(asin);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[price-check] ${asin}: cache hit`);
    return NextResponse.json({ asin, currentPrice: cached.currentPrice, lowestPrice: cached.lowestPrice });
  }

  try {
    const prices = await extractPricesFromBase64(asin, imageBase64);

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
