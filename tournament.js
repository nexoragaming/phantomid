import express from "express";

const VALID_STATUSES = new Set(["upcoming", "open", "live", "finished"]);

export default function createTournamentRouter(pool) {
  const router = express.Router();

  // GET /api/tournaments?search=&game=&region=&status=
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

  // POST /api/tournaments
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
          error: "Missing required fields: name, organizer, game, region, startAt.",
        });
      }

      const normalizedStatus = String(status).toLowerCase();
      if (!VALID_STATUSES.has(normalizedStatus)) {
        return res.status(400).json({ error: "Invalid status (upcoming|open|live|finished)." });
      }

      const maxSlotsInt = Number(maxSlots);
      if (!Number.isInteger(maxSlotsInt) || maxSlotsInt < 2 || maxSlotsInt > 2048) {
        return res.status(400).json({ error: "maxSlots must be an integer between 2 and 2048." });
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
      if (err?.code === "23505") {
        return res.status(409).json({ error: "Tournament already exists (unique constraint)." });
      }
      return res.status(500).json({ error: "Server error creating tournament." });
    }
  });

  return router;
}

