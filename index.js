import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const IS_PROD = process.env.NODE_ENV === "production";
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "";

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: IS_PROD ? "none" : "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use(express.static("public"));

// ===== DB mémoire (beta) =====
const pendingSignups = {}; // pendingId -> { username,email,password,phantomId,createdAt }
const users = {}; // userId -> user data
const usersByEmail = {}; // email -> userId

let phantomCounter = 1; // ⚠️ en prod/DB: ça doit être persistent

function newId(prefix = "u") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function nextPhantomId() {
  // PH000001, PH000002, ...
  const n = phantomCounter++;
  return `PH${String(n).padStart(6, "0")}`;
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

function frontUrl(pathAndQuery) {
  if (FRONTEND_BASE_URL) return `${FRONTEND_BASE_URL}${pathAndQuery}`;
  return pathAndQuery;
}

function goHome(queryString) {
  const qs = queryString ? `?${queryString}` : "";
  return frontUrl(`/index.html${qs}`);
}

app.get("/health", (req, res) => res.send("ok"));
app.get("/login", (req, res) => res.redirect(goHome("login=required")));

// =====================================================
// 1) SIGNUP START (pending)
// =====================================================
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
    password: String(password),
    phantomId: nextPhantomId(), // ✅ généré automatiquement
    createdAt: Date.now(),
  };

  req.session.pendingId = pendingId;
  return res.json({ ok: true });
});

// =====================================================
// 2) DISCORD AUTH
// =====================================================
app.get("/auth/discord", (req, res) => {
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!redirectUri) return res.status(500).send("Missing DISCORD_REDIRECT_URI in env.");
  if (!process.env.DISCORD_CLIENT_ID) return res.status(500).send("Missing DISCORD_CLIENT_ID in env.");

  const scope = "identify guilds.join";
  const state = Math.random().toString(16).slice(2);

  req.session.discordState = state;

  const url =
    `https://discord.com/oauth2/authorize` +
    `?client_id=${encodeURIComponent(process.env.DISCORD_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(state)}`;

  return res.redirect(url);
});

// =====================================================
// 3) DISCORD CALLBACK
// =====================================================
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, state } = req.query;

    console.log("DISCORD CALLBACK query:", req.query);

    if (error || !code) return res.redirect(goHome("discord=error"));

    if (!state || state !== req.session.discordState) {
      return res.status(400).send("Invalid state (security check failed).");
    }

    // 1) Exchange code -> token
    const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenResp.ok) {
      console.error("TOKEN ERROR:", await tokenResp.text());
      return res.redirect(goHome("discord=error"));
    }

    const tokenData = await tokenResp.json();
    const userAccessToken = tokenData.access_token;

    // 2) Get /users/@me
    const meResp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });

    if (!meResp.ok) {
      console.error("ME ERROR:", await meResp.text());
      return res.redirect(goHome("discord=error"));
    }

    const me = await meResp.json();
    const discordUserId = me.id;

    // 3) Add to guild
    const addResp = await fetch(
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

    if (!addResp.ok) {
      console.error("ADD GUILD ERROR:", await addResp.text());
      return res.redirect(goHome("discord=error"));
    }

    // 4) Add role
    const roleResp = await fetch(
      `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${process.env.DISCORD_PHANTOM_ROLE_ID}`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      }
    );

    if (!roleResp.ok) {
      console.error("ADD ROLE ERROR:", await roleResp.text());
      return res.redirect(goHome("discord=error"));
    }

    // ===== pending signup -> create user =====
    const pendingId = req.session.pendingId;

    if (pendingId && pendingSignups[pendingId]) {
      const pending = pendingSignups[pendingId];

      if (usersByEmail[pending.email]) {
        delete pendingSignups[pendingId];
        delete req.session.pendingId;
        return res.redirect(goHome("signup=error&reason=email_used"));
      }

      const userId = newId("user");
      users[userId] = {
        id: userId,
        phantomId: pending.phantomId, // ✅ stored
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

      return res.redirect(goHome("signup=done&discord=linked"));
    }

    return res.redirect(goHome("discord=linked"));
  } catch (e) {
    console.error(e);
    return res.redirect(goHome("discord=error"));
  }
});

// =====================================================
// 4) LOGIN
// =====================================================
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const emailKey = String(email || "").toLowerCase().trim();
  const pass = String(password || "");

  if (!emailKey || !pass) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  const userId = usersByEmail[emailKey];
  if (!userId) return res.status(401).json({ ok: false, error: "Invalid login" });

  const user = users[userId];
  if (!user || user.password !== pass) {
    return res.status(401).json({ ok: false, error: "Invalid login" });
  }

  req.session.userId = user.id;
  return res.json({ ok: true, redirectTo: "/phantomcard.html" });
});

// =====================================================
// 5) WHO AM I
// =====================================================
app.get("/me", requireAuth, (req, res) => {
  const user = users[req.session.userId];
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });

  return res.json({
    ok: true,
    user: {
      id: user.id,
      phantomId: user.phantomId,
      username: user.username,
      email: user.email,
      verifiedDiscord: user.verifiedDiscord,
      premium: user.premium,
    },
  });
});

// =====================================================
// 6) LOGOUT
// =====================================================
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PhantomID running on port ${PORT}`);
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("FRONTEND_BASE_URL:", FRONTEND_BASE_URL || "(serving static)");
  console.log("DISCORD_REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI);
});
