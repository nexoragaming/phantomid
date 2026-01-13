import express from "express";

const VALID_STATUSES = new Set(["upcoming", "open", "live", "finished"]);

function shuffleInPlace(arr) {
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

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
        return res.status(400).json({ error: "Missing required fields" });
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
          joinedAt: r.joined_at,
        })),
      });
    } catch (err) {
      console.error("GET /api/tournaments/:slug/participants error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // =====================================================
  // GET /api/tournaments/:slug/bracket ✅ LIRE LE BRACKET
  // =====================================================
  router.get("/:slug/bracket", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const tRes = await pool.query(
        `SELECT id
         FROM tournaments
         WHERE slug = $1
         LIMIT 1`,
        [slug]
      );

      if (tRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Tournament not found" });
      }

      const tournamentId = tRes.rows[0].id;

      const mRes = await pool.query(
        `
        SELECT
          m.id,
          m.round,
          m.match_number,
          m.player1_user_id,
          m.player2_user_id,
          m.winner_user_id,
          m.score1,
          m.score2,
          m.created_at,
          u1.username AS player1_username,
          u2.username AS player2_username,
          uw.username AS winner_username
        FROM tournament_matches m
        LEFT JOIN users u1 ON u1.id = m.player1_user_id
        LEFT JOIN users u2 ON u2.id = m.player2_user_id
        LEFT JOIN users uw ON uw.id = m.winner_user_id
        WHERE m.tournament_id = $1
        ORDER BY m.round ASC, m.match_number ASC
        `,
        [tournamentId]
      );

      return res.json({
        ok: true,
        matches: mRes.rows.map((r) => ({
          id: r.id,
          round: r.round,
          matchNumber: r.match_number,
          player1: r.player1_user_id
            ? { userId: r.player1_user_id, username: r.player1_username }
            : null,
          player2: r.player2_user_id
            ? { userId: r.player2_user_id, username: r.player2_username }
            : null,
          winner: r.winner_user_id
            ? { userId: r.winner_user_id, username: r.winner_username }
            : null,
          score1: r.score1,
          score2: r.score2,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      console.error("GET /api/tournaments/:slug/bracket error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // =====================================================
  // POST /api/tournaments/:slug/bracket/generate ✅ GENERER SINGLE ELIM
  // - force=1 pour régénérer si déjà existant
  // =====================================================
  router.post("/:slug/bracket/generate", async (req, res) => {
    const client = await pool.connect();
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Not logged in" });
      }

      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const force = String(req.query.force || "").toLowerCase();
      const allowForce = force === "1" || force === "true" || force === "yes";

      await client.query("BEGIN");

      // 1) tournoi
      const tRes = await client.query(
        `SELECT id, status
         FROM tournaments
         WHERE slug = $1
         LIMIT 1`,
        [slug]
      );
      if (tRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Tournament not found" });
      }

      const tournamentId = tRes.rows[0].id;

      // 2) déjà généré ?
      const existingRes = await client.query(
        `SELECT COUNT(*)::int AS n
         FROM tournament_matches
         WHERE tournament_id = $1`,
        [tournamentId]
      );

      if (existingRes.rows[0].n > 0 && !allowForce) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error: "Bracket already generated. Use ?force=1 to regenerate.",
        });
      }

      // Si force, wipe d'abord
      if (existingRes.rows[0].n > 0 && allowForce) {
        await client.query(`DELETE FROM tournament_matches WHERE tournament_id = $1`, [
          tournamentId,
        ]);
      }

      // 3) participants
      const pRes = await client.query(
        `
        SELECT p.user_id
        FROM tournament_participants p
        WHERE p.tournament_id = $1
        ORDER BY p.joined_at ASC
        `,
        [tournamentId]
      );

      const players = pRes.rows.map((r) => r.user_id);
      if (players.length < 2) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "Not enough participants to generate a bracket (need at least 2).",
        });
      }

      shuffleInPlace(players);

      // 4) bracket size + rounds
      const size = nextPowerOfTwo(players.length);
      const rounds = Math.ceil(Math.log2(size));

      // pad avec null (byes)
      while (players.length < size) players.push(null);

      // 5) Inserts
      // Round 1: matchs avec joueurs
      const inserts = [];

      const round1Matches = size / 2;
      for (let m = 1; m <= round1Matches; m++) {
        const p1 = players[(m - 1) * 2];
        const p2 = players[(m - 1) * 2 + 1];

        inserts.push(
          client.query(
            `
            INSERT INTO tournament_matches
              (tournament_id, round, match_number, player1_user_id, player2_user_id, winner_user_id, score1, score2)
            VALUES
              ($1,$2,$3,$4,$5,NULL,NULL,NULL)
            ON CONFLICT (tournament_id, round, match_number) DO NOTHING
            `,
            [tournamentId, 1, m, p1, p2]
          )
        );
      }

      // Rounds suivants: placeholders (players null)
      for (let r = 2; r <= rounds; r++) {
        const matchesInRound = size / Math.pow(2, r);
        for (let m = 1; m <= matchesInRound; m++) {
          inserts.push(
            client.query(
              `
              INSERT INTO tournament_matches
                (tournament_id, round, match_number, player1_user_id, player2_user_id, winner_user_id, score1, score2)
              VALUES
                ($1,$2,$3,NULL,NULL,NULL,NULL,NULL)
              ON CONFLICT (tournament_id, round, match_number) DO NOTHING
              `,
              [tournamentId, r, m]
            )
          );
        }
      }

      await Promise.all(inserts);

      await client.query("COMMIT");

      return res.json({
        ok: true,
        tournamentId,
        players: players.filter((x) => x !== null).length,
        bracketSize: size,
        rounds,
        message: "Bracket generated.",
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      console.error("POST /api/tournaments/:slug/bracket/generate error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    } finally {
      client.release();
    }
  });

  return router;
}
