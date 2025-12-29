console.log("linking.js connecté");

// === DOM ===
const discordStatus = document.getElementById("discord-status");
const discordBtn = document.getElementById("discord-connect");
const discordConnected = document.getElementById("discord-connected");

// === Params URL ===
const params = new URLSearchParams(window.location.search);
const discordParam = params.get("discord"); // "linked" | null

// === UI STATE ===
if (discordParam === "linked") {
  if (discordStatus) discordStatus.textContent = "Linked ✅";

  if (discordBtn) {
    discordBtn.classList.add("connected");
    discordBtn.disabled = true;
  }

  if (discordConnected) {
    discordConnected.classList.add("active");
  }

  // petit délai UX avant redirection
  setTimeout(() => {
    window.location.href = "/phantomcard.html";
  }, 600);

} else {
  if (discordStatus) discordStatus.textContent = "Not linked";

  if (discordBtn) {
    discordBtn.disabled = false;
  }
}

// === CLICK → OAuth Discord (DOMAINE PUBLIC) ===
if (discordBtn) {
  discordBtn.addEventListener("click", () => {
    window.location.href = "https://phantomid.onrender.com/auth/discord";
  });
}