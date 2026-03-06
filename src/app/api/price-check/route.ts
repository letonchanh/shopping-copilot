// Fetches current and lowest Amazon price for a product by ASIN.
// Downloads the CamelCamelCamel chart image (which includes a legend with
// Lowest, Highest, Current prices) and uses Gemini vision to extract them.

import { NextRequest, NextResponse } from "next/server";

const LLM_BASE_URL =
  process.env.LLM_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta/openai";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.0-flash";

interface CachedPrice {
  currentPrice: number;
  lowestPrice: number;
  ts: number;
}

// In-memory cache: ASIN -> prices
const cache = new Map<string, CachedPrice>();
const CACHE_TTL = 3600_000; // 1 hour

async function extractPricesFromChart(
  asin: string,
): Promise<{ currentPrice: number; lowestPrice: number } | null> {
  // Download the CamelCamelCamel chart with legend (contains Lowest/Highest/Current)
  const chartUrl = `https://charts.camelcamelcamel.com/us/${asin}/amazon-new.png?force=1&zero=0&w=500&h=200&desired=false&legend=1&ilt=1&tp=all&fo=0`;

  const chartRes = await fetch(chartUrl);
  if (!chartRes.ok) return null;

  const chartBuffer = await chartRes.arrayBuffer();
  const size = chartBuffer.byteLength;
  // Error/placeholder images from CamelCamelCamel are small (~8-9KB)
  if (size < 10000) return null;

  const base64 = Buffer.from(chartBuffer).toString("base64");

  // Use vision LLM to extract prices from the chart legend
  const llmRes = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
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
              text: 'This is a CamelCamelCamel price history chart. Read the legend table at the bottom. First look for the "Amazon" row. If the Amazon row has no data or is missing, use the "3rd Party New" row instead. Return ONLY a JSON object with the "Current" price and "Lowest" price as numbers (no $ sign). Format: {"currentPrice":123.45,"lowestPrice":67.89}. If neither row has data, return {"currentPrice":null,"lowestPrice":null}.',
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

  // Extract JSON from the response (might be wrapped in markdown code block)
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

export async function GET(request: NextRequest) {
  const asin = request.nextUrl.searchParams.get("asin");
  console.log(`[price-check] GET request for asin=${asin}`);
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return NextResponse.json({ error: "Invalid ASIN" }, { status: 400 });
  }

  // Check in-memory cache first
  const cached = cache.get(asin);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[price-check] ${asin}: cache hit, current=$${cached.currentPrice}, lowest=$${cached.lowestPrice}`);
    return NextResponse.json(
      { asin, currentPrice: cached.currentPrice, lowestPrice: cached.lowestPrice },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      },
    );
  }

  try {
    const prices = await extractPricesFromChart(asin);

    if (!prices) {
      console.log(`[price-check] ${asin}: no prices extracted from chart`);
      return NextResponse.json(
        { error: "Price not found" },
        { status: 404 },
      );
    }

    // Store in cache
    cache.set(asin, { ...prices, ts: Date.now() });

    return NextResponse.json(
      { asin, ...prices },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    console.error(`Price check error for ${asin}:`, err);
    return NextResponse.json(
      { error: "Failed to check price" },
      { status: 502 },
    );
  }
}
