(() => {
  const root = document.querySelector("[data-banquet-menu]");
  if (!root) return;

  const categoryNav = root.querySelector("[data-menu-categories]");
  const grid = root.querySelector("[data-menu-grid]");
  const countNode = root.querySelector("[data-menu-count]");

  function formatPrice(value) {
    const price = String(value || "").trim();
    if (!price) return "по запросу";
    if (/byn|руб|по запросу/i.test(price)) return price;
    return `${price} BYN`;
  }

  function createCategoryLink(category, index) {
    const link = document.createElement("a");
    link.href = `#menu-category-${index + 1}`;
    link.textContent = category.title;
    return link;
  }

  function createMeta(label, value) {
    const node = document.createElement("span");
    node.className = "menu-item-meta";
    node.textContent = `${label}: ${value}`;
    return node;
  }

  function createMenuItem(item) {
    const article = document.createElement("article");
    const content = document.createElement("div");
    const title = document.createElement("h4");
    const price = document.createElement("strong");

    article.className = "menu-item";
    content.className = "menu-item-content";
    price.className = "menu-item-price";

    title.textContent = item.title;
    content.append(title);

    if (item.description) {
      const description = document.createElement("p");
      description.textContent = item.description;
      content.append(description);
    }

    if (item.amount) {
      const meta = document.createElement("div");
      meta.className = "menu-item-metas";
      meta.append(createMeta("Формат", item.amount));
      content.append(meta);
    }

    price.textContent = formatPrice(item.price);
    article.append(content, price);
    return article;
  }

  function createCategory(category, index) {
    const section = document.createElement("section");
    const head = document.createElement("div");
    const number = document.createElement("span");
    const title = document.createElement("h3");
    const count = document.createElement("p");
    const items = document.createElement("div");

    section.className = "menu-category reveal is-visible";
    section.id = `menu-category-${index + 1}`;
    head.className = "menu-category-head";
    items.className = "menu-items";

    number.textContent = String(index + 1).padStart(2, "0");
    title.textContent = category.title;
    count.textContent = `${category.items.length} поз.`;
    items.append(...category.items.map(createMenuItem));
    head.append(number, title, count);
    section.append(head, items);
    return section;
  }

  function renderMenu(categories) {
    const clean = categories.filter((category) => (
      category
      && typeof category.title === "string"
      && Array.isArray(category.items)
      && category.items.length
    ));

    if (!clean.length) {
      grid.innerHTML = '<p class="empty-state">Меню скоро появится.</p>';
      return;
    }

    const itemsCount = clean.reduce((total, category) => total + category.items.length, 0);
    if (countNode) countNode.textContent = `${clean.length} разделов / ${itemsCount} позиций`;
    categoryNav.replaceChildren(...clean.map(createCategoryLink));
    grid.replaceChildren(...clean.map(createCategory));
  }

  async function loadMenu() {
    try {
      const url = new URL("content/menu.json", document.baseURI);
      url.searchParams.set("v", Date.now().toString());
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Menu request failed: ${response.status}`);
      const content = await response.json();
      renderMenu(Array.isArray(content.categories) ? content.categories : []);
    } catch (error) {
      console.error(error);
      grid.innerHTML = '<p class="empty-state">Не удалось загрузить меню. Напишите нам в Инстаграм - отправим актуальный вариант.</p>';
    }
  }

  loadMenu();
})();
