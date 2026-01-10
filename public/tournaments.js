// public/tournaments.js

const searchInput = document.getElementById("tournament-search");
const gameSelect = document.getElementById("tournament-game");
const regionSelect = document.getElementById("tournament-region");

const containers = {
  upcoming: document.getElementById("list-upcoming"),
  open: document.getElementById("list-open"),
  live: document.getElementById("list-live"),
  finished: document.getElementById("list-finished"),
};

const template = document.getElementById("tournament-card-template");

// --------------------
// Helpers
// --------------------
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

function clearAll() {
  Object.values(containers).forEach((c) => {
    if (c) c.innerHTML = "";
  });
}

// ✅ PAS de <button>: action = <div> cliquable
function makeAction(label, className, slug) {
  const el = document.createElement("div");

  el.className = `tournament-action ${className}`;
  el.textContent = label;

  if (slug) el.setAttribute("data-slug", slug);

  // Styles inline pour être sûr que ton CSS ne cache pas le texte
  el.style.border = "2px solid #d1d1d1d1";
  el.style.borderRadius = "6px";
  el.style.padding = "10px";
  el.style.textAlign = "center";
  el.style.cursor = "pointer";
  el.style.userSelect = "none";
  el.style.color = "white";
  el.style.background = "transparent";
  el.style.minWidth = "90px";

  return el;
}

// --------------------
// Render
// --------------------
function renderTournament(t, status) {
  const node = template.content.cloneNode(true);

  const img = node.querySelector(".tournament-image");
  img.src = t.bannerUrl || "";
  img.alt = t.name || "Tournament";

  node.querySelector(".tournament-name").textContent = t.name || "Tournament";
  node.querySelector(".tournament-organizer").textContent = `By: ${t.organizer || "Unknown"}`;

  node.querySelector(".tournament-info").textContent =
    `${t.region || ""} • ${formatDate(t.startDate)} • ${t.format || ""}`;

  const meta = node.querySelector(".tournament-meta");
  if (status === "open") {
    meta.textContent = `${t.currentSlots ?? 0}/${t.maxSlots ?? 0} players`;
  } else if (status === "upcoming") {
    meta.textContent = `Capacity: ${t.maxSlots ?? 0} players`;
  } else {
    meta.textContent = "";
  }

  const actionsBox = node.querySelector(".tournaments-button");

  // Actions selon status
  if (status === "upcoming") {
    actionsBox.appendChild(makeAction("Pre-register", "action-preregister", t.slug));
    actionsBox.appendChild(makeAction("More info", "action-info", t.slug));
  }

  if (status === "open") {
    actionsBox.appendChild(makeAction("Join now", "action-join", t.slug));
    actionsBox.appendChild(makeAction("More info", "action-info", t.slug));
  }

  if (status === "live") {
    actionsBox.appendChild(makeAction("View bracket", "action-bracket", t.slug));
    actionsBox.appendChild(makeAction("Tournament stats", "action-stats", t.slug));
  }

  if (status === "finished") {
    actionsBox.appendChild(makeAction("View results", "action-results", t.slug));
  }

  const container = containers[status];
  if (container) container.appendChild(node);
}

// --------------------
// Fetch + load
// --------------------
async function loadTournaments() {
  const params = new URLSearchParams();

  const search = (searchInput?.value || "").trim();
  const game = (gameSelect?.value || "").trim();
  const region = (regionSelect?.value || "").trim();

  if (search) params.set("search", search);
  if (game) params.set("game", game);
  if (region) params.set("region", region);

  try {
    const res = await fetch(`/api/tournaments?${params.toString()}`);
    const data = await res.json();

    clearAll();

    // ordre stable
    ["upcoming", "open", "live", "finished"].forEach((status) => {
      const list = data?.[status] || [];
      list.forEach((t) => renderTournament(t, status));
    });
  } catch (err) {
    console.error("loadTournaments error:", err);
    clearAll();
  }
}

// --------------------
// Click actions (Join)
// --------------------
document.addEventListener("click", async (e) => {
  const joinEl = e.target.closest(".action-join");
  if (!joinEl) return;

  const slug = joinEl.getAttribute("data-slug");
  if (!slug) {
    alert("Missing tournament slug");
    return;
  }

  const oldText = joinEl.textContent;
  joinEl.textContent = "Joining...";
  joinEl.style.pointerEvents = "none";

  try {
    const res = await fetch(`/api/tournaments/${slug}/join`, { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      alert(data?.error || "Unable to join tournament");
      joinEl.textContent = oldText;
      joinEl.style.pointerEvents = "auto";
      return;
    }

    // refresh
    await loadTournaments();
  } catch (err) {
    console.error("join error:", err);
    alert("Network error");
    joinEl.textContent = oldText;
    joinEl.style.pointerEvents = "auto";
  }
});

// --------------------
// Filters
// --------------------
if (searchInput) searchInput.addEventListener("input", loadTournaments);
if (gameSelect) gameSelect.addEventListener("change", loadTournaments);
if (regionSelect) regionSelect.addEventListener("change", loadTournaments);

// First load
loadTournaments();
