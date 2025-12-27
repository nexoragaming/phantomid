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
