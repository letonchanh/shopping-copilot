"use client";

// useVanaData() manages the full connect -> poll -> fetch-data lifecycle.
// initConnect() starts a session, the hook polls until approved, then
// fetchData() calls /api/data with the grant to retrieve user data.

import type { ConnectionStatus } from "@opendatalabs/connect/core";
import { useVanaData } from "@opendatalabs/connect/react";
import { useEffect, useState, useCallback, useMemo } from "react";
import ShoppingChat from "./ShoppingChat";
import MoneyFound from "./MoneyFound";

// ────────────────────────────────────────────────
// Types for order data from connectors
// ────────────────────────────────────────────────

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

interface ShopOrder {
  id: string;
  orderNumber: string;
  placedAt: string;
  merchantName: string;
  total: number | null;
  currency: string;
  status: string;
  itemCount: number | null;
  lineItemTitles?: string[];
  detailUrl: string;
}

interface NormalizedOrder {
  id: string;
  date: Date;
  total: number;
  currency: string;
  source: "amazon" | "shopify";
  items: string[];
  merchant: string;
  status: string;
}

interface Insights {
  totalSpent: number;
  orderCount: number;
  totalItems: number;
  avgOrderValue: number;
  topItems: { name: string; count: number }[];
  monthlySpending: { month: string; amount: number }[];
  topMerchants: { name: string; total: number; count: number }[];
  wasteAlerts: string[];
  funFacts: string[];
  persona: { emoji: string; name: string; description: string };
  sourceCounts: { amazon: number; shopify: number };
  busiestMonth: { month: string; amount: number; count: number } | null;
  mostExpensiveOrder: { total: number; date: Date; items: string[] } | null;
  shoppingStreak: number;
  avgDaysBetweenOrders: number;
  favoriteDay: string;
  priceRanges: { range: string; count: number; total: number }[];
  categories: { name: string; count: number; total: number }[];
}

// ────────────────────────────────────────────────
// Status display config
// ────────────────────────────────────────────────

const STATUS_DISPLAY: Record<
  ConnectionStatus,
  { dot: string; label: string; className: string }
> = {
  idle: { dot: "\u25CB", label: "Idle", className: "status-default" },
  connecting: {
    dot: "\u25CB",
    label: "Connecting",
    className: "status-default",
  },
  waiting: {
    dot: "\u25CB",
    label: "Waiting for approval",
    className: "status-waiting",
  },
  approved: { dot: "\u25CF", label: "Approved", className: "status-approved" },
  denied: { dot: "\u25CF", label: "Denied", className: "status-denied" },
  expired: { dot: "\u25CF", label: "Expired", className: "status-expired" },
  error: { dot: "\u25CF", label: "Error", className: "status-error" },
};

// ────────────────────────────────────────────────
// Normalize orders from both sources
// ────────────────────────────────────────────────

function parsePrice(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function normalizeAmazonOrders(
  orders: AmazonOrder[] | undefined,
): NormalizedOrder[] {
  if (!orders) return [];
  return orders.map((o) => ({
    id: o.orderId,
    date: new Date(o.orderDate),
    total: parsePrice(o.orderTotal),
    currency: "USD",
    source: "amazon" as const,
    items: o.items?.map((i) => i.name) ?? [],
    merchant: "Amazon",
    status: o.deliveryStatus,
  }));
}

function normalizeShopOrders(
  orders: ShopOrder[] | undefined,
): NormalizedOrder[] {
  if (!orders) return [];
  return orders.map((o) => ({
    id: o.id,
    date: new Date(o.placedAt),
    total: o.total ?? 0,
    currency: o.currency || "USD",
    source: "shopify" as const,
    items: o.lineItemTitles ?? [],
    merchant: o.merchantName || "Unknown shop",
    status: o.status,
  }));
}

// ────────────────────────────────────────────────
// Item category classifier (keyword-based)
// ────────────────────────────────────────────────

const CATEGORY_RULES: [string, RegExp][] = [
  ["Electronics", /\b(phone|laptop|tablet|computer|monitor|keyboard|mouse|headphone|earphone|earbud|speaker|charger|cable|usb|hdmi|adapter|battery|power bank|camera|drone|tv|television|projector|router|modem|hard drive|ssd|ram|gpu|cpu|printer|scanner|smartwatch|fitbit|garmin|airpod|ipad|macbook|kindle|echo|alexa|roku|fire stick|chromecast|nintendo|playstation|xbox|controller|gopro|ring doorbell|nest)\b/i],
  ["Books & Media", /\b(book|novel|textbook|paperback|hardcover|audiobook|ebook|kindle edition|magazine|comic|manga|dvd|blu-ray|vinyl|cd album)\b/i],
  ["Clothing & Shoes", /\b(shirt|tshirt|t-shirt|pants|jeans|shorts|dress|skirt|jacket|coat|hoodie|sweater|blouse|sock|underwear|boxers|bra|shoe|sneaker|boot|sandal|slipper|hat|cap|beanie|scarf|glove|belt|tie|legging|swimsuit|bikini|pajama)\b/i],
  ["Home & Kitchen", /\b(pillow|blanket|sheet|towel|curtain|rug|mat|lamp|light bulb|candle|vase|frame|shelf|organizer|storage|basket|hanger|iron|vacuum|broom|mop|dish|plate|bowl|cup|mug|glass|pot|pan|skillet|knife|cutting board|blender|mixer|toaster|coffee maker|kettle|air fryer|instant pot|microwave|utensil|spatula|ladle|container|tupperware|trash bag|detergent|soap|cleaner|sponge)\b/i],
  ["Health & Beauty", /\b(vitamin|supplement|protein|medicine|first aid|bandage|thermometer|mask|sanitizer|shampoo|conditioner|lotion|moisturizer|sunscreen|deodorant|perfume|cologne|makeup|mascara|lipstick|foundation|concealer|brush set|nail polish|razor|trimmer|toothbrush|toothpaste|floss|mouthwash|skincare|serum|face wash|eye cream)\b/i],
  ["Food & Grocery", /\b(snack|chip|cookie|cracker|candy|chocolate|gum|nut|almond|granola|cereal|oatmeal|rice|pasta|sauce|oil|vinegar|spice|seasoning|salt|pepper|sugar|flour|tea|coffee|water|juice|soda|energy drink|protein bar|jerky|dried fruit|honey|jam|syrup|canned|frozen)\b/i],
  ["Toys & Games", /\b(toy|lego|puzzle|board game|card game|doll|action figure|stuffed animal|plush|nerf|playset|building block|remote control car|model kit|craft kit)\b/i],
  ["Pet Supplies", /\b(dog food|cat food|pet|puppy|kitten|leash|collar|pet bed|litter|chew toy|treat|aquarium|fish food|bird seed)\b/i],
  ["Office & School", /\b(pen|pencil|marker|notebook|binder|folder|stapler|tape|sticky note|paper|envelope|stamp|desk|chair|whiteboard|backpack|calculator|planner|calendar|label)\b/i],
  ["Sports & Outdoors", /\b(yoga|dumbbell|weight|resistance band|jump rope|treadmill|bike|bicycle|helmet|tent|sleeping bag|hiking|camping|fishing|golf|basketball|football|soccer|baseball|tennis|racket|swim|water bottle|cooler|grill|kayak)\b/i],
  ["Baby & Kids", /\b(baby|infant|toddler|diaper|wipe|pacifier|bottle|formula|stroller|car seat|crib|high chair|baby monitor|bib|onesie)\b/i],
  ["Auto & Tools", /\b(car|auto|motor oil|tire|wrench|screwdriver|drill|saw|hammer|plier|toolbox|measuring tape|flashlight|glue gun|paint|sandpaper|bolt|screw|nut)\b/i],
  ["Gift Cards", /\b(gift card|gift certificate|e-gift|egift)\b/i],
];

function categorizeItem(name: string): string {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return "Other";
}

// ────────────────────────────────────────────────
// Analyze orders and generate insights
// ────────────────────────────────────────────────

function analyzeOrders(orders: NormalizedOrder[]): Insights {
  const sorted = [...orders].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  const totalSpent = sorted.reduce((sum, o) => sum + o.total, 0);
  const orderCount = sorted.length;
  const avgOrderValue = orderCount > 0 ? totalSpent / orderCount : 0;

  // Count items
  const itemCounts = new Map<string, number>();
  for (const o of sorted) {
    for (const item of o.items) {
      const key = item.toLowerCase().slice(0, 60);
      itemCounts.set(key, (itemCounts.get(key) ?? 0) + 1);
    }
  }
  const topItems = [...itemCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Monthly spending (last 12 months)
  const monthlyMap = new Map<string, number>();
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, 0);
  }
  for (const o of sorted) {
    const key = `${o.date.getFullYear()}-${String(o.date.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap.has(key)) {
      monthlyMap.set(key, monthlyMap.get(key)! + o.total);
    }
  }
  const monthlySpending = [...monthlyMap.entries()].map(([month, amount]) => ({
    month,
    amount,
  }));

  // Top merchants
  const merchantMap = new Map<string, { total: number; count: number }>();
  for (const o of sorted) {
    const existing = merchantMap.get(o.merchant) ?? { total: 0, count: 0 };
    existing.total += o.total;
    existing.count++;
    merchantMap.set(o.merchant, existing);
  }
  const topMerchants = [...merchantMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([name, { total, count }]) => ({ name, total, count }));

  // Waste detection: find duplicate/repeat purchases
  const wasteAlerts: string[] = [];
  const recentItems = new Map<string, number>();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  for (const o of sorted) {
    if (o.date >= thirtyDaysAgo) {
      for (const item of o.items) {
        const key = item.toLowerCase().slice(0, 60);
        recentItems.set(key, (recentItems.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [item, count] of recentItems) {
    if (count >= 3) {
      wasteAlerts.push(
        `You bought "${item}" ${count} times in the last 30 days`,
      );
    }
  }
  if (wasteAlerts.length === 0 && avgOrderValue > 100) {
    wasteAlerts.push(
      `Your average order is $${avgOrderValue.toFixed(0)}. Consider batching smaller purchases.`,
    );
  }

  // Source counts
  const sourceCounts = {
    amazon: sorted.filter((o) => o.source === "amazon").length,
    shopify: sorted.filter((o) => o.source === "shopify").length,
  };

  // Total items
  const totalItems = sorted.reduce((sum, o) => sum + o.items.length, 0);

  // Busiest month
  let busiestMonth: Insights["busiestMonth"] = null;
  const monthCountMap = new Map<string, { amount: number; count: number }>();
  for (const o of sorted) {
    const key = `${o.date.getFullYear()}-${String(o.date.getMonth() + 1).padStart(2, "0")}`;
    const existing = monthCountMap.get(key) ?? { amount: 0, count: 0 };
    existing.amount += o.total;
    existing.count++;
    monthCountMap.set(key, existing);
  }
  for (const [month, data] of monthCountMap) {
    if (!busiestMonth || data.amount > busiestMonth.amount) {
      busiestMonth = { month, amount: data.amount, count: data.count };
    }
  }

  // Most expensive single order
  let mostExpensiveOrder: Insights["mostExpensiveOrder"] = null;
  for (const o of sorted) {
    if (!mostExpensiveOrder || o.total > mostExpensiveOrder.total) {
      mostExpensiveOrder = { total: o.total, date: o.date, items: o.items };
    }
  }

  // Shopping streak (consecutive months)
  const sortedMonthKeys = [...monthCountMap.keys()].sort();
  let streak = 0;
  let maxStreak = 0;
  for (let i = 0; i < sortedMonthKeys.length; i++) {
    if (i === 0) { streak = 1; }
    else {
      const [py, pm] = sortedMonthKeys[i - 1].split("-").map(Number);
      const [cy, cm] = sortedMonthKeys[i].split("-").map(Number);
      if ((cy * 12 + cm) - (py * 12 + pm) === 1) streak++;
      else streak = 1;
    }
    maxStreak = Math.max(maxStreak, streak);
  }

  // Avg days between orders
  const daysBetween: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    daysBetween.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86400000);
  }
  const avgDaysBetweenOrders = daysBetween.length > 0
    ? daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length
    : 0;

  // Favorite day of week
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const o of sorted) weekdayCounts[o.date.getDay()]++;
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const favoriteDay = dayNames[weekdayCounts.indexOf(Math.max(...weekdayCounts))];

  // Price range breakdown
  const ranges = [
    { range: "Under $10", min: 0, max: 10 },
    { range: "$10\u2013$25", min: 10, max: 25 },
    { range: "$25\u2013$50", min: 25, max: 50 },
    { range: "$50\u2013$100", min: 50, max: 100 },
    { range: "$100+", min: 100, max: Infinity },
  ];
  const priceRanges = ranges.map(({ range, min, max }) => {
    let count = 0;
    let total = 0;
    for (const o of sorted) {
      if (o.total >= min && o.total < max) { count++; total += o.total; }
    }
    return { range, count, total };
  }).filter((r) => r.count > 0);

  // Categories
  const categoryMap = new Map<string, { count: number; total: number }>();
  for (const o of sorted) {
    if (o.items.length === 0) {
      const cat = "Other";
      const existing = categoryMap.get(cat) ?? { count: 0, total: 0 };
      existing.count++;
      existing.total += o.total;
      categoryMap.set(cat, existing);
    } else {
      const perItemTotal = o.total / o.items.length;
      for (const item of o.items) {
        const cat = categorizeItem(item);
        const existing = categoryMap.get(cat) ?? { count: 0, total: 0 };
        existing.count++;
        existing.total += perItemTotal;
        categoryMap.set(cat, existing);
      }
    }
  }
  const categories = [...categoryMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, { count, total }]) => ({ name, count, total }));

  // Fun facts
  const funFacts = generateFunFacts(sorted, totalSpent, topItems);

  // Persona
  const persona = determinePersona(sorted, totalSpent, topItems);

  return {
    totalSpent,
    orderCount,
    totalItems,
    avgOrderValue,
    topItems,
    monthlySpending,
    topMerchants,
    wasteAlerts,
    funFacts,
    persona,
    sourceCounts,
    busiestMonth,
    mostExpensiveOrder,
    shoppingStreak: maxStreak,
    avgDaysBetweenOrders,
    favoriteDay,
    priceRanges,
    categories,
  };
}

function generateFunFacts(
  orders: NormalizedOrder[],
  totalSpent: number,
  topItems: { name: string; count: number }[],
): string[] {
  const facts: string[] = [];

  if (orders.length > 0) {
    const daysBetween: number[] = [];
    for (let i = 1; i < orders.length; i++) {
      const diff =
        (orders[i].date.getTime() - orders[i - 1].date.getTime()) / 86400000;
      daysBetween.push(diff);
    }
    if (daysBetween.length > 0) {
      const avgDays =
        daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length;
      facts.push(
        `You shop every ~${Math.round(avgDays)} days on average`,
      );
    }
  }

  if (totalSpent > 0) {
    const coffees = Math.round(totalSpent / 5.5);
    facts.push(`Total spending = ${coffees.toLocaleString()} cups of coffee`);
  }

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const o of orders) {
    weekdayCounts[o.date.getDay()]++;
  }
  const topDay = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (orders.length > 0) {
    facts.push(`${dayNames[topDay]} is your power shopping day`);
  }

  if (topItems.length > 0 && topItems[0].count > 1) {
    facts.push(
      `Your most re-purchased item: "${topItems[0].name}" (${topItems[0].count}x)`,
    );
  }

  return facts;
}

function determinePersona(
  orders: NormalizedOrder[],
  totalSpent: number,
  topItems: { name: string; count: number }[],
): { emoji: string; name: string; description: string } {
  if (orders.length === 0) {
    return {
      emoji: "\uD83D\uDD0D",
      name: "The Window Shopper",
      description: "No orders yet! Your wallet thanks you.",
    };
  }

  const avgTotal = totalSpent / orders.length;
  const hasRepeats = topItems.some((i) => i.count >= 3);
  const uniqueMerchants = new Set(orders.map((o) => o.merchant)).size;

  if (hasRepeats && avgTotal < 30) {
    return {
      emoji: "\uD83D\uDD01",
      name: "The Creature of Habit",
      description:
        "You know what you like and you stick to it. Consistency is your superpower (and your cart proves it).",
    };
  }

  if (uniqueMerchants >= 10) {
    return {
      emoji: "\uD83C\uDF0D",
      name: "The Explorer",
      description: `${uniqueMerchants} different merchants! You're on a quest to try every store on the internet.`,
    };
  }

  if (avgTotal > 100) {
    return {
      emoji: "\uD83D\uDC8E",
      name: "The Connoisseur",
      description:
        "Quality over quantity. Your average order says you don't mess around with impulse buys.",
    };
  }

  if (orders.length > 50) {
    return {
      emoji: "\u26A1",
      name: "The Power Shopper",
      description: `${orders.length} orders! At this rate, delivery drivers know you by name.`,
    };
  }

  return {
    emoji: "\uD83D\uDED2",
    name: "The Balanced Buyer",
    description:
      "A healthy mix of smart purchases and the occasional treat. You've got this shopping thing figured out.",
  };
}

// ────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────

function InsightsDashboard({ insights, shoppingData, amazonOrders }: { insights: Insights; shoppingData: string; amazonOrders: AmazonOrder[] }) {
  const [tab, setTab] = useState<"wrapped" | "money" | "chat" | "raw">("wrapped");

  return (
    <div className="insights-container">
      <div className="insights-header">
        <h2>Your Shopping Insights</h2>
        <p>
          {insights.sourceCounts.amazon} Amazon + {insights.sourceCounts.shopify}{" "}
          Shopify orders analyzed
        </p>
      </div>

      <div className="tab-strip">
        <button
          type="button"
          className={`tab-btn ${tab === "wrapped" ? "tab-btn-active" : ""}`}
          onClick={() => setTab("wrapped")}
        >
          Shopping Wrapped
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === "money" ? "tab-btn-active" : ""}`}
          onClick={() => setTab("money")}
        >
          Money Found
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === "chat" ? "tab-btn-active" : ""}`}
          onClick={() => setTab("chat")}
        >
          Ask AI
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === "raw" ? "tab-btn-active" : ""}`}
          onClick={() => setTab("raw")}
        >
          Raw Data
        </button>
      </div>

      {tab === "wrapped" && <WrappedTab insights={insights} />}
      {tab === "money" && <MoneyFound amazonOrders={amazonOrders} />}
      {tab === "chat" && <ShoppingChat shoppingData={shoppingData} />}
      {tab === "raw" && <RawTab insights={insights} />}
    </div>
  );
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(year, month - 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function WrappedTab({ insights }: { insights: Insights }) {
  const handleShare = useCallback(() => {
    const text = [
      `My Shopping Wrapped: ${insights.persona.emoji} ${insights.persona.name}`,
      `${insights.orderCount} orders | $${insights.totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 })} spent`,
      ...insights.funFacts.map((f) => `- ${f}`),
      "",
      "Powered by Shopping Copilot",
    ].join("\n");

    if (navigator.share) {
      navigator.share({ title: "My Shopping Wrapped", text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }, [insights]);

  const maxMonthly = Math.max(...insights.monthlySpending.map((m) => m.amount), 1);
  const peakMonth = insights.busiestMonth?.month;
  const topMerchantMax = insights.topMerchants.length > 0 ? insights.topMerchants[0].total : 1;

  return (
    <div className="sw-flow">
      {/* ── Hero: persona + stats ── */}
      <div className="wrapped-card">
        <div className="wrapped-title">Shopping Wrapped</div>
        <div className="wrapped-subtitle">Your shopping personality, revealed</div>

        <div className="wrapped-persona">{insights.persona.emoji}</div>
        <div className="wrapped-persona-name">{insights.persona.name}</div>
        <div className="wrapped-persona-desc">
          {insights.persona.description}
        </div>

        <div className="sw-hero-stats">
          <div className="sw-hero-stat">
            <span className="sw-hero-num sw-c-purple">${insights.totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span className="sw-hero-label">spent</span>
          </div>
          <div className="sw-hero-divider" />
          <div className="sw-hero-stat">
            <span className="sw-hero-num sw-c-green">{insights.orderCount}</span>
            <span className="sw-hero-label">orders</span>
          </div>
          <div className="sw-hero-divider" />
          <div className="sw-hero-stat">
            <span className="sw-hero-num sw-c-amber">{insights.totalItems}</span>
            <span className="sw-hero-label">items</span>
          </div>
          <div className="sw-hero-divider" />
          <div className="sw-hero-stat">
            <span className="sw-hero-num sw-c-rose">${insights.avgOrderValue.toFixed(0)}</span>
            <span className="sw-hero-label">avg order</span>
          </div>
        </div>

        <button type="button" className="sw-share-btn" onClick={handleShare}>
          Share your Wrapped
        </button>
      </div>

      {/* ── Fun facts (the "wrapped reveal" section) ── */}
      <div className="sw-section">
        <div className="sw-section-header">
          <span className="sw-section-icon">{"#"}</span>
          Your Year in Numbers
        </div>
        <div className="sw-facts-grid">
          {insights.funFacts.map((fact, i) => (
            <div key={i} className="sw-fact-card">
              <span className="sw-fact-num">{i + 1}</span>
              <span className="sw-fact-text">{fact}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Insight highlight cards ── */}
      <div className="sw-insights">
        {insights.busiestMonth && (
          <div className="sw-insight-card sw-insight-purple">
            <div className="sw-insight-icon">{"\uD83D\uDCC8"}</div>
            <div className="sw-insight-body">
              <div className="sw-insight-label">Biggest Spending Month</div>
              <div className="sw-insight-value">{formatMonthLabel(insights.busiestMonth.month)}</div>
              <div className="sw-insight-detail">
                {insights.busiestMonth.count} order{insights.busiestMonth.count !== 1 ? "s" : ""} {"\u00b7"} ${insights.busiestMonth.amount.toFixed(0)}
              </div>
            </div>
          </div>
        )}

        {insights.mostExpensiveOrder && (
          <div className="sw-insight-card sw-insight-red">
            <div className="sw-insight-icon">{"\uD83D\uDCB8"}</div>
            <div className="sw-insight-body">
              <div className="sw-insight-label">Biggest Order</div>
              <div className="sw-insight-value">${insights.mostExpensiveOrder.total.toFixed(2)}</div>
              <div className="sw-insight-detail">
                {insights.mostExpensiveOrder.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {insights.mostExpensiveOrder.items.length > 0 && ` \u00b7 ${insights.mostExpensiveOrder.items.length} item${insights.mostExpensiveOrder.items.length !== 1 ? "s" : ""}`}
              </div>
            </div>
          </div>
        )}

        <div className="sw-insight-card sw-insight-green">
          <div className="sw-insight-icon">{"\uD83D\uDCC5"}</div>
          <div className="sw-insight-body">
            <div className="sw-insight-label">Power Shopping Day</div>
            <div className="sw-insight-value">{insights.favoriteDay}</div>
            <div className="sw-insight-detail">Your most active day of the week</div>
          </div>
        </div>

        {insights.avgDaysBetweenOrders > 0 && (
          <div className="sw-insight-card sw-insight-amber">
            <div className="sw-insight-icon">{"\u23F1\uFE0F"}</div>
            <div className="sw-insight-body">
              <div className="sw-insight-label">Shopping Frequency</div>
              <div className="sw-insight-value">Every ~{Math.round(insights.avgDaysBetweenOrders)} days</div>
              <div className="sw-insight-detail">
                {insights.shoppingStreak > 1
                  ? `${insights.shoppingStreak}-month shopping streak`
                  : "Average gap between orders"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Spending by category ── */}
      {insights.categories.length > 0 && (
        <div className="sw-section">
          <div className="sw-section-header">
            <span className="sw-section-icon">{"\uD83D\uDCCA"}</span>
            Spending by Category
          </div>
          <div className="sw-category-list">
            {insights.categories.slice(0, 5).map((cat) => {
              const pct = insights.totalSpent > 0 ? (cat.total / insights.totalSpent) * 100 : 0;
              return (
                <div key={cat.name} className="sw-category-row">
                  <div className="sw-category-name-row">
                    <span className="sw-category-name">{cat.name}</span>
                    <span className="sw-category-amount">
                      ${cat.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="sw-category-bar-track">
                    <div className="sw-category-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="sw-category-meta">
                    <span className="sw-category-count">{cat.count} item{cat.count !== 1 ? "s" : ""}</span>
                    <span className="sw-category-pct">{pct.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Monthly spending ── */}
      {insights.monthlySpending.length > 1 && (
        <div className="sw-section">
          <div className="sw-section-header">
            <span className="sw-section-icon">{"$"}</span>
            Monthly Spending
          </div>
          <div className="sw-monthly-bars">
            {insights.monthlySpending.map((m) => {
              const isPeak = m.month === peakMonth;
              return (
                <div key={m.month} className={`sw-bar-col ${isPeak ? "sw-bar-peak" : ""}`}>
                  <div className="sw-bar-amount">
                    {m.amount > 0
                      ? `$${m.amount >= 1000 ? `${(m.amount / 1000).toFixed(1)}k` : m.amount.toFixed(0)}`
                      : ""}
                  </div>
                  <div className="sw-bar-track">
                    <div
                      className={`sw-bar-fill ${isPeak ? "sw-bar-fill-peak" : ""}`}
                      style={{ height: `${Math.max((m.amount / maxMonthly) * 100, m.amount > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <div className="sw-bar-label">
                    {formatMonthLabel(m.month).split(" ")[0]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Top merchants with spending bars ── */}
      {insights.topMerchants.length > 0 && (
        <div className="sw-section">
          <div className="sw-section-header">
            <span className="sw-section-icon">{"\u2605"}</span>
            Top Merchants
          </div>
          <div className="sw-merchant-list">
            {insights.topMerchants.map((m, i) => {
              const pct = topMerchantMax > 0 ? (m.total / topMerchantMax) * 100 : 0;
              return (
                <div key={m.name} className="sw-merchant-row">
                  <span className="sw-merchant-rank">{i + 1}</span>
                  <div className="sw-merchant-info">
                    <div className="sw-merchant-name-row">
                      <span className="sw-merchant-name">{m.name}</span>
                      <span className="sw-merchant-amount">
                        ${m.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="sw-merchant-bar-track">
                      <div className="sw-merchant-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="sw-merchant-count">{m.count} order{m.count !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Order size breakdown ── */}
      {insights.priceRanges.length > 0 && (
        <div className="sw-section">
          <div className="sw-section-header">
            <span className="sw-section-icon">{"\u2261"}</span>
            Order Size Breakdown
          </div>
          <div className="sw-breakdown-rows">
            {insights.priceRanges.map((r) => {
              const pct = insights.orderCount > 0 ? (r.count / insights.orderCount) * 100 : 0;
              return (
                <div key={r.range} className="sw-breakdown-row">
                  <span className="sw-breakdown-range">{r.range}</span>
                  <div className="sw-breakdown-bar-track">
                    <div className="sw-breakdown-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="sw-breakdown-count">{r.count}</span>
                  <span className="sw-breakdown-total">${r.total.toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Most purchased ── */}
      {insights.topItems.length > 0 && (
        <div className="sw-section">
          <div className="sw-section-header">
            <span className="sw-section-icon">{"\u21BB"}</span>
            Most Purchased
          </div>
          <div className="sw-purchased-list">
            {insights.topItems.slice(0, 6).map((item, i) => (
              <div key={item.name} className="sw-purchased-row">
                <span className="sw-purchased-rank">{i + 1}</span>
                <span className="sw-purchased-name">{item.name}</span>
                <span className="sw-purchased-count">{item.count}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Waste alerts ── */}
      {insights.wasteAlerts.length > 0 && (
        <div className="sw-section sw-section-warn">
          <div className="sw-section-header sw-header-warn">
            <span className="sw-section-icon sw-icon-warn">{"!"}</span>
            Heads Up
          </div>
          {insights.wasteAlerts.map((alert, i) => (
            <div key={i} className="sw-alert-row">
              {alert}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RawTab({ insights }: { insights: Insights }) {
  return (
    <div className="card">
      <div className="section-header">Analysis Data</div>
      <pre className="pre-block" style={{ maxHeight: 500 }}>
        {JSON.stringify(insights, null, 2)}
      </pre>
    </div>
  );
}

// ────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────

const CACHE_KEY = "shopping-copilot-data";

export default function ConnectFlow() {
  const {
    status,
    grant,
    data,
    error,
    connectUrl,
    initConnect,
    fetchData,
    isLoading,
  } = useVanaData({ environment: "dev" });

  // Persist fetched data to sessionStorage so it survives refreshes
  const [cachedData, setCachedData] = useState<Record<string, unknown> | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(CACHE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // When new data arrives from the SDK, cache it
  useEffect(() => {
    if (data && typeof data === "object") {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
        setCachedData(data as Record<string, unknown>);
      } catch { /* storage full or unavailable */ }
    }
  }, [data]);

  // Use SDK data if available, otherwise fall back to cached data
  const effectiveData = data ?? cachedData;


  // Only auto-init the connect flow if there's no cached data
  useEffect(() => {
    if (cachedData) return; // skip connect — we already have data
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) {
        void initConnect();
      }
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [cachedData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-initialize when the user returns to this tab while stuck.
  useEffect(() => {
    if (cachedData) return; // no need to re-init if we have data
    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        (status === "waiting" || status === "error" || status === "expired")
      ) {
        void initConnect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [status, initConnect, cachedData]);

  const display = STATUS_DISPLAY[status];
  const sessionReady = !!connectUrl;
  const hasConnectFailure = !sessionReady && !!error;

  // Unwrap connector envelope once for reuse
  const unwrappedData = useMemo(() => {
    if (!effectiveData || typeof effectiveData !== "object") return null;
    const raw = effectiveData as Record<string, unknown>;
    return (raw.data && typeof raw.data === "object"
      ? raw.data
      : raw) as Record<string, unknown>;
  }, [effectiveData]);

  // Raw Amazon orders for MoneyFound component
  const rawAmazonOrders = useMemo(() => {
    if (!unwrappedData) return [];
    const amazonRaw = unwrappedData["amazon.orders"] as
      | { data?: { orders?: AmazonOrder[] }; orders?: AmazonOrder[] }
      | undefined;
    return amazonRaw?.data?.orders ?? amazonRaw?.orders ?? [];
  }, [unwrappedData]);

  // Process data into insights
  const insights = useMemo(() => {
    if (!unwrappedData) return null;

    const shopRaw = unwrappedData["shop.orders"] as
      | { data?: { orders?: ShopOrder[] }; orders?: ShopOrder[] }
      | undefined;

    const amazonOrders = normalizeAmazonOrders(rawAmazonOrders);
    const shopOrders = normalizeShopOrders(shopRaw?.data?.orders ?? shopRaw?.orders);
    const allOrders = [...amazonOrders, ...shopOrders].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );

    if (allOrders.length === 0) return null;

    return analyzeOrders(allOrders);
  }, [unwrappedData, rawAmazonOrders]);

  // Serialize order data for the chat LLM context (strip connector envelope metadata)
  const shoppingDataStr = useMemo(() => {
    if (!unwrappedData) return "";
    const slim: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(unwrappedData)) {
      const v = val as Record<string, unknown> | undefined;
      slim[key] = v?.data ?? v;
    }
    return JSON.stringify(slim, null, 2);
  }, [unwrappedData]);

  return (
    <div>
      {/* Pre-approval: connect section (hidden if we have cached data) */}
      {status !== "approved" && !insights && (
        <>
          <div className="card connect-section">
            <div className="connect-header">
              <div className="connect-icon connect-icon-amazon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/amazon.svg" alt="Amazon" width={22} height={22} />
              </div>
              <div>
                <div className="connect-title">Amazon Orders</div>
                <div className="connect-desc">
                  Order history and spending data
                </div>
              </div>
            </div>
            <div className="connect-header">
              <div className="connect-icon connect-icon-shopify">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/shop.svg" alt="Shop" width={22} height={22} />
              </div>
              <div>
                <div className="connect-title">Shopify / Shop App</div>
                <div className="connect-desc">
                  Orders from Shopify-powered stores
                </div>
              </div>
            </div>

            <div className="scope-pills">
              <span className="scope-pill">amazon.orders</span>
              <span className="scope-pill">amazon.profile</span>
              <span className="scope-pill">shop.orders</span>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="field-row">
                <span className="label">Status</span>
                <span className={`mono ${display.className}`}>
                  {display.dot} {display.label}
                </span>
              </div>
            </div>

            {sessionReady ? (
              <a
                href={connectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
                style={{
                  display: "inline-block",
                  boxSizing: "border-box",
                  fontSize: 14,
                  textDecoration: "none",
                  textAlign: "center",
                  width: "100%",
                }}
              >
                Connect with Vana
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void initConnect();
                }}
                disabled={isLoading}
                className="btn-primary"
                style={{ width: "100%" }}
              >
                {isLoading ? (
                  <>
                    <span className="spinner" /> Connecting stores...
                  </>
                ) : hasConnectFailure ? (
                  "Retry connection"
                ) : (
                  "Connect your stores"
                )}
              </button>
            )}
          </div>
        </>
      )}

      {/* Post-approval: loading or insights */}
      {status === "approved" && grant && !effectiveData && (
        <div className="card card-approved">
          <div style={{ marginBottom: 16 }}>
            <div className="field-row">
              <span className="label">Status</span>
              <span className={`mono ${display.className}`}>
                {display.dot} Connected
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchData}
            disabled={isLoading}
            className="btn-primary"
            style={{ width: "100%" }}
          >
            {isLoading ? (
              <>
                <span className="spinner" /> Analyzing your orders...
              </>
            ) : (
              "Analyze my shopping"
            )}
          </button>
        </div>
      )}

      {effectiveData && !insights && (
        <div className="card card-approved">
          <p style={{ fontSize: 14, color: "#a1a1aa", textAlign: "center" }}>
            No order data found. Make sure you have orders in your connected
            Amazon or Shopify accounts.
          </p>
        </div>
      )}

      {insights && <InsightsDashboard insights={insights} shoppingData={shoppingDataStr} amazonOrders={rawAmazonOrders} />}

      {/* Errors */}
      {error && (
        <div className="card card-error">
          <p className="text-error" style={{ margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {/* Reset */}
      {(insights || (status !== "idle" && status !== "connecting")) && (
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(CACHE_KEY);
            window.location.reload();
          }}
          className="btn-ghost"
          style={{ marginTop: 12 }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
