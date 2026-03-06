import { NextResponse } from "next/server";
import { llmConfig } from "@/config";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function POST(request: Request) {
  if (!llmConfig.apiKey) {
    return NextResponse.json(
      { error: "LLM_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const { messages, shoppingData } = (await request.json()) as {
    messages: ChatMessage[];
    shoppingData: string;
  };

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 },
    );
  }

  const systemMessage: ChatMessage = {
    role: "system",
    content: `You are a concise shopping assistant with access to the user's order history below.

Rules:
- Keep answers short and well-structured. Use bullet lists for multiple items.
- Use **bold** for item names and prices. Use short item names (drop long modifiers).
- When listing items, include: short name, price, date. Group duplicates.
- For price questions, search ALL orders. Show the cheapest/most expensive match.
- Ignore $0.00 items for price comparisons — those are typically returns, refunds, or free replacements. Mention them separately only if the user specifically asks.
- Items with status "Cancelled" or "Return complete" are not real purchases — exclude them from spending/price analysis unless asked.
- If no exact match, suggest the closest matches.
- Never dump raw JSON. Summarize the data in readable form.
- Use $ for currency amounts. Format dates as "Mon DD, YYYY".
- ALWAYS include a link to the order when mentioning items:
  - Amazon: build the order link from orderId: https://www.amazon.com/gp/your-account/order-details?orderID={orderId}. The item "url" field is a product page, NOT an order page — do not use it as the order link.
  - Shopify: use the "detailUrl" field from the order.
  Format as markdown: [View order](url).

Shopping Data:
${shoppingData}`,
  };

  const body = JSON.stringify({
    model: llmConfig.model,
    messages: [systemMessage, ...messages],
    stream: true,
  });

  const res = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[POST /api/chat] LLM error:", res.status, text);
    return NextResponse.json(
      { error: `LLM request failed: ${res.status}` },
      { status: 502 },
    );
  }

  // Stream the response through
  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
