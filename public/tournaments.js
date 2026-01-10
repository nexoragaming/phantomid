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

// ===============
// Fetch + render
// ===============
async function loadTournaments() {
  const params = new URLSearchParams();
  if (searchInput.value) params.set("search", searchInput.value);
  if (gameSelect.value) params.set("game", gameSelect.value);
  if (regionSelect.value) params.set("region", regionSelect.value);

  const res = await fetch(`/api/tournaments?${params.toString()}`);
  const data = await res.json();

  // clear sections
  Object.values(containers).forEach((c) => (c.innerHTML = ""));

  // render in each section
  for (const status of ["upcoming", "open", "live", "finished"]) {
    const list = data[status] || [];
    list.forEach((t) => renderTournament(t, status));
  }
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

function makeAction(label, className, slug) {
  // ✅ PAS un <button> — un div cliquable
  const el = document.createElement("div");
  el.className = `tournament-action ${className}`;
  el.textContent = label;
  if (slug) el.dataset.slug = slug;
  return el;
}

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
    meta.textContent = ""; // live/finished: tu peux mettre autre chose plus tard
  }

  const actionsBox = node.querySelector(".tournaments-button");

  // ✅ Actions selon status (sans <button>)
  if (status === "upcoming") {
    actionsBox.appendChild(makeAction("Pre-register (Premium)", "action-preregister", t.slug));
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

  containers[status].appendChild(node);
}

// =======================
// Event delegation actions
// =======================
document.addEventListener("click", async (e) => {
  const joinEl = e.target.closest(".action-join");
  if (!joinEl) return;

  const slug = joinEl.dataset.slug;
  if (!slug) return;

  // UI feedback
  const old = joinEl.textContent;
  joinEl.textContent = "Joining...";
  joinEl.style.pointerEvents = "none";

  try {
    const res = await fetch(`/api/tournaments/${slug}/join`, { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      alert(data?.error || "Unable to join tournament");
      joinEl.textContent = old;
      joinEl.style.pointerEvents = "auto";
      return;
    }

    // refresh list to update counter
    await loadTournaments();
  } catch (err) {
    console.error(err);
    alert("Network error");
    joinEl.textContent = old;
    joinEl.style.pointerEvents = "auto";
  }
});

// ===============
// Filter listeners
// ===============
searchInput.addEventListener("input", loadTournaments);
gameSelect.addEventListener("change", loadTournaments);
regionSelect.addEventListener("change", loadTournaments);

// first load
loadTournaments();
