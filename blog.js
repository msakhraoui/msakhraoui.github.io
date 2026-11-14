"use strict";
(() => {
  const posts = [
    { title: "Internal confidence", date:"2026-11-14",
      body:"Do we worry about external factors or do we worry about what's inside of ourselves, those 2 different things are the 2 measures of confidence. Positive and Negative confidence. Negative confidence is the EGOcentric person, who bases all of their performance trying to achieve their likeness, their thumbs up cuz we value their opinion. Those kinda people allow the external factors to dictate their performance of the day. \n\nThere's also another side, the other side of confidence that starts from within, its called pride, that doesnt value if someoen in the corner is looking at them, the pride that's always in there, burning for the idioligy of greatness. Who stand up and picks up the trash when none's lookin'? who does that? its the same person who's on top of the podium later in life. at the topest level of compition Everyone has a talent, everyone has the perseverance, and everyone wants it. But somebody wants it more, someone's heartbeat is constantly beating for it, not just when people are watching." },
  ];

  const layout = document.getElementById("layout");
  const list = document.getElementById("blogList");
  const reader = document.getElementById("reader");
  const closeBtn = document.getElementById("readerClose");
  let lastRow = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  }

  function renderList() {
    list.replaceChildren();
    if (posts.length === 0) {
      const row = el("div", "blogPost", "");
      row.append(el("span", "blogPostTitle", "Coming soon"));
      list.append(row);
      return;
    }
    for (const post of posts) {
      const row = el("button", "blogPost", "");
      row.type = "button";
      row.append(el("span", "blogPostTitle", post.title),
                 el("span", "blogPostDate", post.date));
      row.addEventListener("click", () => openPost(post, row));
      list.append(row);
    }
  }

  function openPost(post, row) {
    lastRow = row;
    document.getElementById("readerTitle").textContent = post.title;
    document.getElementById("readerDate").textContent = post.date;
    document.getElementById("readerBody").replaceChildren(
      ...post.body.split("\n\n").map((t) => el("p", "", t)));
    layout.classList.add("reading");
    reader.inert = false;
    closeBtn.focus();
  }

  function closePost() {
    layout.classList.remove("reading");
    reader.inert = true;
    if (lastRow) lastRow.focus();
  }

  closeBtn.addEventListener("click", closePost);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePost(); });
  renderList();
})();
