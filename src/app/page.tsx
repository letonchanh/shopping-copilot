import ConnectFlow from "@/components/ConnectFlow";

export default function Home() {
  return (
    <main className="page-container">
      <div className="hero">
        <div className="hero-badge">Your receipts, reimagined</div>
        <h1 className="hero-title">Shopping Copilot</h1>
        <p className="hero-subtitle">
          Connect your Amazon and Shopify orders. Get AI-powered insights that
          help you remember purchases, catch waste, and make smarter
          decisions&mdash;plus a fun Shopping Wrapped of your habits.
        </p>
        <div className="hero-features">
          <span className="hero-feature">
            <span className="hero-feature-dot" />
            AI Chat
          </span>
          <span className="hero-feature">
            <span className="hero-feature-dot" />
            Spending Insights
          </span>
          <span className="hero-feature">
            <span className="hero-feature-dot" />
            Shopping Wrapped
          </span>
        </div>
      </div>
      <ConnectFlow />
      <footer className="footer">
        Your data stays yours &mdash; processed locally via your Vana Personal
        Server.
      </footer>
    </main>
  );
}
