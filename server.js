require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const Stripe = require("stripe");
const db = require("./db");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

app.post("/webhook/stripe", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      db.updateUserByCustomer(session.customer, {
        stripe_subscription_id: session.subscription,
        subscription_status: "active",
      });
      break;
    }
    case "customer.subscription.updated":
      db.updateUserByCustomer(event.data.object.customer, { subscription_status: event.data.object.status });
      break;
    case "customer.subscription.deleted":
      db.updateUserByCustomer(event.data.object.customer, { subscription_status: "canceled" });
      break;
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect("/login");
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.redirect("/login");
  }
}

function requireAuthApi(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Log in again." });
  }
}

function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views/landing.html")));
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "views/signup.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "views/login.html")));
app.get("/billing", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "views/billing.html")));

app.get("/dashboard", requireAuth, (req, res) => {
  const user = db.findUserById(req.user.id);
  if (!user || !["active", "trialing"].includes(user.subscription_status)) {
    return res.redirect("/billing");
  }
  res.sendFile(path.join(__dirname, "views/dashboard.html"));
});

app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "Email and an 8+ character password are required." });
  }
  if (db.findUserByEmail(email)) {
    return res.status(400).json({ error: "An account with that email already exists." });
  }

  const hash = await bcrypt.hash(password, 10);
  const customer = await stripe.customers.create({ email });
  const user = db.createUser({ email, password_hash: hash, stripe_customer_id: customer.id });
  setAuthCookie(res, user);
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = db.findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  setAuthCookie(res, user);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/me", requireAuthApi, (req, res) => {
  const user = db.findUserById(req.user.id);
  res.json({ email: user.email, subscription_status: user.subscription_status });
});

app.post("/api/create-checkout-session", requireAuthApi, async (req, res) => {
  const user = db.findUserById(req.user.id);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: user.stripe_customer_id,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}/dashboard`,
    cancel_url: `${APP_URL}/billing`,
  });
  res.json({ url: session.url });
});

app.post("/api/create-portal-session", requireAuthApi, async (req, res) => {
  const user = db.findUserById(req.user.id);
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${APP_URL}/dashboard`,
  });
  res.json({ url: session.url });
});

app.post("/api/analyze", requireAuthApi, async (req, res) => {
  const user = db.findUserById(req.user.id);
  if (!["active", "trialing"].includes(user.subscription_status)) {
    return res.status(402).json({ error: "Active subscription required." });
  }

  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "No contract text provided." });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system:
          "You are a contract risk reviewer for small marketing and creative agencies reviewing freelance and vendor agreements. Analyze the contract text the user provides and identify notable clauses in these categories: Payment Terms, IP Ownership, Liability & Indemnification, Termination, Auto-Renewal, Confidentiality, Non-Compete/Non-Solicit, Scope Creep & Change Orders. For each notable clause found in the text, extract a short exact quote (verbatim, under 40 words), classify riskLevel as 'red' (high risk, should push back), 'yellow' (worth negotiating), or 'green' (standard/acceptable), explain the risk in plain English in 1-2 short sentences, and give a suggestion for alternative language. Only flag clauses that actually exist in the text — never invent one. Respond with ONLY valid JSON, no markdown fences, no preamble, matching exactly this shape: {\"overallRisk\":\"high|medium|low\",\"summary\":\"one or two sentence plain-English overview\",\"clauses\":[{\"id\":1,\"category\":\"Payment Terms\",\"riskLevel\":\"red\",\"quote\":\"...\",\"issue\":\"...\",\"suggestion\":\"...\"}]}",
        messages: [{ role: "user", content: text }],
      }),
    });
    const data = await response.json();
    const raw = (data.content || []).map((b) => b.text || "").join("\n");
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Analysis failed. Try again." });
  }
});

app.listen(PORT, () => console.log(`Redline running on ${APP_URL}`));
