(() => {
  "use strict";

  const dataElement = document.getElementById("report-data");
  let report;
  try {
    report = JSON.parse(dataElement.textContent || "{}");
  } catch {
    document.getElementById("subtitle").textContent = "Could not parse report data.";
    return;
  }

  const products = Array.isArray(report.products) ? report.products : [];
  const state = {
    query: "",
    gpu: "all",
    ram: "all",
    stock: "all",
    sort: "effective-asc",
    selected: null,
  };

  const tableBody = document.getElementById("table-body");
  const emptyState = document.getElementById("empty-state");
  const resultCount = document.getElementById("result-count");
  const subtitle = document.getElementById("subtitle");
  const contentGrid = document.querySelector(".content-grid");
  const detailPanel = document.getElementById("detail-panel");
  const panelContent = document.getElementById("panel-content");
  const panelBackdrop = document.getElementById("panel-backdrop");
  const searchInput = document.getElementById("search");
  const gpuFilter = document.getElementById("gpu-filter");
  const ramFilter = document.getElementById("ram-filter");
  const stockFilter = document.getElementById("stock-filter");
  const sortSelect = document.getElementById("sort-select");

  const moneyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  const moneyExactFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function append(parent, ...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (typeof child === "string" || typeof child === "number") {
        parent.appendChild(document.createTextNode(String(child)));
      } else if (child instanceof Node) {
        parent.appendChild(child);
      }
    }
    return parent;
  }

  function formatMoney(amount) {
    if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
      return null;
    }
    return Number(amount) % 1 === 0
      ? moneyFormatter.format(Number(amount))
      : moneyExactFormatter.format(Number(amount));
  }

  function formatDate(value) {
    if (!value) return "unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function keyFor(product) {
    return product.id || product.asin || product.requestedUrl || product.inputUrl;
  }

  function fieldText(field, unit) {
    if (!field || field.value === null || field.value === undefined) {
      return field?.verification === "not_applicable" ? "n/a" : "unknown";
    }
    if (typeof field.value === "object") {
      if (typeof field.value.min === "number" && typeof field.value.max === "number") {
        return `${field.value.min}–${field.value.max}${unit ? ` ${unit}` : ""}`;
      }
      return JSON.stringify(field.value);
    }
    return `${field.value}${unit ? ` ${unit}` : ""}`;
  }

  function fieldIsUnknown(field) {
    return !field || field.value === null || field.value === undefined;
  }

  function verificationLabel(field) {
    return {
      verified: "verified",
      unverified: "listing claim",
      unknown: "unknown",
      not_applicable: "n/a",
    }[field?.verification] || "unknown";
  }

  function verificationClass(field) {
    return `verify verify-${field?.verification || "unknown"}`;
  }

  function fieldTitle(field) {
    if (!field) return "Not found";
    const parts = [];
    if (field.source) {
      const section = field.source.section ? ` · ${field.source.section}` : "";
      parts.push(`Source: ${field.source.type}${section}`);
      if (field.source.url) parts.push(field.source.url);
    }
    if (field.qualification) parts.push(field.qualification);
    if (field.rawText) parts.push(`Raw: ${field.rawText}`);
    return parts.join("\n");
  }

  function shortCpu(value) {
    if (!value) return "CPU unknown";
    let text = value.replace(/^AMD\s+/i, "").replace(/^Intel\s+/i, "");
    text = text.replace(/^Ryzen\s+([3579])\s+/i, "R$1 ");
    text = text.replace(/^Core\s+Ultra\s+/i, "Ultra ");
    text = text.replace(/^Core\s+/i, "");
    return text;
  }

  function shortGpu(value) {
    if (!value) return "GPU unknown";
    return value
      .replace(/^NVIDIA\s+GeForce\s+/i, "")
      .replace(/^AMD\s+/i, "")
      .replace(/\s+Laptop GPU$/i, "");
  }

  function compactDisplay(value) {
    if (!value) return "—";
    const compact = String(value)
      .replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return compact || String(value);
  }

  function shortName(product) {
    const title = product.title || "";
    let name = title.split(/\s*\|\s*|\s*\(/)[0].trim();
    name = name
      .replace(/\s+(?:AMD|Intel|Ryzen|Core|NVIDIA|GeForce|RTX|GTX|with|Windows)\b.*$/i, "")
      .trim();
    if (!name) {
      name = [product.brand?.value, product.model?.value].filter(Boolean).join(" ");
    }
    if (!name) name = "Untitled laptop";
    return name.length > 46 ? `${name.slice(0, 44)}…` : name;
  }

  function brandLabel(brand) {
    if (!brand) return "?";
    const normalized = brand.toUpperCase();
    if (normalized === "HP") return "HP";
    if (normalized === "MSI") return "M";
    return normalized.charAt(0);
  }

  function brandColors(brand) {
    const palettes = [
      ["#2c2c35", "#f4f4f5"],
      ["#173b33", "#86efac"],
      ["#301c1c", "#fca5a5"],
      ["#1f2d46", "#93c5fd"],
      ["#31271a", "#fcd34d"],
      ["#2b1f3a", "#d8b4fe"],
      ["#1e2e2a", "#a7f3d0"],
    ];
    const value = String(brand || "unknown");
    let hash = 0;
    for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return palettes[hash % palettes.length];
  }

  function brandTile(product) {
    const brand = product.brand?.value || "Unknown";
    const colors = brandColors(brand);
    const tile = el("span", "brand-tile", brandLabel(brand));
    tile.style.background = colors[0];
    tile.style.color = colors[1];
    tile.title = brand;
    return tile;
  }

  function productImage(product, className) {
    const wrapper = el("span", `product-image ${className}`);
    if (product.imageUrl) {
      const image = el("img");
      image.src = product.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.remove();
        wrapper.appendChild(brandTile(product));
      });
      wrapper.appendChild(image);
    } else {
      wrapper.appendChild(brandTile(product));
    }
    return wrapper;
  }

  function effectivePrice(product) {
    const full = product.price?.conditionalBestPrice ?? null;
    const listed = product.price?.listedPrice ?? null;
    return {
      amount: full?.amount ?? listed?.amount ?? null,
      conditional: full !== null,
      offerId: product.price?.conditionalOfferId ?? null,
    };
  }

  function emiPrice(product) {
    return product.price?.emiConditionalBestPrice?.amount ?? null;
  }

  function discountPct(product) {
    const mrp = product.price?.mrp?.amount ?? null;
    const effective = effectivePrice(product).amount;
    if (!mrp || !effective || mrp <= 0 || effective >= mrp) return null;
    return Math.round(((mrp - effective) / mrp) * 100);
  }

  function gpuPower(product) {
    const base = product.gpu?.baseTgpW?.value ?? null;
    const max = product.gpu?.maxGraphicsPowerW?.value ?? null;
    if (base !== null && max !== null && base !== max) return `${base}–${max}W`;
    if (base !== null) return `${base}W`;
    if (max !== null) return `${max}W`;
    return "—";
  }

  function cpuPower(product) {
    const base = product.cpu?.baseTdpW?.value ?? null;
    const configurable = product.cpu?.configurableTdpW?.value ?? null;
    const turbo = product.cpu?.maxTurboPowerW?.value ?? null;
    if (base !== null) return `${base}W`;
    if (configurable) return `${configurable.min}–${configurable.max}W`;
    if (turbo !== null) return `max ${turbo}W`;
    return "—";
  }

  function stockInfo(product) {
    const status = product.extraction?.status;
    if (status === "blocked") return { label: "Blocked", className: "chip chip-out" };
    if (status === "failed") return { label: "Failed", className: "chip chip-out" };
    if (status === "unavailable") return { label: "Unavailable", className: "chip chip-neutral" };
    if (status === "skipped") return { label: "Skipped", className: "chip chip-neutral" };
    const value = product.availability?.value;
    if (value === "in_stock") return { label: "In stock", className: "chip chip-instock" };
    if (value === "limited_stock") return { label: "Low stock", className: "chip chip-low" };
    if (value === "out_of_stock") return { label: "Out of stock", className: "chip chip-out" };
    return { label: "Unknown", className: "chip chip-neutral" };
  }

  function isInStock(product) {
    return ["in_stock", "limited_stock"].includes(product.availability?.value);
  }

  function productSubline(product) {
    const parts = [
      shortCpu(product.cpu?.model?.value),
      shortGpu(product.gpu?.model?.value),
    ];
    if (product.gpu?.vramGb?.value !== null && product.gpu?.vramGb?.value !== undefined) {
      parts.push(`${product.gpu.vramGb.value}GB`);
    }
    return parts.join(" · ");
  }

  function populateFilters() {
    const gpuTypes = Array.from(
      new Set(products.map((product) => product.gpu?.type || "unknown")),
    ).sort();
    for (const type of gpuTypes) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = {
        discrete: "Discrete",
        integrated: "Integrated",
        unknown: "Unknown",
      }[type] || type;
      gpuFilter.appendChild(option);
    }

    const ramValues = Array.from(
      new Set(
        products
          .map((product) => product.memory?.installedGb?.value)
          .filter((value) => typeof value === "number" && value > 0),
      ),
    ).sort((a, b) => a - b);
    for (const value of ramValues) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${value}GB`;
      ramFilter.appendChild(option);
    }
  }

  function filteredProducts() {
    const query = state.query.trim().toLowerCase();
    return products.filter((product) => {
      if (state.gpu !== "all" && (product.gpu?.type || "unknown") !== state.gpu) {
        return false;
      }
      if (
        state.ram !== "all" &&
        String(product.memory?.installedGb?.value ?? "") !== state.ram
      ) {
        return false;
      }
      if (state.stock === "in" && !isInStock(product)) return false;
      if (state.stock === "out" && isInStock(product)) return false;

      if (!query) return true;
      const haystack = [
        product.title,
        product.asin,
        product.brand?.value,
        product.model?.value,
        product.gpu?.model?.value,
        product.cpu?.model?.value,
        product.memory?.type?.value,
        product.storage?.value,
        product.display?.value,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  function sortValue(product, key) {
    switch (key) {
      case "effective":
        return effectivePrice(product).amount;
      case "price":
        return product.price?.listedPrice?.amount ?? null;
      case "gpu":
        return product.gpu?.model?.value ?? null;
      case "vram":
        return product.gpu?.vramGb?.value ?? null;
      case "tgp":
        return product.gpu?.baseTgpW?.value ?? product.gpu?.maxGraphicsPowerW?.value ?? null;
      case "cpu":
        return product.cpu?.model?.value ?? null;
      case "ram":
        return product.memory?.installedGb?.value ?? null;
      case "discount":
        return discountPct(product);
      default:
        return null;
    }
  }

  function sortedProducts(list) {
    const [key, direction] = state.sort.split("-");
    const factor = direction === "desc" ? -1 : 1;
    return [...list].sort((left, right) => {
      const a = sortValue(left, key);
      const b = sortValue(right, key);
      const aMissing = a === null || a === undefined || a === "";
      const bMissing = b === null || b === undefined || b === "";
      if (aMissing && bMissing) return (left.title || "").localeCompare(right.title || "");
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (typeof a === "number" && typeof b === "number") {
        return (a - b) * factor;
      }
      return String(a).localeCompare(String(b), "en-IN", {
        numeric: true,
        sensitivity: "base",
      }) * factor;
    });
  }

  function cell(className, ...children) {
    const td = el("td", className);
    append(td, ...children);
    return td;
  }

  function renderTable() {
    const filtered = sortedProducts(filteredProducts());
    if (
      state.selected &&
      !filtered.some((product) => keyFor(product) === state.selected)
    ) {
      hidePanel();
    }

    const lowestEffective = filtered.reduce((minimum, product) => {
      const amount = effectivePrice(product).amount;
      if (amount === null) return minimum;
      return minimum === null || amount < minimum ? amount : minimum;
    }, null);

    tableBody.replaceChildren();
    for (const product of filtered) {
      const key = keyFor(product);
      const stock = stockInfo(product);
      const effective = effectivePrice(product);
      const emi = emiPrice(product);
      const discount = discountPct(product);
      const row = el("tr", state.selected === key ? "selected" : "");
      row.dataset.key = key;
      row.tabIndex = 0;
      row.addEventListener("click", () => openPanel(product));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPanel(product);
        }
      });

      const laptopCell = el("td", "col-laptop");
      const laptop = el("div", "laptop-cell");
      const nameWrap = el("div", "laptop-name-wrap");
      append(
        nameWrap,
        el("div", "laptop-name", shortName(product)),
        el("div", "laptop-sub", productSubline(product)),
      );
      append(laptop, productImage(product, "thumb"), nameWrap);
      laptopCell.appendChild(laptop);
      row.appendChild(laptopCell);

      row.appendChild(
        cell(
          null,
          el("div", "cell-main", shortGpu(product.gpu?.model?.value)),
          el("div", "cell-sub", product.gpu?.type || "GPU type unknown"),
        ),
      );
      row.appendChild(
        cell(
          null,
          el(
            "span",
            product.gpu?.vramGb?.value !== null && product.gpu?.vramGb?.value !== undefined
              ? "cell-strong"
              : "muted-dash",
            product.gpu?.vramGb?.value !== null && product.gpu?.vramGb?.value !== undefined
              ? `${product.gpu.vramGb.value}GB`
              : "—",
          ),
        ),
      );
      row.appendChild(
        cell(
          null,
          el("span", gpuPower(product) === "—" ? "muted-dash" : "power-value", gpuPower(product)),
        ),
      );
      row.appendChild(
        cell(
          null,
          el("div", "cell-main", shortCpu(product.cpu?.model?.value)),
          el("div", "cell-sub", cpuPower(product) === "—" ? "power unknown" : cpuPower(product)),
        ),
      );

      const ram = product.memory?.installedGb?.value;
      const ramType = product.memory?.type?.value;
      row.appendChild(
        cell(
          null,
          el("div", "cell-main", ram ? `${ram}GB${ramType ? ` ${ramType}` : ""}` : "—"),
          el(
            "div",
            "cell-sub",
            product.memory?.speedMhz?.value ? `${product.memory.speedMhz.value}MHz` : "",
          ),
        ),
      );

      row.appendChild(
        cell(
          "col-storage",
          el(
            "div",
            "cell-main",
            fieldIsUnknown(product.storage) ? "—" : product.storage.value,
          ),
        ),
      );
      row.appendChild(
        cell(
          "col-display",
          el(
            "div",
            "cell-main",
            fieldIsUnknown(product.display) ? "—" : compactDisplay(product.display.value),
          ),
        ),
      );

      const isLowestEffective =
        effective.amount !== null && effective.amount === lowestEffective;
      const priceCell = cell(
        `col-price${isLowestEffective ? " best-price" : ""}`,
      );
      const priceStack = el("div", "price-stack");
      const listed = product.price?.listedPrice?.amount ?? null;
      priceStack.appendChild(
        el(
          "div",
          "price-listed",
          listed === null ? "Listed —" : `Listed ${formatMoney(listed)}`,
        ),
      );
      const effectiveLine = el(
        "div",
        `price-effective${effective.amount === null ? " unknown" : ""}`,
        effective.amount === null ? "unknown" : formatMoney(effective.amount),
      );
      if (effective.amount !== null) {
        effectiveLine.appendChild(
          el(
            "span",
            "price-mode",
            effective.conditional ? "full payment" : "no full offer",
          ),
        );
      }
      priceStack.appendChild(effectiveLine);
      if (emi !== null) {
        priceStack.appendChild(
          el("div", "price-emi-line", `EMI ${formatMoney(emi)} · before fees`),
        );
      }
      priceCell.appendChild(priceStack);
      if (isLowestEffective) {
        priceCell.title = "Lowest effective (full-payment) price in the current view";
      }
      row.appendChild(priceCell);

      row.appendChild(
        cell(
          null,
          el(
            "span",
            discount === null ? "muted-dash" : "discount-value",
            discount === null ? "—" : `-${discount}%`,
          ),
        ),
      );
      row.appendChild(
        cell(null, el("span", stock.className, stock.label)),
      );

      const chevronCell = el("td", "col-chevron");
      const chevron = el("button", "chevron", "›");
      chevron.type = "button";
      chevron.setAttribute("aria-label", "Open details");
      chevron.addEventListener("click", (event) => {
        event.stopPropagation();
        openPanel(product);
      });
      chevronCell.appendChild(chevron);
      row.appendChild(chevronCell);

      tableBody.appendChild(row);
    }

    resultCount.textContent = `${filtered.length} of ${products.length} product${products.length === 1 ? "" : "s"}`;
    emptyState.hidden = filtered.length > 0;
    tableBody.hidden = filtered.length === 0;
  }

  function openPanel(product) {
    state.selected = keyFor(product);
    contentGrid.classList.add("panel-open");
    detailPanel.hidden = false;
    panelBackdrop.hidden = false;
    renderPanel(product);
    renderTable();
    detailPanel.scrollTop = 0;
  }

  function hidePanel() {
    state.selected = null;
    contentGrid.classList.remove("panel-open");
    detailPanel.hidden = true;
    panelBackdrop.hidden = true;
    panelContent.replaceChildren();
  }

  function closePanel() {
    hidePanel();
    renderTable();
  }

  function verifyChip(field) {
    return el("span", verificationClass(field), verificationLabel(field));
  }

  function specRow(label, field, unit, formatter) {
    const row = el("div", "spec-row");
    row.appendChild(el("span", "spec-label", label));
    const value = el(
      "span",
      `spec-value${fieldIsUnknown(field) ? " unknown" : ""}`,
      typeof formatter === "function"
        ? formatter(field)
        : fieldText(field, unit),
    );
    value.title = fieldTitle(field);
    row.appendChild(value);
    row.appendChild(verifyChip(field));
    return row;
  }

  function priceRow(label, amount, className = "") {
    const row = el("div", `price-row${className ? ` ${className}` : ""}`);
    row.appendChild(el("span", "label", label));
    row.appendChild(
      el("span", "value", amount === null || amount === undefined ? "—" : formatMoney(amount)),
    );
    return row;
  }

  function offerLabel(type) {
    return {
      bank_instant_discount: "Bank offer",
      coupon: "Coupon",
      cashback: "Cashback",
      exchange: "Exchange",
      no_cost_emi: "No-cost EMI",
      membership: "Membership",
      other: "Other offer",
    }[type] || type;
  }

  function appliedLabel(offer) {
    return {
      conditional_best: "Best full payment",
      emi_conditional: "EMI (before fees)",
      best_effective: "Best effective",
      none: "",
    }[offer.appliedIn] || "";
  }

  function offerAmount(offer) {
    if (offer.discount?.amount) return `Save ${formatMoney(offer.discount.amount)}`;
    if (offer.cashback?.amount) return `${formatMoney(offer.cashback.amount)} cashback`;
    if (offer.cap?.amount) return `Up to ${formatMoney(offer.cap.amount)}`;
    if (offer.percent) return `${offer.percent}%`;
    return "—";
  }

  function renderOffers(offers) {
    const section = el("section", "panel-section");
    section.appendChild(el("h3", null, `Offers (${offers.length})`));
    if (offers.length === 0) {
      section.appendChild(el("p", "panel-empty", "No offers detected in the visible buybox."));
      return section;
    }
    const sorted = [...offers].sort((left, right) => {
      const leftApplied = left.appliedIn && left.appliedIn !== "none" ? 0 : 1;
      const rightApplied = right.appliedIn && right.appliedIn !== "none" ? 0 : 1;
      return leftApplied - rightApplied;
    });
    for (const offer of sorted) {
      const card = el("article", "offer-card");
      const head = el("div", "offer-head");
      const type = el("span", "offer-type", offerLabel(offer.type));
      if (offer.paymentMode === "emi") type.textContent += " · EMI";
      head.appendChild(type);
      head.appendChild(el("span", "offer-amount", offerAmount(offer)));
      card.appendChild(head);
      card.appendChild(el("div", "offer-text", offer.rawText || "No raw text"));
      if (offer.eligibility) {
        card.appendChild(el("div", "offer-condition", offer.eligibility));
      }
      if (offer.calculation) {
        card.appendChild(el("div", "offer-condition", offer.calculation));
      }
      const applied = appliedLabel(offer);
      if (applied) {
        card.appendChild(el("div", "price-sub positive", applied));
      }
      if (Array.isArray(offer.components) && offer.components.length > 0) {
        const details = el("details", "offer-components");
        details.appendChild(
          el("summary", null, `${offer.components.length} component offers`),
        );
        const list = el("ul");
        for (const component of offer.components) {
          const item = el("li");
          append(
            item,
            component.rawText || "unknown",
            ` — ${formatMoney(component.discount) || "unknown"}`,
            component.minSpend !== null
              ? ` (min ${formatMoney(component.minSpend)})`
              : "",
          );
          list.appendChild(item);
        }
        details.appendChild(list);
        card.appendChild(details);
      }
      section.appendChild(card);
    }
    return section;
  }

  function renderSources(product) {
    const section = el("section", "panel-section");
    section.appendChild(el("h3", null, "Sources"));
    const sources = Array.isArray(product.sources) ? product.sources : [];
    if (sources.length === 0) {
      section.appendChild(el("p", "source-line", "No source URLs recorded."));
      return section;
    }
    const details = el("details", "offer-components");
    details.appendChild(el("summary", null, `${sources.length} source URLs`));
    const list = el("ul");
    for (const source of sources) {
      const item = el("li");
      const link = el(
        "a",
        null,
        `${String(source.type || "unknown").replaceAll("_", " ")}${
          source.section ? ` · ${source.section}` : ""
        }`,
      );
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      append(item, link);
      list.appendChild(item);
    }
    details.appendChild(list);
    section.appendChild(details);
    return section;
  }

  function renderPanel(product) {
    panelContent.replaceChildren();
    const header = el("div", "panel-product");
    const nameWrap = el("div", "laptop-name-wrap");
    nameWrap.appendChild(el("h2", null, product.title || "Untitled laptop"));
    const meta = el("div", "panel-meta");
    const metaParts = [
      product.brand?.value,
      product.model?.value,
      product.asin ? `ASIN ${product.asin}` : null,
    ].filter(Boolean);
    append(meta, metaParts.join(" · "));
    if (product.productUrl) {
      append(meta, " · ");
      const link = el("a", null, "View on Amazon ↗");
      link.href = product.productUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      meta.appendChild(link);
    }
    nameWrap.appendChild(meta);
    append(header, productImage(product, "panel-image"), nameWrap);
    panelContent.appendChild(header);

    const effective = effectivePrice(product);
    const mrp = product.price?.mrp?.amount ?? null;
    const discount = discountPct(product);
    const hero = el("section", "price-hero");
    const heroLine = el("div", "hero-value");
    heroLine.appendChild(
      el(
        "span",
        "hero-price",
        effective.amount === null ? "Price unknown" : formatMoney(effective.amount),
      ),
    );
    if (mrp !== null) heroLine.appendChild(el("span", "hero-mrp", formatMoney(mrp)));
    if (discount !== null) heroLine.appendChild(el("span", "hero-discount", `-${discount}%`));
    hero.appendChild(heroLine);
    hero.appendChild(
      el(
        "p",
        "hero-note",
        effective.conditional
          ? "Best full-payment price with eligible offers applied"
          : "Current listing price; no full-payment offer applied",
      ),
    );
    panelContent.appendChild(hero);

    const breakdown = el("section", "price-breakdown");
    breakdown.appendChild(
      priceRow("Listed price", product.price?.listedPrice?.amount ?? null),
    );
    breakdown.appendChild(
      priceRow(
        "No-condition price",
        product.price?.priceWithoutConditionalOffers?.amount ??
          product.price?.bestEffectivePrice?.amount ??
          null,
      ),
    );
    breakdown.appendChild(
      priceRow(
        "Best full payment",
        product.price?.conditionalBestPrice?.amount ?? null,
      ),
    );
    breakdown.appendChild(
      priceRow(
        "EMI before fees",
        product.price?.emiConditionalBestPrice?.amount ?? null,
        "emi",
      ),
    );
    breakdown.appendChild(
      el(
        "p",
        "price-note",
        "Bank, coupon, exchange and EMI offers need eligibility. EMI processing fees/interest are not included.",
      ),
    );
    panelContent.appendChild(breakdown);

    const offers = Array.isArray(product.price?.offers) ? product.price.offers : [];
    panelContent.appendChild(renderOffers(offers));

    const specs = el("section", "panel-section");
    specs.appendChild(el("h3", null, "Specifications"));
    const specsList = el("div", "specs-list");
    specsList.appendChild(specRow("GPU", product.gpu?.model));
    specsList.appendChild(specRow("VRAM", product.gpu?.vramGb, "GB"));
    specsList.appendChild(specRow("TGP", product.gpu?.baseTgpW, "W"));
    specsList.appendChild(
      specRow("Max GPU power", product.gpu?.maxGraphicsPowerW, "W"),
    );
    specsList.appendChild(
      specRow("Dynamic Boost", product.gpu?.dynamicBoostW, "W"),
    );
    specsList.appendChild(specRow("CPU", product.cpu?.model));
    const cpuPowerField =
      product.cpu?.baseTdpW?.value != null
        ? product.cpu.baseTdpW
        : product.cpu?.configurableTdpW?.value != null
          ? product.cpu.configurableTdpW
          : product.cpu?.maxTurboPowerW;
    specsList.appendChild(
      specRow("CPU power", cpuPowerField, null, () => cpuPower(product)),
    );
    specsList.appendChild(
      specRow("Max turbo", product.cpu?.maxTurboPowerW, "W"),
    );
    specsList.appendChild(specRow("RAM", product.memory?.installedGb, "GB"));
    specsList.appendChild(specRow("RAM type", product.memory?.type));
    specsList.appendChild(
      specRow("Upgradeable", product.memory?.upgradeability),
    );
    specsList.appendChild(specRow("Storage", product.storage));
    specsList.appendChild(specRow("Display", product.display));
    specsList.appendChild(specRow("Weight", product.weight));
    specs.appendChild(specsList);
    panelContent.appendChild(specs);

    const warnings = product.extraction?.warnings || [];
    const errors = product.extraction?.errors || [];
    if (warnings.length > 0 || errors.length > 0) {
      const notes = el("section", "panel-section");
      notes.appendChild(el("h3", null, "Extraction notes"));
      for (const issue of [...errors, ...warnings]) {
        const item = el("p", "offer-condition");
        append(item, el("strong", null, issue.code), " — ", issue.message);
        notes.appendChild(item);
      }
      panelContent.appendChild(notes);
    }

    const missing = product.extraction?.missingFields || [];
    if (missing.length > 0) {
      const missingSection = el("section", "panel-section");
      missingSection.appendChild(el("h3", null, "Missing fields"));
      missingSection.appendChild(el("p", "offer-condition", missing.join(", ")));
      panelContent.appendChild(missingSection);
    }

    panelContent.appendChild(renderSources(product));

    const footer = el("div", "panel-footer");
    footer.textContent = `Status: ${product.extraction?.status || "unknown"} · extracted ${formatDate(product.extraction?.finishedAt)} · ${product.extraction?.durationMs ?? "?"} ms`;
    panelContent.appendChild(footer);
  }

  function renderSubtitle() {
    const summary = report.summary || {};
    const extracted = (summary.success || 0) + (summary.partial || 0);
    const updated = formatDate(report.run?.finishedAt || report.run?.startedAt);
    const parts = [
      `Amazon India`,
      `${products.length} product${products.length === 1 ? "" : "s"}`,
      `${extracted} extracted`,
      `updated ${updated}`,
    ];
    subtitle.textContent = parts.join(" · ");
  }

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value || "";
    renderTable();
  });
  gpuFilter.addEventListener("change", (event) => {
    state.gpu = event.target.value || "all";
    renderTable();
  });
  ramFilter.addEventListener("change", (event) => {
    state.ram = event.target.value || "all";
    renderTable();
  });
  stockFilter.addEventListener("change", (event) => {
    state.stock = event.target.value || "all";
    renderTable();
  });
  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value || "effective-asc";
    renderTable();
  });
  document.getElementById("close-panel").addEventListener("click", closePanel);
  panelBackdrop.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailPanel.hidden) closePanel();
  });

  populateFilters();
  renderSubtitle();
  renderTable();
})();
