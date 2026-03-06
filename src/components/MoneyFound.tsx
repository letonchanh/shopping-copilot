"use client";

import { useMemo, useState, useCallback, useEffect } from "react";

// ── Types ──

interface AmazonItem {
  name: string;
  url?: string;
  price?: string;
}

interface AmazonOrder {
  orderId: string;
  orderDate: string;
  orderTotal: string;
  deliveryStatus: string;
  items: AmazonItem[];
}

interface PriceDropCandidate {
  name: string;
  asin: string;
  pricePaid: number;
  orderDate: string;
  orderId: string;
  daysAgo: number;
  chartUrl: string;
  productUrl: string;
  camelUrl: string;
}

interface DuplicatePurchase {
  name: string;
  purchases: { orderId: string; date: string; price: number }[];
  totalSpent: number;
}

interface SubscriptionCreep {
  name: string;
  asin?: string;
  count: number;
  prices: number[];
  avgPrice: number;
  totalSpent: number;
  lowestPrice: number;
  highestPrice: number;
  potentialSavings: number;
}

interface MoneyFoundProps {
  amazonOrders: AmazonOrder[];
}

// ── Helpers ──

function extractAsin(url: string): string | null {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/i)
    ?? url.match(/\/gp\/product\/([A-Z0-9]{10})/i)
    ?? url.match(/\/ASIN\/([A-Z0-9]{10})/i);
  return match ? match[1] : null;
}

function parsePrice(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function daysBetween(d1: Date, d2: Date): number {
  return Math.abs(Math.round((d1.getTime() - d2.getTime()) / 86400000));
}

function shortName(name: string): string {
  return name.length > 70 ? name.slice(0, 67) + "..." : name;
}

// ── Analysis ──

type PriceDropMode = "recent" | "expensive";

function analyzePriceDrops(orders: AmazonOrder[], mode: PriceDropMode): PriceDropCandidate[] {
  const now = new Date();
  const candidates: PriceDropCandidate[] = [];
  const seen = new Set<string>();

  for (const order of orders) {
    const orderDate = new Date(order.orderDate);
    const daysAgo = daysBetween(now, orderDate);
    if (mode === "recent" && daysAgo > 90) continue;

    for (const item of order.items) {
      if (!item.url || !item.price) continue;
      const asin = extractAsin(item.url);
      if (!asin || seen.has(asin)) continue;
      seen.add(asin);

      const price = parsePrice(item.price);
      if (price <= 0) continue;

      candidates.push({
        name: item.name,
        asin,
        pricePaid: price,
        orderDate: order.orderDate,
        orderId: order.orderId,
        daysAgo,
        chartUrl: `https://charts.camelcamelcamel.com/us/${asin}/amazon-new.png?force=1&zero=0&w=500&h=200&desired=false&legend=1&ilt=1&tp=all&fo=0`,
        productUrl: `https://www.amazon.com/dp/${asin}`,
        camelUrl: `https://camelcamelcamel.com/product/${asin}`,
      });
    }
  }

  if (mode === "expensive") {
    return candidates.sort((a, b) => b.pricePaid - a.pricePaid);
  }
  return candidates.sort((a, b) => a.daysAgo - b.daysAgo);
}

function analyzeDuplicates(orders: AmazonOrder[]): DuplicatePurchase[] {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  // Group items by ASIN within last 30 days
  const groups = new Map<string, { name: string; purchases: { orderId: string; date: string; price: number }[] }>();

  for (const order of orders) {
    const orderDate = new Date(order.orderDate);
    if (orderDate < thirtyDaysAgo) continue;
    if (order.deliveryStatus?.toLowerCase().includes("cancel")) continue;

    for (const item of order.items) {
      const key = item.url ? (extractAsin(item.url) ?? item.name.toLowerCase().slice(0, 50)) : item.name.toLowerCase().slice(0, 50);
      const price = parsePrice(item.price);

      if (!groups.has(key)) {
        groups.set(key, { name: item.name, purchases: [] });
      }
      groups.get(key)!.purchases.push({
        orderId: order.orderId,
        date: order.orderDate,
        price,
      });
    }
  }

  return [...groups.values()]
    .filter((g) => g.purchases.length >= 2)
    .map((g) => ({
      name: g.name,
      purchases: g.purchases,
      totalSpent: g.purchases.reduce((sum, p) => sum + p.price, 0),
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
}

function analyzeSubscriptionCreep(orders: AmazonOrder[]): SubscriptionCreep[] {
  const groups = new Map<string, { name: string; asin?: string; prices: number[] }>();

  for (const order of orders) {
    if (order.deliveryStatus?.toLowerCase().includes("cancel")) continue;

    for (const item of order.items) {
      const asin = item.url ? extractAsin(item.url) : null;
      const key = asin ?? item.name.toLowerCase().slice(0, 50);
      const price = parsePrice(item.price);
      if (price <= 0) continue;

      if (!groups.has(key)) {
        groups.set(key, { name: item.name, asin: asin ?? undefined, prices: [] });
      }
      groups.get(key)!.prices.push(price);
    }
  }

  return [...groups.values()]
    .filter((g) => g.prices.length >= 3)
    .map((g) => {
      const sorted = [...g.prices].sort((a, b) => a - b);
      const avg = g.prices.reduce((a, b) => a + b, 0) / g.prices.length;
      const total = g.prices.reduce((a, b) => a + b, 0);
      const lowest = sorted[0];
      const highest = sorted[sorted.length - 1];
      const savings = total - lowest * g.prices.length;
      return {
        name: g.name,
        asin: g.asin,
        count: g.prices.length,
        prices: g.prices,
        avgPrice: avg,
        totalSpent: total,
        lowestPrice: lowest,
        highestPrice: highest,
        potentialSavings: savings,
      };
    })
    .filter((g) => g.potentialSavings > 1)
    .sort((a, b) => b.potentialSavings - a.potentialSavings);
}

// ── Component ──

export default function MoneyFound({ amazonOrders }: MoneyFoundProps) {
  const [expandedChart, setExpandedChart] = useState<string | null>(null);
  const [chartErrors, setChartErrors] = useState<Set<string>>(new Set());
  const [chartBlobUrls, setChartBlobUrls] = useState<Map<string, string>>(new Map());
  const [currentPrices, setCurrentPrices] = useState<Map<string, { current: number; lowest: number }>>(new Map());
  const [priceDropMode, setPriceDropMode] = useState<PriceDropMode>("recent");

  const handleChartError = useCallback((asin: string) => {
    setChartErrors((prev) => new Set(prev).add(asin));
  }, []);

  const priceDrops = useMemo(() => analyzePriceDrops(amazonOrders, priceDropMode), [amazonOrders, priceDropMode]);
  const duplicates = useMemo(() => analyzeDuplicates(amazonOrders), [amazonOrders]);
  const subscriptions = useMemo(() => analyzeSubscriptionCreep(amazonOrders), [amazonOrders]);

  // Fetch chart images client-side (browser has residential IP, avoids
  // CamelCamelCamel blocking cloud IPs). Each chart is fetched once:
  // - blob URL stored for <img> display
  // - base64 sent to /api/price-check for LLM price extraction
  const [pricesLoading, setPricesLoading] = useState(false);
  useEffect(() => {
    const items = priceDrops.slice(0, 10);
    if (items.length === 0) return;
    let cancelled = false;
    const blobUrlsToRevoke: string[] = [];

    async function fetchPrices() {
      setPricesLoading(true);
      const priceMap = new Map<string, { current: number; lowest: number }>();
      const blobMap = new Map<string, string>();

      for (const p of items) {
        if (cancelled) return;
        try {
          const chartUrl = `https://charts.camelcamelcamel.com/us/${p.asin}/amazon-new.png?force=1&zero=0&w=500&h=200&desired=false&legend=1&ilt=1&tp=all&fo=0`;
          const imgRes = await fetch(chartUrl);
          if (!imgRes.ok) continue;
          const buf = await imgRes.arrayBuffer();
          if (buf.byteLength < 10000) continue;

          // Store blob URL for chart display
          const blob = new Blob([buf], { type: "image/png" });
          const blobUrl = URL.createObjectURL(blob);
          blobMap.set(p.asin, blobUrl);
          blobUrlsToRevoke.push(blobUrl);
          if (!cancelled) setChartBlobUrls(new Map(blobMap));

          // Convert to base64 and send to server for LLM extraction
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const imageBase64 = btoa(binary);

          const res = await fetch("/api/price-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asin: p.asin, imageBase64 }),
          });
          if (res.ok) {
            const data = await res.json();
            if (typeof data.currentPrice === "number") {
              priceMap.set(p.asin, {
                current: data.currentPrice,
                lowest: typeof data.lowestPrice === "number" ? data.lowestPrice : data.currentPrice,
              });
              if (!cancelled) setCurrentPrices(new Map(priceMap));
            }
          }
        } catch { /* skip failed items */ }
        if (!cancelled) await new Promise((r) => setTimeout(r, 1500));
      }

      if (!cancelled) setPricesLoading(false);
    }

    void fetchPrices();
    return () => {
      cancelled = true;
      blobUrlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [priceDrops]);

  const totalPotentialSavings = subscriptions.reduce((sum, s) => sum + s.potentialSavings, 0);

  // Count price drop savings (items where you paid less than current price)
  const priceDropSavings = useMemo(() => {
    let saved = 0;
    let cheaper = 0;
    for (const p of priceDrops.slice(0, 10)) {
      const cp = currentPrices.get(p.asin);
      if (cp == null) continue;
      const diff = cp.current - p.pricePaid;
      if (diff > 0.5) saved += diff;
      if (diff < -0.5) cheaper += Math.abs(diff);
    }
    return { saved, cheaper };
  }, [priceDrops, currentPrices]);

  const hasContent = priceDrops.length > 0 || duplicates.length > 0 || subscriptions.length > 0;

  if (!hasContent) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>&#x2705;</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No issues found</div>
        <div style={{ fontSize: 13, color: "#52525b" }}>
          Your shopping looks clean — no duplicates or repeat overspending detected.
        </div>
      </div>
    );
  }

  const checkedCount = currentPrices.size;
  const totalToCheck = Math.min(priceDrops.length, 10);

  return (
    <div className="money-found">
      {/* Summary banner */}
      <div className="mf-banner">
        <div className="mf-banner-icon">$</div>
        <div className="mf-banner-content">
          <div className="mf-banner-title">Money Found</div>
          <div className="mf-banner-stats">
            {priceDropSavings.saved > 0 && (
              <div className="mf-stat-pill mf-stat-green">
                <span className="mf-stat-value">${priceDropSavings.saved.toFixed(0)}</span>
                <span className="mf-stat-label">saved</span>
              </div>
            )}
            {priceDropSavings.cheaper > 0 && (
              <div className="mf-stat-pill mf-stat-red">
                <span className="mf-stat-value">${priceDropSavings.cheaper.toFixed(0)}</span>
                <span className="mf-stat-label">cheaper now</span>
              </div>
            )}
            {totalPotentialSavings > 0 && (
              <div className="mf-stat-pill mf-stat-amber">
                <span className="mf-stat-value">${totalPotentialSavings.toFixed(0)}</span>
                <span className="mf-stat-label">potential savings</span>
              </div>
            )}
            {duplicates.length > 0 && (
              <div className="mf-stat-pill mf-stat-red">
                <span className="mf-stat-value">{duplicates.length}</span>
                <span className="mf-stat-label">duplicate{duplicates.length > 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Price drop checker */}
      {priceDrops.length > 0 && (
        <div className="card">
          <div className="mf-section-top">
            <div className="section-header" style={{ marginBottom: 0 }}>
              <span className="mf-section-badge mf-badge-green">&#x2193;</span>
              Price Drop Checker
            </div>
            <div className="mf-toggle">
              <button
                type="button"
                className={`mf-toggle-btn ${priceDropMode === "recent" ? "mf-toggle-active" : ""}`}
                onClick={() => setPriceDropMode("recent")}
              >
                Last 90 Days
              </button>
              <button
                type="button"
                className={`mf-toggle-btn ${priceDropMode === "expensive" ? "mf-toggle-active" : ""}`}
                onClick={() => setPriceDropMode("expensive")}
              >
                Most Expensive
              </button>
            </div>
          </div>

          {pricesLoading && (
            <div className="mf-progress">
              <div className="mf-progress-bar" style={{ width: `${totalToCheck > 0 ? (checkedCount / totalToCheck) * 100 : 0}%` }} />
              <span className="mf-progress-text">Checking prices... {checkedCount}/{totalToCheck}</span>
            </div>
          )}

          <div className="mf-cards">
            {priceDrops.slice(0, 10).map((p) => {
              const priceData = currentPrices.get(p.asin);
              const savings = priceData != null ? priceData.current - p.pricePaid : null;

              return (
              <div key={p.asin} className="mf-card-item">
                <div className="mf-card-top-row">
                  <span className="mf-item-name">{shortName(p.name)}</span>
                  {savings != null && savings > 0.5 ? (
                    <span className="mf-item-tag mf-tag-green">
                      You saved ${savings.toFixed(2)}
                    </span>
                  ) : savings != null && savings < -0.5 ? (
                    <span className="mf-item-tag mf-tag-red">
                      ${Math.abs(savings).toFixed(2)} cheaper
                    </span>
                  ) : priceData == null && pricesLoading ? (
                    <span className="mf-item-tag mf-tag-default">
                      <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                    </span>
                  ) : (
                    <span className="mf-item-tag mf-tag-default">
                      ${p.pricePaid.toFixed(2)}
                    </span>
                  )}
                </div>

                {priceData != null ? (
                  <div className="mf-price-row">
                    <div className="mf-price-cell">
                      <span className="mf-price-label">Paid</span>
                      <span className="mf-price-value">${p.pricePaid.toFixed(2)}</span>
                    </div>
                    <div className={`mf-price-arrow ${savings != null && savings > 0.5 ? "mf-price-up" : savings != null && savings < -0.5 ? "mf-price-down" : "mf-price-neutral"}`}>
                      {savings != null && savings > 0.5 ? "\u2191" : savings != null && savings < -0.5 ? "\u2193" : "="}
                    </div>
                    <div className="mf-price-cell">
                      <span className="mf-price-label">Now</span>
                      <span className={`mf-price-value ${savings != null && savings > 0.5 ? "mf-price-up" : savings != null && savings < -0.5 ? "mf-price-down" : ""}`}>
                        ${priceData.current.toFixed(2)}
                      </span>
                    </div>
                    <div className="mf-price-cell">
                      <span className="mf-price-label">Lowest</span>
                      <span className="mf-price-value">
                        {priceData.lowest > 0
                          ? `$${priceData.lowest.toFixed(2)}`
                          : "\u2014"}
                      </span>
                    </div>
                    <div className="mf-price-cell">
                      <span className="mf-price-label">When</span>
                      <span className="mf-price-value mf-price-date">{p.daysAgo}d ago</span>
                    </div>
                  </div>
                ) : !pricesLoading ? (
                  <div className="mf-price-row">
                    <div className="mf-price-cell">
                      <span className="mf-price-label">Paid</span>
                      <span className="mf-price-value">${p.pricePaid.toFixed(2)}</span>
                    </div>
                    <div className="mf-price-arrow" style={{ visibility: "hidden" }}>=</div>
                    <div className="mf-price-cell">
                      <span className="mf-price-label">Now</span>
                      <span className="mf-price-value">{"\u2014"}</span>
                    </div>
                    <div className="mf-price-cell">
                      <span className="mf-price-label">Lowest</span>
                      <span className="mf-price-value">{"\u2014"}</span>
                    </div>
                    <div className="mf-price-cell">
                      <span className="mf-price-label">When</span>
                      <span className="mf-price-value mf-price-date">
                        {new Date(p.orderDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="mf-item-actions">
                  <button
                    type="button"
                    className="mf-action-btn"
                    onClick={() => setExpandedChart(expandedChart === p.asin ? null : p.asin)}
                  >
                    {expandedChart === p.asin ? "Hide chart" : "Price chart"}
                  </button>
                  <a href={p.camelUrl} target="_blank" rel="noopener noreferrer" className="mf-action-btn">
                    CamelCamelCamel
                  </a>
                  <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="mf-action-btn">
                    Amazon
                  </a>
                </div>
                {expandedChart === p.asin && (
                  <div className="mf-chart">
                    {chartErrors.has(p.asin) ? (
                      <div className="mf-chart-unavailable">
                        No price history available.{" "}
                        <a href={p.camelUrl} target="_blank" rel="noopener noreferrer" className="mf-link">
                          Check on CamelCamelCamel
                        </a>
                      </div>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={chartBlobUrls.get(p.asin) ?? p.chartUrl}
                          alt={`Price history for ${p.name}`}
                          className="mf-chart-img"
                          loading="lazy"
                          onError={() => handleChartError(p.asin)}
                        />
                        <div className="mf-chart-caption">
                          Paid <strong>${p.pricePaid.toFixed(2)}</strong> on{" "}
                          {new Date(p.orderDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Duplicate purchases */}
      {duplicates.length > 0 && (
        <div className="card">
          <div className="section-header">
            <span className="mf-section-badge mf-badge-red">!</span>
            Duplicate Purchases
            <span className="mf-section-count">{duplicates.length} in last 30 days</span>
          </div>
          <div className="mf-cards">
            {duplicates.map((d, i) => (
              <div key={i} className="mf-card-item">
                <div className="mf-card-top-row">
                  <span className="mf-item-name">{shortName(d.name)}</span>
                  <span className="mf-item-tag mf-tag-red">
                    {d.purchases.length}x &middot; ${d.totalSpent.toFixed(2)}
                  </span>
                </div>
                <div className="mf-item-detail">
                  Bought {d.purchases.length} times in 30 days. Consider canceling or returning the duplicate.
                </div>
                <div className="mf-item-actions">
                  {d.purchases.map((p, j) => (
                    <a
                      key={j}
                      href={`https://www.amazon.com/gp/your-account/order-details?orderID=${p.orderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mf-action-btn"
                    >
                      Order {j + 1} ({new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription creep */}
      {subscriptions.length > 0 && (
        <div className="card">
          <div className="section-header">
            <span className="mf-section-badge mf-badge-amber">$</span>
            Subscription Creep
            {totalPotentialSavings > 0 && (
              <span className="mf-section-count">Save up to ${totalPotentialSavings.toFixed(0)}</span>
            )}
          </div>
          <div className="mf-cards">
            {subscriptions.slice(0, 8).map((s, i) => (
              <div key={i} className="mf-card-item">
                <div className="mf-card-top-row">
                  <span className="mf-item-name">{shortName(s.name)}</span>
                  <span className="mf-item-tag mf-tag-amber">
                    Save ${s.potentialSavings.toFixed(0)}
                  </span>
                </div>
                <div className="mf-price-row">
                  <div className="mf-price-cell">
                    <span className="mf-price-label">Bought</span>
                    <span className="mf-price-value">{s.count}x</span>
                  </div>
                  <div className="mf-price-cell">
                    <span className="mf-price-label">Low</span>
                    <span className="mf-price-value">${s.lowestPrice.toFixed(2)}</span>
                  </div>
                  <div className="mf-price-cell">
                    <span className="mf-price-label">High</span>
                    <span className="mf-price-value">${s.highestPrice.toFixed(2)}</span>
                  </div>
                  <div className="mf-price-cell">
                    <span className="mf-price-label">Total</span>
                    <span className="mf-price-value">${s.totalSpent.toFixed(2)}</span>
                  </div>
                </div>
                {s.asin && (
                  <div className="mf-item-actions">
                    <a
                      href={`https://camelcamelcamel.com/product/${s.asin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mf-action-btn"
                    >
                      Price history
                    </a>
                    <a
                      href={`https://www.amazon.com/dp/${s.asin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mf-action-btn"
                    >
                      Current price
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
