import express from "express";

const VALID_STATUSES = new Set(["upcoming", "open", "live", "finished"]);

export default function createTournamentRouter(pool) {
  const router = express.Router();

  // =====================================================
  // GET /api/tournaments
  // =====================================================
  router.get("/", async (req, res) => {
    try {
      const { search = "", game = "", region = "", status = "" } = req.query;

      const values = [];
      let i = 1;
      const where = [];

      if (search) {
        where.push(`(t.name ILIKE $${i} OR t.game ILIKE $${i} OR t.region ILIKE $${i})`);
        values.push(`%${search}%`);
        i++;
      }
      if (game) {
        where.push(`t.game = $${i}`);
        values.push(game);
        i++;
      }
      if (region) {
        where.push(`t.region = $${i}`);
        values.push(region);
        i++;
      }
      if (status) {
        const s = String(status).toLowerCase();
        if (!VALID_STATUSES.has(s)) {
          return res.json({ upcoming: [], open: [], live: [], finished: [] });
        }
        where.push(`t.status = $${i}`);
        values.push(s);
        i++;
      }

      const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `
        SELECT
          t.*,
          (SELECT COUNT(*)::int FROM tournament_participants p WHERE p.tournament_id = t.id) AS "currentSlots"
        FROM tournaments t
        ${whereSQL}
        ORDER BY
          CASE t.status
            WHEN 'open' THEN 1
            WHEN 'live' THEN 2
            WHEN 'upcoming' THEN 3
            WHEN 'finished' THEN 4
            ELSE 5
          END,
          t.start_at ASC
      `;

      const { rows } = await pool.query(sql, values);

      const grouped = { upcoming: [], open: [], live: [], finished: [] };

      for (const t of rows) {
        const s = String(t.status || "").toLowerCase();
        if (!VALID_STATUSES.has(s)) continue;

        grouped[s].push({
          id: t.id,
          slug: t.slug,
          name: t.name,
          organizer: t.organizer,
          game: t.game,
          region: t.region,
          format: t.format,
          status: s,
          startDate: t.start_at,
          maxSlots: t.max_slots,
          currentSlots: t.currentSlots ?? 0,
          bannerUrl: t.banner_url,
        });
      }

      return res.json(grouped);
    } catch (err) {
      console.error("GET /api/tournaments error:", err);
      return res.status(500).json({ error: "Server error fetching tournaments." });
    }
  });

  // =====================================================
  // POST /api/tournaments (create)
  // =====================================================
  router.post("/", async (req, res) => {
    try {
      const {
        name,
        organizer,
        game,
        region,
        format = "Solo",
        status = "open",
        startAt,
        maxSlots = 32,
        bannerUrl = null,
      } = req.body || {};

      if (!name || !organizer || !game || !region || !startAt) {
        return res.status(400).json({
          error: "Missing required fields",
        });
      }

      const normalizedStatus = String(status).toLowerCase();
      if (!VALID_STATUSES.has(normalizedStatus)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const maxSlotsInt = Number(maxSlots);
      if (!Number.isInteger(maxSlotsInt) || maxSlotsInt < 2) {
        return res.status(400).json({ error: "Invalid maxSlots" });
      }

      const baseSlug = String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const slug = `${baseSlug}-${Date.now()}`;

      const sql = `
        INSERT INTO tournaments
          (slug, name, organizer, game, region, format, status, start_at, max_slots, banner_url)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id, slug, status
      `;

      const values = [
        slug,
        name,
        organizer,
        game,
        region,
        format,
        normalizedStatus,
        startAt,
        maxSlotsInt,
        bannerUrl,
      ];

      const { rows } = await pool.query(sql, values);

      return res.status(201).json({ ok: true, tournament: rows[0] });
    } catch (err) {
      console.error("POST /api/tournaments error:", err);
      return res.status(500).json({ error: "Server error creating tournament." });
    }
  });

  // =====================================================
  // POST /api/tournaments/:slug/join  ✅ STABLE MVP
  // =====================================================
  router.post("/:slug/join", async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Not logged in" });
      }

      const slug = String(req.params.slug || "").trim();

      const tRes = await pool.query(
        `SELECT id, status, max_slots
         FROM tournaments
         WHERE slug = $1
         LIMIT 1`,
        [slug]
      );

      if (tRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Tournament not found" });
      }

      const t = tRes.rows[0];

      if (t.status !== "open") {
        return res.status(400).json({ ok: false, error: "Tournament is not open" });
      }

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS n
         FROM tournament_participants
         WHERE tournament_id = $1`,
        [t.id]
      );

      if (countRes.rows[0].n >= t.max_slots) {
        return res.status(400).json({ ok: false, error: "Tournament is full" });
      }

      const ins = await pool.query(
        `INSERT INTO tournament_participants (tournament_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (tournament_id, user_id) DO NOTHING
         RETURNING id`,
        [t.id, userId]
      );

      const after = await pool.query(
        `SELECT COUNT(*)::int AS n
         FROM tournament_participants
         WHERE tournament_id = $1`,
        [t.id]
      );

      return res.json({
        ok: true,
        joined: ins.rowCount > 0,
        currentSlots: after.rows[0].n,
        maxSlots: t.max_slots,
      });
    } catch (err) {
      console.error("POST /api/tournaments/:slug/join error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // =====================================================
  // GET /api/tournaments/:slug/participants ✅ LISTE DES JOUEURS
  // =====================================================
  router.get("/:slug/participants", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const tRes = await pool.query(
        `SELECT id, name, slug, max_slots
         FROM tournaments
         WHERE slug = $1
         LIMIT 1`,
        [slug]
      );

      if (tRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Tournament not found" });
      }

      const t = tRes.rows[0];

      const pRes = await pool.query(
        `
        SELECT
          u.id,
          u.username,
          u.phantom_id,
          u.country,
          u.rating,
          u.avatar_url,
          p.joined_at
        FROM tournament_participants p
        JOIN users u ON u.id = p.user_id
        WHERE p.tournament_id = $1
        ORDER BY p.joined_at ASC
        `,
        [t.id]
      );

      return res.json({
        ok: true,
        tournament: {
          id: t.id,
          name: t.name,
          slug: t.slug,
          maxSlots: t.max_slots,
          currentSlots: pRes.rowCount,
        },
        participants: pRes.rows.map((r) => ({
          id: r.id,
          username: r.username,
          phantomId: r.phantom_id,
          country: r.country,
          rating: r.rating,
          avatarUrl: r.avatar_url,
          joinedAt: r.joined_at,
        })),
      });
    } catch (err) {
      console.error("GET /api/tournaments/:slug/participants error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  return router;
}
