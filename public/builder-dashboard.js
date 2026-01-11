const openCreateTournament = document.getElementById("open-create-tournament");
const createTournamentOverlay =document.getElementById("create-tournament-overlay");

openCreateTournament.addEventListener("click", function () {
  createTournamentOverlay.classList.add("active");
});


const closeCreateBtn = document.getElementById("close-create-overlay");
    closeCreateBtn.addEventListener("click", function () {
        createTournamentOverlay.classList.remove("active");
    });


document.addEventListener("keydown", function (event) {
  console.log(event.key);
  if (event.key === "Escape") {
  loginOverlay.classList.remove("active")
}
});

createTournamentOverlay.addEventListener("click", function () {
    createTournamentOverlay.classList.remove("active")
});

const createFormBox = document.getElementById("create-form-box");

createFormBox.addEventListener("click", function (event){
    event.stopPropagation("create-form-box")
})