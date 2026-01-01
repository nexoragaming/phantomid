//Overlay Premium
const upgradeBtn = document.getElementById("upgrade-btn-top");
const premiumOverlay = document.getElementById("premium-overlay");

upgradeBtn?.addEventListener("click", function () {
  premiumOverlay?.classList.add("active");
});

const closePremiumBtn = document.getElementById("close-premium-overlay");

closePremiumBtn?.addEventListener("click", function () {
  premiumOverlay?.classList.remove("active");
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    premiumOverlay?.classList.remove("active");
    settingOverlay?.classList.remove("active");
    editPhantomCardOverlay?.classList.remove("active");
  }
});

premiumOverlay?.addEventListener("click", function () {
  premiumOverlay.classList.remove("active");
});

const premiumBox = document.getElementById("premium-box");

premiumBox?.addEventListener("click", function (event) {
  event.stopPropagation();
});

//Overlay Edit PhantomCard
const editPhantomCardOverlay = document.getElementById("edit-phantomcard-overlay");
const editBtn = document.getElementById("edit-btn");
const editPhantomcardBox = document.getElementById("edit-phantomcard-box");

editBtn?.addEventListener("click", function () {
  editPhantomCardOverlay?.classList.add("active");
});

const phantomCard = document.getElementById("phantomcard");
const overlayCardSlot = document.getElementById("overlay-card-slot");

editBtn?.addEventListener("click", function () {
  if (!overlayCardSlot || !phantomCard) return;

  // 1. Vider le slot (au cas où on ouvre plusieurs fois)
  overlayCardSlot.innerHTML = "";

  // 2. Copier la PhantomCard (clone visuel)
  const cardClone = phantomCard.cloneNode(true);

  // 3. IMPORTANT : changer l'id pour éviter les conflits
  cardClone.id = "phantomcard-preview";

  // 4. Ajouter la copie dans l'overlay
  overlayCardSlot.appendChild(cardClone);
});

editPhantomCardOverlay?.addEventListener("click", function () {
  editPhantomCardOverlay.classList.remove("active");
});

editPhantomcardBox?.addEventListener("click", function (event) {
  event.stopPropagation();
});

//Overlay setting
const openSettingBtn = document.getElementById("open-setting-btn");
const settingOverlay = document.getElementById("setting-overlay");

openSettingBtn?.addEventListener("click", function () {
  settingOverlay?.classList.add("active");
});

settingOverlay?.addEventListener("click", function () {
  settingOverlay.classList.remove("active");
});

const settingBox = document.getElementById("setting-box");

settingBox?.addEventListener("click", function (event) {
  event.stopPropagation();
});

console.log("phantomcard.js connecté");

// =====================================================
// Systeme de rating
// =====================================================
function applyRatingUI(ratingRaw) {
  const rating = String(ratingRaw || "Unrated").trim();

  const rateIconEl = document.getElementById("rate-icon");
  const userRateEl = document.getElementById("user-rate");

  if (!rateIconEl || !userRateEl) return;

  // ⚠️ Ajuste juste les paths si tes images sont ailleurs
  const RATES = {
    Unrated: { label: "Unrated", color: "#9CA3AF", icon: "/assets/rate-icon/novice.png" },

    Novice: { label: "Novice", color: "#CD7F32", icon: "/assets/rate-icon/novice.png" },
    Adept: { label: "Adept", color: "#C0C0C0", icon: "/assets/rates-icon/adept.png" },
    Expert: { label: "Expert", color: "#D4AF37", icon: "/assets/rates-icon/expert.png" },

    Elite: { label: "Elite", color: "#4FD1C5", icon: "/assets/rates-icon/elite.png" },
    Master: { label: "Master", color: "#60A5FA", icon: "/assets/rates-icon/master.png" },
    Grandmaster: { label: "Grandmaster", color: "#A855F7", icon: "/assets/rates-icon/grandmaster.png" },
    Legend: { label: "Legend", color: "#A855F7", icon: "/assets/rates-icon/legend.png" },
    Immortal: { label: "Immortal", color: "#8B5088", icon: "/assets/rates-icon/immortal-icon.png" },
  };

  const cfg = RATES[rating] || RATES.Unrated;

  userRateEl.textContent = cfg.label;
  userRateEl.style.color = cfg.color;

  rateIconEl.src = cfg.icon;
  rateIconEl.alt = `${cfg.label} icon`;
}

// =====================================================
// Avatar + Badges (Premium / Verified / Builder)
// =====================================================
// IMPORTANT: Ces IDs doivent exister dans ton HTML :
// - Avatar: <img id="profile-avatar" ...>
// - Badges: <img id="badge-premium"> <img id="badge-verified"> <img id="badge-builder">
function applyAvatarAndBadges(user) {
  // Avatar
  const avatarEl = document.getElementById("profile-avatar");
  const fallbackAvatar = "/assets/phantomid-logo.png";
  const avatarUrl = (user?.avatarUrl && String(user.avatarUrl).trim()) || fallbackAvatar;

  if (avatarEl) {
    avatarEl.src = avatarUrl;
    avatarEl.alt = "Profile avatar";
  }

  // Badges
  const premiumEl = document.getElementById("badge-premium");
  const verifiedEl = document.getElementById("badge-verified");
  const builderEl = document.getElementById("badge-builder");

  const toggle = (el, on) => {
    if (!el) return;
    el.style.display = on ? "inline-flex" : "none";
  };

  toggle(premiumEl, !!user?.badges?.premium);
  toggle(verifiedEl, !!user?.badges?.verified);
  toggle(builderEl, !!user?.badges?.builder);
}

// =====================================================
// Load user data + apply rating + avatar + badges
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  const phantomIdEl = document.getElementById("user-phantomid");
  const usernameEl = document.getElementById("user-username");

  try {
    const resp = await fetch("/me", { method: "GET", credentials: "include" });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data.ok || !data.user) {
      // pas logged
      window.location.href = "/?login=required";
      return;
    }

    // ✅ PhantomID
    const phantomId = data.user.phantomId || data.user.phantom_id || "";
    if (phantomIdEl) phantomIdEl.textContent = `@ ${phantomId}`;

    // ✅ Username
    const username = data.user.username || "";
    if (usernameEl) usernameEl.textContent = username;

    // ✅ Rating
    applyRatingUI(data.user.rating);

    // ✅ Avatar + Badges
    applyAvatarAndBadges(data.user);
  } catch (err) {
    console.error(err);
    window.location.href = "/?login=required";
  }
});
