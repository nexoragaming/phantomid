function getSlug() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("slug") || "").trim();
}

function el(id) {
  return document.getElementById(id);
}

function safeText(v) {
  return v == null ? "" : String(v);
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function participantRow(p) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "space-between";
  row.style.border = "1px solid #d1d1d1d1";
  row.style.padding = "8px";
  row.style.borderRadius = "6px";

  const left = document.createElement("div");
  left.innerHTML = `<strong>${safeText(p.username)}</strong> <span style="opacity:.75;">(${safeText(p.phantomId)})</span>`;

  const right = document.createElement("div");
  right.style.opacity = "0.8";
  right.textContent = safeText(p.country || "");

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

// Bracket MVP renderer (round columns)
function renderBracket(matches) {
  const wrap = el("bracket-view");
  wrap.innerHTML = "";

  if (!Array.isArray(matches) || matches.length === 0) {
    el("bracket-status").textContent = "No bracket generated yet.";
    return;
  }

  el("bracket-status").textContent = "";

  // group by round
  const byRound = new Map();
  for (const m of matches) {
    const r = Number(m.round || 1);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }

  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);

  for (const r of rounds) {
    const col = document.createElement("div");
    col.style.minWidth = "220px";
    col.style.border = "1px solid #d1d1d1d1";
    col.style.borderRadius = "8px";
    col.style.padding = "10px";

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";
    title.textContent = `Round ${r}`;
    col.appendChild(title);

    const list = byRound.get(r).sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0));
    for (const m of list) {
      const card = document.createElement("div");
      card.style.border = "1px solid #d1d1d1d1";
      card.style.borderRadius = "8px";
      card.style.padding = "10px";
      card.style.marginBottom = "10px";

      const p1 = safeText(m.player1Name || "TBD");
      const p2 = safeText(m.player2Name || "TBD");

      const winner = m.winnerName ? `Winner: ${m.winnerName}` : "";

      card.innerHTML = `
        <div style="opacity:.7; font-size:12px; margin-bottom:6px;">Match #${safeText(m.matchNumber)}</div>
        <div>${p1}</div>
        <div style="opacity:.6;">vs</div>
        <div>${p2}</div>
        ${winner ? `<div style="margin-top:8px; opacity:.85; font-size:12px;">${winner}</div>` : ""}
      `;

      col.appendChild(card);
    }

    wrap.appendChild(col);
  }
}

async function load() {
  const slug = getSlug();
  if (!slug) {
    el("t-title").textContent = "Tournament not found";
    return;
  }

  // 1) details
  const tRes = await fetch(`/api/tournaments/${encodeURIComponent(slug)}`);
  const tData = await tRes.json();
  if (!tRes.ok || !tData?.ok) {
    el("t-title").textContent = "Tournament not found";
    return;
  }

  const t = tData.tournament;
  el("t-title").textContent = safeText(t.name);
  el("t-meta").textContent = `${safeText(t.game)} • ${safeText(t.region)} • ${safeText(t.format)} • ${formatDate(t.startAt)} • Status: ${safeText(t.status)}`;

  // 2) participants
  const pRes = await fetch(`/api/tournaments/${encodeURIComponent(slug)}/participants`);
  const pData = await pRes.json();

  el("p-list").innerHTML = "";
  if (pRes.ok && pData?.ok) {
    el("p-count").textContent = `${pData.tournament.currentSlots}/${pData.tournament.maxSlots} players`;

    for (const p of pData.participants) {
      el("p-list").appendChild(participantRow(p));
    }
  } else {
    el("p-count").textContent = "Unable to load participants";
  }

  // 3) bracket
  const bRes = await fetch(`/api/tournaments/${encodeURIComponent(slug)}/bracket`);
  const bData = await bRes.json();

  if (bRes.ok && bData?.ok) {
    renderBracket(bData.matches);
  } else {
    el("bracket-status").textContent = "Bracket endpoint not ready yet.";
  }
}

load().catch((err) => {
  console.error(err);
});
