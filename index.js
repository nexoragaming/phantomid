import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Path helpers (ESM) =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Middlewares =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // Render = true
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

app.use(express.static("public"));

// ===== "DB" temporaire en mémoire (beta) =====
const pendingSignups = {}; // pendingId -> { username,email,password,createdAt }
const users = {};          // userId -> user data
const usersByEmail = {};   // email -> userId

function newId(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.redirect("/index.html?login=required");
  }
  next();
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

/* =====================================================
   1) SIGNUP START (pending, pas encore de compte)
===================================================== */
app.post("/signup/start", (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  const emailKey = String(email).toLowerCase().trim();
  if (usersByEmail[emailKey]) {
    return res.status(409).json({ ok: false, error: "Email already used" });
  }

  const pendingId = newId("pending");
  pendingSignups[pendingId] = {
    username: String(username).trim(),
    email: emailKey,
    password: String(password), // beta
    createdAt: Date.now(),
  };

  req.session.pendingId = pendingId;
  return res.json({ ok: true });
});

/* =====================================================
   2) DISCORD AUTH
===================================================== */
app.get("/auth/discord", (req, res) => {
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = encodeURIComponent("identify guilds.join");
  const state = Math.random().toString(16).slice(2);

  req.session.discordState = state;

  const url =
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${process.env.DISCORD_CLIENT_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&prompt=consent` +
    `&state=${state}`;

  res.redirect(url);
});

/* =====================================================
   3) DISCORD CALLBACK
===================================================== */
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, error_description, state } = req.query;

    if (error) {
      return res
        .status(400)
        .send(`Discord OAuth error: ${error}${error_description ? " - " + error_description : ""}`);
    }

    if (!code) return res.status(400).send("No code returned by Discord.");
    if (!state || state !== req.session.discordState) {
      return res.status(400).send("Invalid state");
    }

    // Exchange code -> token
    const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResp.json();
    const userAccessToken = tokenData.access_token;

    // Get user
    const meResp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const me = await meResp.json();
    const discordUserId = me.id;

    // Add to guild
    await fetch(
      `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: userAccessToken }),
      }
    );

    // Add role
    await fetch(
      `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${process.env.DISCORD_PHANTOM_ROLE_ID}`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      }
    );

    // Create account if pending
    const pendingId = req.session.pendingId;
    if (pendingId && pendingSignups[pendingId]) {
      const pending = pendingSignups[pendingId];

      const userId = newId("user");
      users[userId] = {
        id: userId,
        username: pending.username,
        email: pending.email,
        password: pending.password,
        discordUserId,
        verifiedDiscord: true,
        createdAt: Date.now(),
        premium: false,
      };
      usersByEmail[pending.email] = userId;

      delete pendingSignups[pendingId];
      delete req.session.pendingId;

      req.session.userId = userId;
      return res.redirect("/phantomcard?signup=done");
    }

    return res.redirect("/index.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Discord callback error");
  }
});

/* =====================================================
   4) LOGIN
===================================================== */
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const emailKey = String(email || "").toLowerCase().trim();

  const userId = usersByEmail[emailKey];
  if (!userId || users[userId].password !== password) {
    return res.status(401).json({ ok: false, error: "Invalid login" });
  }

  req.session.userId = userId;
  return res.json({ ok: true, redirectTo: "/phantomcard" });
});

/* =====================================================
   5) PHANTOMCARD (PROTÉGÉ)
===================================================== */
app.get("/phantomcard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "phantomcard.html"));
});

// Bloquer accès direct
app.get("/phantomcard.html", (req, res) => {
  res.redirect("/phantomcard");
});

/* =====================================================
   6) WHO AM I
===================================================== */
app.get("/me", (req, res) => {
  if (!req.session?.userId) return res.json({ ok: false });
  const user = users[req.session.userId];
  res.json({ ok: true, user });
});

/* =====================================================
   7) LOGOUT
===================================================== */
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 PhantomID running on http://localhost:${PORT}`);
});
