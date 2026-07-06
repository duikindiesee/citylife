// Ask Kooker — the public question board, hosted inside CityLife. Anyone can ask a question and read
// the answers an operator has approved; nothing shows until a human reviews it. The "Your answers"
// panel is login-walled behind CityLife's own AuthGate, so to track your own questions you must create
// a CityLife account and sign in — creating the account is the gate.
//
// Talks to the kooker backend through the same-origin /kooker proxy (dev: vite proxy, prod: APISIX):
//  - public:  GET /kooker/api/public/qa , POST /kooker/api/public/qa/ask   (no auth)
//  - private: GET /kooker/api/v1/ai/qa/mine , POST /kooker/api/v1/ai/qa/ask (Bearer from authClient)
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getAuthClient } from "../authClient";
import { AuthGate } from "../ui/AuthGate";

const SEA = "#0f7d6b";
const DEEP = "#0b2530";
const INK = "#13303a";
const MUTED = "#5a6b72";
const CORAL = "#e8663d";
const LINE = "#dde6e9";
const PANEL = "#ffffff";
const SEA_SOFT = "#e6f4f0";
const CORAL_SOFT = "#fdeee8";

type PublicAnswer = {
  id?: string;
  question?: string;
  answer?: string;
  asker?: string;
  name?: string;
  submitter?: string;
};
type MineItem = {
  id: string;
  question?: string;
  status?: string;
  answer?: string | null;
};

async function getJson(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const r = await fetch(url, {
    headers: { Accept: "application/json", ...(headers || {}) },
  });
  if (!r.ok)
    throw new Error(
      (await r.json().catch(() => null))?.error ||
        `Request failed (${r.status})`,
    );
  return r.json();
}
async function postJson(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok)
    throw new Error(
      (await r.json().catch(() => null))?.error ||
        `Request failed (${r.status})`,
    );
  return r.json();
}

const card: React.CSSProperties = {
  background: PANEL,
  border: `1px solid ${LINE}`,
  borderRadius: 14,
  padding: "20px 22px",
};
const field: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  padding: "12px 13px",
  font: "inherit",
  color: INK,
  background: "#fcfdfe",
  boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  background: CORAL,
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "12px 20px",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};
const chip = (soft: string, fg: string): React.CSSProperties => ({
  display: "inline-flex",
  gap: 6,
  alignItems: "center",
  fontSize: 12,
  fontWeight: 700,
  padding: "4px 10px",
  borderRadius: 999,
  background: soft,
  color: fg,
});

function Hero() {
  return (
    <header
      style={{ background: DEEP, color: "#eaf2f2", padding: "40px 0 36px" }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 22px" }}>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 12,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "#8fb7ad",
          }}
        >
          Build in public · CityLife
        </p>
        <h1
          style={{
            fontFamily: "ui-serif, Georgia, serif",
            fontWeight: 600,
            fontSize: "clamp(30px,6vw,44px)",
            lineHeight: 1.06,
            margin: "0 0 14px",
          }}
        >
          Ask <span style={{ color: CORAL }}>Kooker</span>.
        </h1>
        <p
          style={{
            color: "#bcd2ce",
            fontSize: 16,
            maxWidth: "52ch",
            margin: 0,
          }}
        >
          A living world built by an AI agent fleet. Ask anything — the tech,
          the story, the little people. Every answer is written, checked, and
          released by a human before it lands here.
        </p>
      </div>
    </header>
  );
}

function PublicAsk() {
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!question.trim()) return;
    setSending(true);
    setError(null);
    try {
      await postJson("/kooker/api/public/qa/ask", {
        question: question.trim(),
        name: name.trim() || undefined,
      });
      setSent(true);
      setQuestion("");
      setName("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not send your question.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      style={{
        ...card,
        margin: "-26px 0 34px",
        boxShadow: "0 10px 30px rgba(11,37,48,.08)",
      }}
    >
      <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Ask a question</h2>
      <p style={{ color: MUTED, fontSize: 13, margin: "0 0 16px" }}>
        Your question joins the queue. It only appears below once it is answered
        and approved.
      </p>
      {sent ? (
        <div
          style={{ ...chip(SEA_SOFT, SEA), fontSize: 13, padding: "10px 14px" }}
        >
          Thanks — it is in the queue for review. Nothing shows until a human
          approves it.
        </div>
      ) : (
        <>
          <input
            style={{ ...field, marginBottom: 10 }}
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            style={{
              ...field,
              minHeight: 88,
              resize: "vertical",
              marginBottom: 10,
            }}
            placeholder="What would you like to know about CityLife or the fleet?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              style={{ ...btn, opacity: sending || !question.trim() ? 0.6 : 1 }}
              onClick={submit}
              disabled={sending || !question.trim()}
            >
              {sending ? "Sending…" : "Send it in"}
            </button>
            <span style={{ ...chip("transparent", SEA), fontSize: 12.5 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: SEA,
                }}
              />{" "}
              Every answer is human-reviewed before it is public
            </span>
          </div>
          {error && (
            <p style={{ color: "#a23a25", fontSize: 13, margin: "10px 0 0" }}>
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PublicFeed() {
  const [answers, setAnswers] = useState<PublicAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getJson("/kooker/api/public/qa")
      .then((d) =>
        setAnswers(
          Array.isArray((d as { answers?: PublicAnswer[] })?.answers)
            ? (d as { answers: PublicAnswer[] }).answers
            : [],
        ),
      )
      .catch(() => setAnswers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section>
      <h2
        style={{
          fontSize: 14,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: MUTED,
          margin: "0 0 14px",
          fontWeight: 700,
        }}
      >
        Answered
      </h2>
      {loading ? (
        <p style={{ color: MUTED, fontSize: 14 }}>Loading…</p>
      ) : answers.length === 0 ? (
        <p style={{ color: MUTED, fontSize: 14 }}>
          No answers published yet — be the first to ask.
        </p>
      ) : (
        answers.map((a, i) => (
          <article key={a.id || i} style={{ ...card, marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                gap: 11,
                alignItems: "flex-start",
                margin: "0 0 12px",
              }}
            >
              <span
                style={{
                  fontFamily: "ui-serif, Georgia, serif",
                  fontWeight: 700,
                  color: CORAL,
                  fontSize: 19,
                  lineHeight: 1,
                }}
              >
                Q
              </span>
              <p style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
                {a.question}
              </p>
            </div>
            <p
              style={{
                color: "#26424c",
                fontSize: 15,
                margin: "0 0 12px",
                paddingLeft: 31,
                whiteSpace: "pre-wrap",
              }}
            >
              {a.answer}
            </p>
            <div style={{ paddingLeft: 31 }}>
              <span style={chip(SEA_SOFT, SEA)}>✓ reviewed &amp; approved</span>
              {(a.asker || a.name) && (
                <span style={{ color: MUTED, fontSize: 12.5, marginLeft: 10 }}>
                  asked by {a.asker || a.name}
                </span>
              )}
            </div>
          </article>
        ))
      )}
    </section>
  );
}

/** Login-walled: only rendered by AuthGate once the visitor has a CityLife account and is signed in. */
function YourAnswers() {
  const auth = getAuthClient();
  const [items, setItems] = useState<MineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getJson("/kooker/api/v1/ai/qa/mine", auth.authHeader());
      setItems(
        Array.isArray((d as { threads?: MineItem[] })?.threads)
          ? (d as { threads: MineItem[] }).threads
          : [],
      );
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(
        "/kooker/api/v1/ai/qa/ask",
        { question: question.trim() },
        auth.authHeader(),
      );
      setQuestion("");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not send your question.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ ...card, marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>Ask privately</h3>
        <p style={{ color: MUTED, fontSize: 13, margin: "0 0 12px" }}>
          Only you and the operator see this. The answer appears here once it is
          approved.
        </p>
        <textarea
          style={{
            ...field,
            minHeight: 72,
            resize: "vertical",
            marginBottom: 10,
          }}
          placeholder="Ask something just for you…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          style={{ ...btn, opacity: busy || !question.trim() ? 0.6 : 1 }}
          onClick={ask}
          disabled={busy || !question.trim()}
        >
          {busy ? "Sending…" : "Ask"}
        </button>
        {error && (
          <p style={{ color: "#a23a25", fontSize: 13, margin: "10px 0 0" }}>
            {error}
          </p>
        )}
      </div>

      {loading ? (
        <p style={{ color: MUTED, fontSize: 14 }}>Loading your questions…</p>
      ) : items.length === 0 ? (
        <p style={{ color: MUTED, fontSize: 14 }}>
          No questions yet. Ask one above and it will show here — with its
          answer once approved.
        </p>
      ) : (
        items.map((it) => {
          const done = it.status === "DONE";
          return (
            <article key={it.id} style={{ ...card, marginBottom: 12 }}>
              <p style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
                {it.question}
              </p>
              {done ? (
                <p
                  style={{
                    color: "#26424c",
                    fontSize: 15,
                    margin: "0 0 10px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {it.answer}
                </p>
              ) : (
                <p
                  style={{
                    color: MUTED,
                    fontSize: 14,
                    fontStyle: "italic",
                    margin: "0 0 10px",
                  }}
                >
                  Waiting for the operator's review before you see the answer.
                </p>
              )}
              <span
                style={done ? chip(SEA_SOFT, SEA) : chip(CORAL_SOFT, "#c04a24")}
              >
                {done ? "✓ reviewed & approved" : "◷ in review"}
              </span>
            </article>
          );
        })
      )}
    </div>
  );
}

function AskKookerApp() {
  return (
    <div
      style={{
        background: "#fbfcfd",
        color: INK,
        fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        lineHeight: 1.55,
        minHeight: "100%",
        paddingBottom: 64,
      }}
    >
      <Hero />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "0 22px" }}>
        <PublicAsk />
        <PublicFeed />

        <section style={{ marginTop: 40 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              margin: "0 0 14px",
            }}
          >
            <h2
              style={{
                fontSize: 14,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: MUTED,
                margin: 0,
                fontWeight: 700,
              }}
            >
              Your answers
            </h2>
          </div>
          <div style={{ ...card, borderStyle: "dashed" }}>
            <p style={{ color: MUTED, fontSize: 13.5, margin: "0 0 14px" }}>
              Want to ask privately and keep track of your own answers? Sign in
              with a CityLife account — or create one, it takes a minute.
            </p>
            <AuthGate>
              <YourAnswers />
            </AuthGate>
          </div>
        </section>

        <p
          style={{
            color: MUTED,
            fontSize: 12.5,
            textAlign: "center",
            marginTop: 34,
            paddingTop: 18,
            borderTop: `1px solid ${LINE}`,
          }}
        >
          Every public answer is written, checked, and released by a human. Your
          private questions stay between you and the operator.
        </p>
      </main>
    </div>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<AskKookerApp />);
