import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import cookieParser from "cookie-parser";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";

// ✅ SITEMAP
import { SitemapStream, streamToPromise } from "sitemap";
import { Readable } from "stream";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// IMPORTANT reverse proxy (Render)
app.set("trust proxy", 1);

// ===== Middlewares =====
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // HTML forms
app.use(cookieParser());

const IS_PROD = process.env.NODE_ENV === "production";
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || ""; // optionnel

function frontUrl(path = "/") {
  if (!FRONTEND_BASE_URL) return path; // sert public/ directement
  return `${FRONTEND_BASE_URL}${path}`;
}

// ✅ Helper: base URL pour sitemap/robots (prend en compte proxy/HTTPS)
function getPublicBaseUrl(req) {
  // si tu veux forcer un domaine canonique, mets PUBLIC_BASE_URL=https://phantomid.com
  const envBase = process.env.PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");

  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http")
    .toString()
    .split(",")[0]
    .trim();

  const host = (req.headers["x-forwarded-host"] || req.get("host") || "")
    .toString()
    .split(",")[0]
    .trim();

  return `${proto}://${host}`.replace(/\/+$/, "");
}

// ===== Pending TTL =====
const PENDING_TTL_MS = 1000 * 60 * 20; // 20 minutes
function isPendingExpired(p) {
  const t = Number(p?.createdAt || 0);
  return !t || Date.now() - t > PENDING_TTL_MS;
}

// ===== Postgres =====
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL manquant (Render Postgres). Mets-le dans les env vars.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : false, // Render = SSL requis en prod
});

pool
  .query("SELECT 1")
  .then(() => console.log("✅ PostgreSQL connecté"))
  .catch((e) => console.error("❌ PostgreSQL connexion fail:", e));

// ===== Session store Postgres =====
const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: IS_PROD ? "none" : "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

// =====================================================
// ✅ SEO: robots.txt + sitemap.xml (AVANT static files)
// =====================================================

// robots.txt
app.get("/robots.txt", (req, res) => {
  const base = getPublicBaseUrl(req);
  res.type("text/plain").send(
    [
      "User-agent: *",
      "Allow: /",
      "",
      // Optionnel: empêcher l’indexation des routes auth/privées
      "Disallow: /auth/",
      "Disallow: /signup/",
      "Disallow: /login/",
      "Disallow: /logout/",
      "Disallow: /account/",
      "Disallow: /me",
      "Disallow: /settings",
      "",
      `Sitemap: ${base}/sitemap.xml`,
      "",
    ].join("\n")
  );
});

// sitemap.xml
app.get("/sitemap.xml", async (req, res) => {
  try {
    const base = getPublicBaseUrl(req);

    const links = [
      { url: "/", changefreq: "daily", priority: 1.0 },
      { url: "/phantomcard", changefreq: "weekly", priority: 0.8 },
      { url: "/tournaments", changefreq: "weekly", priority: 0.8 },
      { url: "/rating-system", changefreq: "monthly", priority: 0.6 },
      { url: "/creator-access", changefreq: "monthly", priority: 0.6 },
    ];

    res.header("Content-Type", "application/xml");

    const stream = new SitemapStream({ hostname: base });
    const xml = await streamToPromise(Readable.from(links).pipe(stream));

    res.send(xml.toString());
  } catch (e) {
    console.error("❌ sitemap error:", e);
    res.status(500).send("sitemap error");
  }
});

// =====================================================
// Static files
// =====================================================
app.use(express.static("public"));

// ===== Clean URLs (no .html) =====
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.get("/settings", (req, res) => {
  res.sendFile("settings.html", { root: "public" });
});

app.get("/phantomcard", (req, res) => {
  res.sendFile("phantomcard.html", { root: "public" });
});

app.get("/tournaments", (req, res) => {
  res.sendFile("tournaments.html", { root: "public" });
});

app.get("/rating-system", (req, res) => {
  res.sendFile("rating-system.html", { root: "public" });
});

app.get("/creator-access", (req, res) => {
  res.sendFile("creator-access-registrer.html", { root: "public" });
});

// (Optionnel mais conseillé) : si quelqu’un tape .html, on redirige vers l’URL propre
app.get("/*.html", (req, res) => {
  const clean = req.path.replace(/\.html$/i, "");
  return res.redirect(301, clean || "/");
});

// ===== Helpers =====
function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

// ✅ PhantomID SEQ: PH000001, PH000002, ...
async function nextPhantomId() {
  try {
    const r = await pool.query("SELECT nextval('phantom_id_seq') AS n");
    const n = Number(r.rows[0].n);
    return `PH${String(n).padStart(6, "0")}`;
  } catch (e) {
    console.error("❌ nextPhantomId error:", e);
    throw new Error("phantom_id_seq missing (initDb not executed?)");
  }
}

// ================================
// ✅ API ROUTES (ICI)
// ================================

// 👉 ICI : /api/countries
app.get("/api/countries", (req, res) => {
  return res.json({
    ok: true,
    countries: [
      { code: "AF", name: "Afghanistan" },
      { code: "AL", name: "Albania" },
      { code: "DZ", name: "Algeria" },
      { code: "AD", name: "Andorra" },
      { code: "AO", name: "Angola" },
      { code: "AG", name: "Antigua and Barbuda" },
      { code: "AR", name: "Argentina" },
      { code: "AM", name: "Armenia" },
      { code: "AU", name: "Australia" },
      { code: "AT", name: "Austria" },
      { code: "AZ", name: "Azerbaijan" },

      { code: "BS", name: "Bahamas" },
      { code: "BH", name: "Bahrain" },
      { code: "BD", name: "Bangladesh" },
      { code: "BB", name: "Barbados" },
      { code: "BY", name: "Belarus" },
      { code: "BE", name: "Belgium" },
      { code: "BZ", name: "Belize" },
      { code: "BJ", name: "Benin" },
      { code: "BT", name: "Bhutan" },
      { code: "BO", name: "Bolivia" },
      { code: "BA", name: "Bosnia and Herzegovina" },
      { code: "BW", name: "Botswana" },
      { code: "BR", name: "Brazil" },
      { code: "BN", name: "Brunei" },
      { code: "BG", name: "Bulgaria" },
      { code: "BF", name: "Burkina Faso" },
      { code: "BI", name: "Burundi" },

      { code: "KH", name: "Cambodia" },
      { code: "CM", name: "Cameroon" },
      { code: "CA", name: "Canada" },
      { code: "CV", name: "Cape Verde" },
      { code: "CF", name: "Central African Republic" },
      { code: "TD", name: "Chad" },
      { code: "CL", name: "Chile" },
      { code: "CN", name: "China" },
      { code: "CO", name: "Colombia" },
      { code: "KM", name: "Comoros" },
      { code: "CG", name: "Congo" },
      { code: "CR", name: "Costa Rica" },
      { code: "HR", name: "Croatia" },
      { code: "CU", name: "Cuba" },
      { code: "CY", name: "Cyprus" },
      { code: "CZ", name: "Czech Republic" },

      { code: "DK", name: "Denmark" },
      { code: "DJ", name: "Djibouti" },
      { code: "DM", name: "Dominica" },
      { code: "DO", name: "Dominican Republic" },

      { code: "EC", name: "Ecuador" },
      { code: "EG", name: "Egypt" },
      { code: "SV", name: "El Salvador" },
      { code: "GQ", name: "Equatorial Guinea" },
      { code: "ER", name: "Eritrea" },
      { code: "EE", name: "Estonia" },
      { code: "ET", name: "Ethiopia" },

      { code: "FJ", name: "Fiji" },
      { code: "FI", name: "Finland" },
      { code: "FR", name: "France" },

      { code: "GA", name: "Gabon" },
      { code: "GM", name: "Gambia" },
      { code: "GE", name: "Georgia" },
      { code: "DE", name: "Germany" },
      { code: "GH", name: "Ghana" },
      { code: "GR", name: "Greece" },
      { code: "GD", name: "Grenada" },
      { code: "GT", name: "Guatemala" },
      { code: "GN", name: "Guinea" },
      { code: "GW", name: "Guinea-Bissau" },
      { code: "GY", name: "Guyana" },

      { code: "HT", name: "Haiti" },
      { code: "HN", name: "Honduras" },
      { code: "HU", name: "Hungary" },

      { code: "IS", name: "Iceland" },
      { code: "IN", name: "India" },
      { code: "ID", name: "Indonesia" },
      { code: "IR", name: "Iran" },
      { code: "IQ", name: "Iraq" },
      { code: "IE", name: "Ireland" },
      { code: "IL", name: "Israel" },
      { code: "IT", name: "Italy" },

      { code: "JM", name: "Jamaica" },
      { code: "JP", name: "Japan" },
      { code: "JO", name: "Jordan" },

      { code: "KZ", name: "Kazakhstan" },
      { code: "KE", name: "Kenya" },
      { code: "KI", name: "Kiribati" },
      { code: "KW", name: "Kuwait" },
      { code: "KG", name: "Kyrgyzstan" },

      { code: "LA", name: "Laos" },
      { code: "LV", name: "Latvia" },
      { code: "LB", name: "Lebanon" },
      { code: "LS", name: "Lesotho" },
      { code: "LR", name: "Liberia" },
      { code: "LY", name: "Libya" },
      { code: "LI", name: "Liechtenstein" },
      { code: "LT", name: "Lithuania" },
      { code: "LU", name: "Luxembourg" },

      { code: "MG", name: "Madagascar" },
      { code: "MW", name: "Malawi" },
      { code: "MY", name: "Malaysia" },
      { code: "MV", name: "Maldives" },
      { code: "ML", name: "Mali" },
      { code: "MT", name: "Malta" },
      { code: "MH", name: "Marshall Islands" },
      { code: "MR", name: "Mauritania" },
      { code: "MU", name: "Mauritius" },
      { code: "MX", name: "Mexico" },
      { code: "MD", name: "Moldova" },
      { code: "MC", name: "Monaco" },
      { code: "MN", name: "Mongolia" },
      { code: "ME", name: "Montenegro" },
      { code: "MA", name: "Morocco" },
      { code: "MZ", name: "Mozambique" },
      { code: "MM", name: "Myanmar" },

      { code: "NA", name: "Namibia" },
      { code: "NP", name: "Nepal" },
      { code: "NL", name: "Netherlands" },
      { code: "NZ", name: "New Zealand" },
      { code: "NI", name: "Nicaragua" },
      { code: "NE", name: "Niger" },
      { code: "NG", name: "Nigeria" },
      { code: "KP", name: "North Korea" },
      { code: "NO", name: "Norway" },

      { code: "OM", name: "Oman" },

      { code: "PK", name: "Pakistan" },
      { code: "PA", name: "Panama" },
      { code: "PG", name: "Papua New Guinea" },
      { code: "PY", name: "Paraguay" },
      { code: "PE", name: "Peru" },
      { code: "PH", name: "Philippines" },
      { code: "PL", name: "Poland" },
      { code: "PT", name: "Portugal" },

      { code: "QA", name: "Qatar" },

      { code: "RO", name: "Romania" },
      { code: "RU", name: "Russia" },
      { code: "RW", name: "Rwanda" },

      { code: "SA", name: "Saudi Arabia" },
      { code: "SN", name: "Senegal" },
      { code: "RS", name: "Serbia" },
      { code: "SC", name: "Seychelles" },
      { code: "SL", name: "Sierra Leone" },
      { code: "SG", name: "Singapore" },
      { code: "SK", name: "Slovakia" },
      { code: "SI", name: "Slovenia" },
      { code: "ZA", name: "South Africa" },
      { code: "KR", name: "South Korea" },
      { code: "ES", name: "Spain" },
      { code: "LK", name: "Sri Lanka" },
      { code: "SD", name: "Sudan" },
      { code: "SR", name: "Suriname" },
      { code: "SE", name: "Sweden" },
      { code: "CH", name: "Switzerland" },
      { code: "SY", name: "Syria" },

      { code: "TW", name: "Taiwan" },
      { code: "TJ", name: "Tajikistan" },
      { code: "TZ", name: "Tanzania" },
      { code: "TH", name: "Thailand" },
      { code: "TG", name: "Togo" },
      { code: "TO", name: "Tonga" },
      { code: "TN", name: "Tunisia" },
      { code: "TR", name: "Turkey" },
      { code: "TM", name: "Turkmenistan" },

      { code: "UA", name: "Ukraine" },
      { code: "AE", name: "United Arab Emirates" },
      { code: "GB", name: "United Kingdom" },
      { code: "US", name: "United States" },
      { code: "UY", name: "Uruguay" },
      { code: "UZ", name: "Uzbekistan" },

      { code: "VE", name: "Venezuela" },
      { code: "VN", name: "Vietnam" },

      { code: "YE", name: "Yemen" },

      { code: "ZM", name: "Zambia" },
      { code: "ZW", name: "Zimbabwe" }
    ],
  });
});

// =====================================================
// INIT DB AU DÉMARRAGE (table + column + sequence + setval safe)
// + constraints anti doublons discord_id
// + rating (default Unrated)
// + avatar default + badges (premium/verified/builder)
// =====================================================
async function initDb() {
  // 1) table users (première création)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phantom_id VARCHAR(32) UNIQUE NOT NULL,
      username VARCHAR(32),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      discord_id VARCHAR(32),
      rating VARCHAR(32) DEFAULT 'Unrated',
      avatar_url TEXT DEFAULT '/assets/phantomid-logo.png',
      is_premium BOOLEAN DEFAULT FALSE,
      is_verified BOOLEAN DEFAULT FALSE,
      is_builder BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 1b) si table existait AVANT username -> ajouter colonne safe
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username VARCHAR(32);
  `);

  // 1c) unique discord_id (nullable => OK)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_discord_id_unique'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_discord_id_unique UNIQUE (discord_id);
      END IF;
    END $$;
  `);

  // 1d) rating (nullable mais default = Unrated) + backfill anciens users
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rating VARCHAR(32) DEFAULT 'Unrated';
  `);

  await pool.query(`
    UPDATE users
    SET rating = 'Unrated'
    WHERE rating IS NULL;
  `);

  // 1e) avatar + badges (defaults) + backfill anciens users
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '/assets/phantomid-logo.png';
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_builder BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    UPDATE users
    SET avatar_url = '/assets/phantomid-logo.png'
    WHERE avatar_url IS NULL OR avatar_url = '';
  `);

  await pool.query(`
    UPDATE users
    SET is_premium = FALSE
    WHERE is_premium IS NULL;
  `);

  await pool.query(`
    UPDATE users
    SET is_verified = FALSE
    WHERE is_verified IS NULL;
  `);

  await pool.query(`
    UPDATE users
    SET is_builder = FALSE
    WHERE is_builder IS NULL;
  `);

  // 2) sequence phantom_id_seq (min 1)
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS phantom_id_seq
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1;
  `);

  // 3) recaler la sequence sur le max PHxxxxxx existant
  const maxRes = await pool.query(`
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(phantom_id FROM 3) AS INT)),
      0
    ) AS max_n
    FROM users;
  `);

  const maxN = Number(maxRes.rows[0].max_n || 0);

  if (maxN < 1) {
    // IMPORTANT: ne jamais setval à 0 si MINVALUE=1
    // is_called=false => nextval renvoie exactement 1
    await pool.query(`SELECT setval('phantom_id_seq', 1, false);`);
  } else {
    // is_called=true => nextval renvoie maxN + 1
    await pool.query(`SELECT setval('phantom_id_seq', $1, true);`, [maxN]);
  }

  console.log("✅ initDb ok. max phantom =", maxN);
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

// ... ✅ le reste de ton fichier est inchangé (signup, discord, login, /me, settings, logout, start server)
// ===== Start server =====
(async () => {
  try {
    await initDb();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`PhantomID running on port ${PORT}`);
      console.log("NODE_ENV:", process.env.NODE_ENV);
      console.log("FRONTEND_BASE_URL:", FRONTEND_BASE_URL || "(serving static)");
      console.log("DISCORD_REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI);
    });
  } catch (e) {
    console.error("❌ initDb failed, server not started:", e);
    process.exit(1);
  }
})();
