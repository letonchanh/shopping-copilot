"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ShoppingChatProps {
  shoppingData: string;
}

// Lightweight markdown-to-HTML for assistant messages:
// bold, italic, inline code, bullet lists, numbered lists, line breaks
function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Split into blocks by double newline
  const blocks = escaped.split(/\n{2,}/);

  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";

      // Check if block is a list (bullet or numbered)
      const lines = trimmed.split("\n");
      const isBulletList = lines.every((l) => /^\s*[\-\*]\s/.test(l));
      const isNumberedList = lines.every((l) => /^\s*\d+[\.\)]\s/.test(l));

      if (isBulletList) {
        const items = lines.map((l) =>
          `<li>${inlineFormat(l.replace(/^\s*[\-\*]\s/, ""))}</li>`,
        );
        return `<ul>${items.join("")}</ul>`;
      }

      if (isNumberedList) {
        const items = lines.map((l) =>
          `<li>${inlineFormat(l.replace(/^\s*\d+[\.\)]\s/, ""))}</li>`,
        );
        return `<ol>${items.join("")}</ol>`;
      }

      // Regular paragraph — preserve single newlines as <br>
      return `<p>${inlineFormat(trimmed).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

function inlineFormat(text: string): string {
  return (
    text
      // links [text](url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>')
      // bold **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      // italic *text* or _text_
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>")
      // inline code
      .replace(/`(.+?)`/g, "<code>$1</code>")
  );
}

export default function ShoppingChat({ shoppingData }: ShoppingChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || streaming) return;

      const userMsg: Message = { role: "user", content: text };
      const newMessages = [...messages, userMsg];
      // Add user message + empty assistant message (shows thinking indicator)
      setMessages([...newMessages, { role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: newMessages, shoppingData }),
        });

        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Request failed" }));
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: `Error: ${err.error || res.statusText}`,
            };
            return updated;
          });
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let assistantContent = "";

        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") break;
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                assistantContent += delta;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantContent,
                  };
                  return updated;
                });
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        ]);
      } finally {
        setStreaming(false);
        inputRef.current?.focus();
      }
    },
    [input, messages, shoppingData, streaming],
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      setInput(text);
      void sendMessage(text);
    },
    [sendMessage],
  );

  return (
    <div className="chat-container">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">?</div>
            <div className="chat-empty-title">Ask your shopping assistant</div>
            <div className="chat-empty-desc">
              I can help you find prices, track spending, spot patterns, and
              more.
            </div>
            <div className="chat-suggestions">
              <button
                type="button"
                className="chat-suggestion"
                onClick={() =>
                  handleSuggestion("What's the cheapest item I bought?")
                }
              >
                Cheapest item I bought?
              </button>
              <button
                type="button"
                className="chat-suggestion"
                onClick={() =>
                  handleSuggestion("How much did I spend last month?")
                }
              >
                Spending last month?
              </button>
              <button
                type="button"
                className="chat-suggestion"
                onClick={() =>
                  handleSuggestion(
                    "What items have I bought more than once? Show as a table.",
                  )
                }
              >
                Repeat purchases?
              </button>
              <button
                type="button"
                className="chat-suggestion"
                onClick={() =>
                  handleSuggestion(
                    "What are my top 5 most expensive orders?",
                  )
                }
              >
                Most expensive orders?
              </button>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`chat-msg ${msg.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`}
          >
            {msg.role === "assistant" && (
              <div className="chat-avatar">AI</div>
            )}
            <div
              className={`chat-bubble ${msg.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
            >
              {msg.role === "assistant" ? (
                msg.content ? (
                  <div
                    className="chat-markdown"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(msg.content),
                    }}
                  />
                ) : streaming && i === messages.length - 1 ? (
                  <span className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          placeholder="Ask about your orders..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={!input.trim() || streaming}
        >
          {streaming ? <span className="spinner" /> : "\u2191"}
        </button>
      </form>
    </div>
  );
}
