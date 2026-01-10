const form = document.getElementById("create-form");
const msg = document.getElementById("msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Creating...";

  const fd = new FormData(form);
  const startAtRaw = fd.get("startAt"); // YYYY-MM-DDTHH:mm
  const startAtISO = startAtRaw ? `${startAtRaw}:00` : null;

  const payload = {
    name: fd.get("name"),
    organizer: fd.get("organizer"),
    game: fd.get("game"),
    region: fd.get("region"),
    format: fd.get("format"),
    status: fd.get("status"),
    startAt: startAtISO,
    maxSlots: Number(fd.get("maxSlots") || 32),
    bannerUrl: fd.get("bannerUrl") || null,
  };

  try {
    const res = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      msg.textContent = data?.error || "Error creating tournament.";
      return;
    }

    msg.textContent = "Created! Redirecting...";
    window.location.href = "/tournaments-final-version.html";
  } catch (err) {
    console.error(err);
    msg.textContent = "Network/server error.";
  }
});
