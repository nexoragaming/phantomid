//Overlay Premium
const upgradeBtn = document.getElementById("upgrade-btn-top");
const premiumOverlay = document.getElementById("premium-overlay");

upgradeBtn.addEventListener("click", function (){
    premiumOverlay.classList.add("active");
})

const closePremiumBtn = document.getElementById("close-premium-overlay");

closePremiumBtn.addEventListener("click", function (){
    premiumOverlay.classList.remove("active");
})

document.addEventListener("keydown", function (event) {
  console.log(event.key);
  if (event.key === "Escape") {
    premiumOverlay.classList.remove("active")
  }
});

premiumOverlay.addEventListener("click", function () {
    premiumOverlay.classList.remove("active")
});

const premiumBox = document.getElementById("premium-box");

premiumBox.addEventListener("click", function (event){
    event.stopPropagation("premium-box")
})


//Overlay Edit PhantomCard
const editPhantomCardOverlay = document.getElementById("edit-phantomcard-overlay");
const editBtn = document.getElementById("edit-btn");
const editPhantomcardBox = document.getElementById("edit-phantomcard-box");

editBtn.addEventListener("click", function (){
    editPhantomCardOverlay.classList.add("active")
})

const phantomCard = document.getElementById("phantomcard");
const overlayCardSlot = document.getElementById("overlay-card-slot");

console.log(phantomCard)

editBtn.addEventListener("click", function (){
     // 1. Vider le slot (au cas où on ouvre plusieurs fois)
    overlayCardSlot.innerHTML = "";

    // 2. Copier la PhantomCard (clone visuel)
    const cardClone = phantomCard.cloneNode(true);

    // 3. IMPORTANT : changer l'id pour éviter les conflits
    cardClone.id = "phantomcard-preview";

    // 4. Ajouter la copie dans l'overlay
    overlayCardSlot.appendChild(cardClone);
    
})


//Overlay setting
const openSettingBtn = document.getElementById("open-setting-btn");
const settingOverlay = document.getElementById("setting-overlay");

openSettingBtn.addEventListener("click", function (){
    settingOverlay.classList.add("active");
})


document.addEventListener("keydown", function (event) {
  console.log(event.key);
  if (event.key === "Escape") {
    settingOverlay.classList.remove("active")
  }
});

settingOverlay.addEventListener("click", function () {
    settingOverlay.classList.remove("active")
});

const settingBox = document.getElementById("setting-box");

settingBox.addEventListener("click", function (event){
    event.stopPropagation("setting-box")
})


console.log("phantomcard.js connecté");

document.addEventListener("DOMContentLoaded", async () => {
  const phantomIdEl = document.getElementById("user-phantomid");
  const usernameEl = document.getElementById("user-username");

  try {
    const resp = await fetch("/me", { method: "GET" });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data.ok || !data.user) {
      // pas logged
      window.location.href = "/index.html?login=required";
      return;
    }

    // ✅ PhantomID
    const phantomId = data.user.phantomId || data.user.phantom_id || "";
    if (phantomIdEl) {
      phantomIdEl.textContent = `@ ${phantomId}`;
    }

    // ✅ Username
    const username = data.user.username || "";
    if (usernameEl) {
      usernameEl.textContent = username;
    }

  } catch (err) {
    console.error(err);
    window.location.href = "/index.html?login=required";
  }
});


//Systeme de rating
// ===== Rating UI (PhantomCard) =====
function applyRatingUI(ratingRaw) {
  const rating = String(ratingRaw || "Unrated").trim();

  const rateIconEl = document.getElementById("rate-icon");
  const userRateEl = document.getElementById("user-rate");

  if (!rateIconEl || !userRateEl) return;

  // Map rating -> (label, color, icon)
  // ⚠️ Remplace les paths par TES fichiers réels (public/assets/...)
  const RATES = {
    Unrated: { label: "Unrated", color: "#9CA3AF", icon: "/novice.png" },

    Bronze: { label: "Bronze", color: "#CD7F32", icon: "/assets/rates/bronze.png" },
    Silver: { label: "Silver", color: "#C0C0C0", icon: "/assets/rates/silver.png" },
    Gold: { label: "Gold", color: "#D4AF37", icon: "/assets/rates/gold.png" },

    Platinum: { label: "Platinum", color: "#4FD1C5", icon: "/assets/rates/platinum.png" },
    Diamond: { label: "Diamond", color: "#60A5FA", icon: "/assets/rates/diamond.png" },

    Master: { label: "Master", color: "#A855F7", icon: "/assets/rates/master.png" },
    Phantom: { label: "Phantom", color: "#FF4DFF", icon: "/assets/rates/phantom.png" },
  };

  // Fallback safe si rating inconnu
  const cfg = RATES[rating] || { label: rating, color: "#9CA3AF", icon: "/assets/rates/unrated.png" };

  // DOM updates
  userRateEl.textContent = cfg.label;
  userRateEl.style.color = cfg.color;

  rateIconEl.src = cfg.icon;
  rateIconEl.alt = `${cfg.label} icon`;
}

// Exemple d’utilisation : après ton fetch /me
// const data = await res.json();
// applyRatingUI(data.user?.rating);
