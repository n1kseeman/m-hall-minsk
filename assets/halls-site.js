(() => {
  const grid = document.querySelector("[data-halls-grid]");
  if (!grid) return;

  function createHallCard(hall) {
    const article = document.createElement("article");
    const imageWrap = document.createElement("div");
    const image = document.createElement("img");
    const label = document.createElement("span");
    const body = document.createElement("div");
    const title = document.createElement("h3");
    const description = document.createElement("p");
    const link = document.createElement("a");

    article.className = "hall-card reveal is-visible";
    imageWrap.className = "hall-card-image";
    label.className = "hall-card-label";
    body.className = "hall-card-body";
    link.className = "btn btn-ghost";

    image.src = Array.isArray(hall.images) && hall.images.length ? hall.images[0] : hall.image;
    image.alt = `${hall.title} M HALL`;
    image.width = 1100;
    image.height = 780;
    image.loading = "lazy";
    image.decoding = "async";

    label.textContent = hall.tagline || "M HALL";
    title.textContent = hall.title;
    description.textContent = hall.description;
    link.href = "#booking";
    link.textContent = "Выбрать дату";

    imageWrap.append(image, label);
    body.append(title, description, link);
    article.append(imageWrap, body);
    return article;
  }

  function renderHalls(halls) {
    const clean = halls.filter((hall) => (
      hall
      && typeof hall.title === "string"
      && typeof hall.description === "string"
      && typeof hall.image === "string"
    ));

    if (!clean.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Информация о зале скоро появится.";
      grid.replaceChildren(empty);
      return;
    }

    grid.replaceChildren(...clean.map(createHallCard));
  }

  async function loadHalls() {
    try {
      const url = new URL("content/halls.json", document.baseURI);
      url.searchParams.set("v", Date.now().toString());
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Halls request failed: ${response.status}`);
      const content = await response.json();
      renderHalls(Array.isArray(content.halls) ? content.halls : []);
    } catch (error) {
      console.warn("Не удалось загрузить залы.", error);
    }
  }

  loadHalls();
})();
