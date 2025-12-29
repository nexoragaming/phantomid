console.log("linking.js connecté");

const discordStatus = document.getElementById("discord-status");
const discordBtn = document.getElementById("discord-connect");
const discordConnect = document.getElementById("discord-connected")

// 1) Lire le paramètre ?discord=...
const params = new URLSearchParams(window.location.search);
const discordParam = params.get("discord"); // "linked" ou null

// 2) Mettre l'UI selon le paramètre
if (discordParam === "linked") {
  if (discordStatus) discordStatus.textContent = "Linked ✅";
  if (discordBtn) {
    discordBtn.classList.add("connected");
    discordConnect.classList.add("active");
  }
} else {
  if (discordStatus) discordStatus.textContent = "Not linked";
  if (discordBtn) {

    discordBtn.disabled = false;
  }
}

// 3) Click → démarre OAuth

if (discordBtn) {
  discordBtn.addEventListener("click", () => {
    window.location.href = "https://phantomid.onrender.com/auth/discord";
  });
}

const param = new URLSearchParams(window.location.search);

if (param.get("discord") === "linked") {
  // Discord OK → continuer
  window.location.href = "/phantomcard.html";
}
