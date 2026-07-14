// Auto-hide past competitions on the homepage.
// Each event <li> carries data-event-end="YYYY-MM-DD". Once that date has
// passed, the event is hidden. With JS off, all events show (safe fallback).
(function () {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var items = document.querySelectorAll("[data-event-end]");
  items.forEach(function (li) {
    var raw = li.getAttribute("data-event-end");
    if (!raw) return;
    var end = new Date(raw + "T23:59:59");
    if (isNaN(end.getTime())) return; // bad date: leave it showing
    if (end < today) {
      li.hidden = true;
    }
  });

  // If every event is now hidden, show a gentle fallback message.
  var list = document.querySelector(".event-list");
  if (list) {
    var visible = Array.prototype.filter.call(
      list.querySelectorAll("[data-event-end]"),
      function (li) { return !li.hidden; }
    );
    if (visible.length === 0 && !list.querySelector(".event-empty")) {
      var note = document.createElement("li");
      note.className = "event-empty";
      note.innerHTML = "<p>No competitions are scheduled right now. Check our <a href=\"calendar.html\">calendar</a> for the latest.</p>";
      list.appendChild(note);
    }
  }
})();
