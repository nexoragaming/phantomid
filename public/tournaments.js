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

async function loadTournaments() {
  const params = new URLSearchParams({
    search: searchInput.value,
    game: gameSelect.value,
    region: regionSelect.value,
  });

  const res = await fetch(`/api/tournaments?${params.toString()}`);
  const data = await res.json();

  Object.values(containers).forEach(c => c.innerHTML = "");

  for (const status in data) {
    data[status].forEach(t => renderTournament(t, status));
  }
}

function renderTournament(t, status) {
  const node = template.content.cloneNode(true);

  node.querySelector(".tournament-image").src = t.bannerUrl || "";
  node.querySelector(".tournament-name").textContent = t.name;
  node.querySelector(".tournament-organizer").textContent = `By ${t.organizer}`;
  node.querySelector(".tournament-info").textContent =
    `${t.region} • ${new Date(t.startDate).toLocaleDateString()} • ${t.format}`;

  const meta = node.querySelector(".tournament-meta");
  if (status === "open") {
    meta.textContent = `${t.currentSlots}/${t.maxSlots} players`;
  }

  const buttons = node.querySelector(".tournaments-button");

  if (status === "upcoming") {
    buttons.innerHTML = `<button>Pre-register (Premium)</button>`;
  } else if (status === "open") {
    buttons.innerHTML = `<button>Join now</button>`;
  } else if (status === "live") {
    buttons.innerHTML = `
      <button>View bracket</button>
      <button>Stats</button>
    `;
  } else if (status === "finished") {
    buttons.innerHTML = `<button>View results</button>`;
  }

  containers[status].appendChild(node);
}

searchInput.addEventListener("input", loadTournaments);
gameSelect.addEventListener("change", loadTournaments);
regionSelect.addEventListener("change", loadTournaments);

loadTournaments();
