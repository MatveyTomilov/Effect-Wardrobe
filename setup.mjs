const MOD_NAMESPACE = "effectWardrobe";
const CHARM_SLOT_ID = "effectWardrobe:Charm";
const CHARM_ITEM_ID = "effectWardrobe:Charm_Crystal";
const STORAGE_KEY = "enchanterState";
const BACKUP_KEY_PREFIX = "effectWardrobe.enchanterState";
const BASE_COST = 1000;
const COST_MULTIPLIER = 1.5;
const MAX_COST = 100000000;

let ctxRef;
let state = defaultState();
let observer;
let renderQueued = false;
let sacrificeInProgress = false;

export function setup(ctx) {
  ctxRef = ctx;
  registerCharmData();

  ctx.patch(Player, "addEquippedItemModifiers").after(function () {
    addCharmModifiers(this);
  });

  ctx.patch(Player, "mergeUninheritedEffectApplicators").after(function () {
    addCharmCombatEffects(this);
  });

  ctx.patch(Bank, "selectItemOnClick").after(function () {
    queueRender();
  });

  ctx.patch(Bank, "render").after(function () {
    queueRender();
  });

  ctx.onCharacterLoaded((ctx) => {
    state = loadState(ctx);
  });

  ctx.onInterfaceReady(() => {
    giveCharmCrystalIfMissing();
    updateCharmDescription();
    buildEnchanterUI();
    startObserver();
    queueRender();
    refreshPlayer();
  });
}

function registerCharmData() {
  if (game.equipmentSlots.getObjectByID?.(CHARM_SLOT_ID) !== undefined) return;

  game.registerDataPackage({
    namespace: MOD_NAMESPACE,
    data: {
      equipmentSlots: [
        {
          id: "Charm",
          allowQuantity: false,
          emptyMedia: "assets/charm_empty.svg",
          emptyName: "\u0427\u0430\u0440\u043c",
          providesEquipStats: false,
          gridPosition: { col: 3, row: 3 },
          alternativePositions: [{ col: 4, row: 3 }, { col: 3, row: 4 }, { col: 1, row: 0 }],
        },
      ],
      items: [
        {
          id: "Charm_Crystal",
          itemType: "Equipment",
          name: "\u0427\u0430\u0440\u043c-\u043a\u0440\u0438\u0441\u0442\u0430\u043b\u043b",
          category: "Misc",
          type: "Charm",
          media: "assets/charm_crystal.svg",
          ignoreCompletion: true,
          obtainFromItemLog: false,
          golbinRaidExclusive: false,
          customDescription: "\u041a\u0440\u0438\u0441\u0442\u0430\u043b\u043b, \u043a\u043e\u0442\u043e\u0440\u044b\u0439 \u0445\u0440\u0430\u043d\u0438\u0442 \u043f\u0435\u0440\u0435\u043d\u0435\u0441\u0435\u043d\u043d\u044b\u0435 passive/modifier \u0431\u043e\u043d\u0443\u0441\u044b \u043f\u0440\u0438\u043d\u0435\u0441\u0435\u043d\u043d\u044b\u0445 \u0432 \u0436\u0435\u0440\u0442\u0432\u0443 \u043f\u0440\u0435\u0434\u043c\u0435\u0442\u043e\u0432.",
          sellsFor: 0,
          tier: "None",
          validSlots: [CHARM_SLOT_ID],
          occupiesSlots: [],
          equipRequirements: [],
          equipmentStats: [],
          modifiers: {},
        },
      ],
    },
  });
}

function defaultState() {
  return { sacrifices: {}, totalSacrifices: 0 };
}

function normalizeState(value) {
  const next = defaultState();
  if (value === undefined || value === null || typeof value !== "object") return next;
  if (value.sacrifices !== undefined && typeof value.sacrifices === "object") {
    for (const [id, count] of Object.entries(value.sacrifices)) {
      if (typeof id === "string" && Number.isFinite(count) && count > 0) {
        next.sacrifices[id] = Math.floor(count);
      }
    }
  }
  next.totalSacrifices = Object.values(next.sacrifices).reduce((sum, count) => sum + count, 0);
  return next;
}

function saveState() {
  ctxRef.characterStorage.setItem(STORAGE_KEY, state);
  saveBackupState();
}

function loadState(ctx) {
  const primary = normalizeState(ctx.characterStorage.getItem(STORAGE_KEY));
  if (primary.totalSacrifices > 0) {
    saveBackupState(primary);
    return primary;
  }

  const backup = loadBackupState();
  if (backup.totalSacrifices > 0) {
    ctx.characterStorage.setItem(STORAGE_KEY, backup);
    return backup;
  }

  return primary;
}

function getBackupKey() {
  const saveID = game?.characterName ?? game?.currentCharacter ?? "default";
  return `${BACKUP_KEY_PREFIX}.${saveID}`;
}

function saveBackupState(value = state) {
  try {
    globalThis.localStorage?.setItem(getBackupKey(), JSON.stringify(value));
  } catch (error) {
    console.warn("[Enchanter] Failed to save backup state", error);
  }
}

function loadBackupState() {
  try {
    const raw = globalThis.localStorage?.getItem(getBackupKey());
    return normalizeState(raw ? JSON.parse(raw) : undefined);
  } catch (error) {
    console.warn("[Enchanter] Failed to load backup state", error);
    return defaultState();
  }
}

function getCharmCrystal() {
  return game.items.getObjectByID(CHARM_ITEM_ID);
}

function updateCharmDescription() {
  const charm = getCharmCrystal();
  if (!charm) return;
  charm._customDescription = "\u0421\u043e\u0431\u0438\u0440\u0430\u0435\u0442 \u0438 \u0445\u0440\u0430\u043d\u0438\u0442 passive/modifier \u0431\u043e\u043d\u0443\u0441\u044b \u043f\u0440\u0438\u043d\u0435\u0441\u0435\u043d\u043d\u044b\u0445 \u0432 \u0436\u0435\u0440\u0442\u0432\u0443 \u043f\u0440\u0435\u0434\u043c\u0435\u0442\u043e\u0432.";
  charm._modifiedDescription = undefined;
}

function giveCharmCrystalIfMissing() {
  const charm = getCharmCrystal();
  if (charm === undefined) return;
  if (!game.isItemOwned(charm)) {
    game.bank.addItem(charm, 1, true, true, true, false, "\u0417\u0430\u0447\u0430\u0440\u043e\u0432\u0430\u0442\u0435\u043b\u044c");
  }
}

function isCharmEquipped(player) {
  const charm = getCharmCrystal();
  if (charm === undefined) return false;
  return player.equipment.checkForItem(charm);
}

function addCharmModifiers(player) {
  if (!isCharmEquipped(player)) return;

  for (const [itemID, count] of Object.entries(state.sacrifices)) {
    const item = game.items.getObjectByID(itemID);
    if (!item || !Array.isArray(item.modifiers) || item.modifiers.length === 0) continue;

    const source = { name: `Чарм-кристалл: ${item.name} x${count}` };
    const modifiers = item.modifiers.map((modifier) => {
      const copy = modifier.clone();
      copy.value *= count;
      return copy;
    });
    player.modifiers.addModifiers(source, modifiers);
  }
}

function addCharmCombatEffects(player) {
  if (!isCharmEquipped(player)) return;

  for (const itemID of Object.keys(state.sacrifices)) {
    const item = game.items.getObjectByID(itemID);
    if (!item) continue;

    if (Array.isArray(item.combatEffects) && item.combatEffects.length > 0) {
      player.mergeEffectApplicators(item.combatEffects);
    }
  }
}

function getNextCost() {
  return Math.min(MAX_COST, Math.floor(BASE_COST * COST_MULTIPLIER ** state.totalSacrifices));
}

function getSelectedItem() {
  return game?.bank?.selectedBankItem?.item;
}

function canSacrifice(item) {
  return (
    item !== undefined &&
    item !== null &&
    item.id !== CHARM_ITEM_ID &&
    state.sacrifices[item.id] === undefined &&
    game.bank.getQty(item) > 0 &&
    hasTransferableBonus(item)
  );
}

function hasTransferableBonus(item) {
  return (
    (Array.isArray(item.modifiers) && item.modifiers.length > 0) ||
    (Array.isArray(item.combatEffects) && item.combatEffects.length > 0) ||
    (Array.isArray(item.conditionalModifiers) && item.conditionalModifiers.length > 0)
  );
}

function requestSacrificeSelectedItem() {
  if (sacrificeInProgress) return;
  const item = getSelectedItem();
  if (!canSacrifice(item)) return;

  const cost = getNextCost();
  showConfirm(
    "\u041f\u0440\u0438\u043d\u0435\u0441\u0442\u0438 \u0432 \u0436\u0435\u0440\u0442\u0432\u0443?",
    `\u0411\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0435\u043d 1 \u043f\u0440\u0435\u0434\u043c\u0435\u0442: <strong>${item.name}</strong>.<br>\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c: <strong>${formatNumber(cost)}</strong> \u0437\u043e\u043b\u043e\u0442\u0430.`,
    () => sacrificeSelectedItem(item, cost)
  );
}

function sacrificeSelectedItem(item, cost) {
  if (sacrificeInProgress) return;
  sacrificeInProgress = true;

  if (!spendGP(cost)) {
    sacrificeInProgress = false;
    showMessage("\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u0437\u043e\u043b\u043e\u0442\u0430.");
    return;
  }

  if (!removeExactlyOneFromBank(item)) {
    game.gp.add(cost);
    sacrificeInProgress = false;
    showMessage("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043f\u0438\u0441\u0430\u0442\u044c 1 \u043f\u0440\u0435\u0434\u043c\u0435\u0442.");
    return;
  }

  state.sacrifices[item.id] = (state.sacrifices[item.id] ?? 0) + 1;
  state.totalSacrifices += 1;
  saveState();
  updateCharmDescription();
  game.bank.renderQueue.bankSearch = true;
  game.bank.renderQueue.items.add(item);
  game.bank.render();
  refreshPlayer();
  renderEnchanterUI();
  setTimeout(() => {
    sacrificeInProgress = false;
    renderEnchanterUI();
  }, 250);
}

function spendGP(cost) {
  const gp = game.gp;
  if (gp === undefined) return false;
  if (typeof gp.canAfford === "function" && !gp.canAfford(cost)) return false;
  if (typeof gp.amount === "number" && gp.amount < cost) return false;
  if (typeof gp.remove === "function") {
    gp.remove(cost);
    return true;
  }
  return false;
}

function removeExactlyOneFromBank(item) {
  const before = game.bank.getQty(item);
  if (before < 1) return false;

  game.bank.removeItemQuantity(item, before, false);
  if (before > 1) {
    game.bank.addItem(item, before - 1, true, false, true, false, "\u0417\u0430\u0447\u0430\u0440\u043e\u0432\u0430\u0442\u0435\u043b\u044c");
  }
  return true;
}

function refreshPlayer() {
  const player = game?.combat?.player;
  if (!player) return;
  player.updateForEquipmentChange();
  player.renderActiveSkillModifiers?.();
}

function buildEnchanterUI() {
  document.getElementById("effect-wardrobe-enchanter-button")?.remove();

  if (!document.getElementById("effect-wardrobe-floating-button")) {
    const button = document.createElement("button");
    button.id = "effect-wardrobe-floating-button";
    button.type = "button";
    button.textContent = "\u0417\u0430\u0447\u0430\u0440\u043e\u0432\u0430\u0442\u0435\u043b\u044c";
    button.addEventListener("click", toggleEnchanterPage);
    document.body.append(button);
  }

  if (!document.getElementById("effect-wardrobe-enchanter-page")) {
    const page = document.createElement("div");
    page.id = "effect-wardrobe-enchanter-page";
    page.className = "effect-wardrobe-page";
    page.style.display = "none";
    page.innerHTML = `
      <div class="effect-wardrobe-card">
        <div class="effect-wardrobe-header">
          <span>\u0417\u0430\u0447\u0430\u0440\u043e\u0432\u0430\u0442\u0435\u043b\u044c</span>
          <button id="effect-wardrobe-close-page" type="button">X</button>
        </div>
        <div class="effect-wardrobe-body">
          <div id="effect-wardrobe-summary"></div>
          <div id="effect-wardrobe-sacrifice"></div>
          <div id="effect-wardrobe-list"></div>
        </div>
      </div>
    `;
    document.body.append(page);
    document.getElementById("effect-wardrobe-close-page")?.addEventListener("click", () => {
      page.style.display = "none";
    });
  }
}

function toggleEnchanterPage() {
  const page = document.getElementById("effect-wardrobe-enchanter-page");
  if (!page) return;
  page.style.display = page.style.display === "none" ? "block" : "none";
  positionEnchanterPage();
  renderEnchanterUI();
}

function positionEnchanterPage() {
  const page = document.getElementById("effect-wardrobe-enchanter-page");
  const button = document.getElementById("effect-wardrobe-floating-button");
  if (!page || !button) return;

  const buttonRect = button.getBoundingClientRect();
  const pageWidth = Math.min(720, window.innerWidth - 24);
  page.style.width = `${pageWidth}px`;
  page.style.left = `${Math.max(12, Math.min(window.innerWidth - pageWidth - 12, buttonRect.right - pageWidth))}px`;
  page.style.right = "auto";
  page.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
  page.style.top = "auto";
}

function renderEnchanterUI() {
  const summary = document.getElementById("effect-wardrobe-summary");
  const sacrifice = document.getElementById("effect-wardrobe-sacrifice");
  const list = document.getElementById("effect-wardrobe-list");
  if (!summary || !sacrifice || !list) return;

  summary.innerHTML = `
    <div class="effect-wardrobe-crystal">
      <img src="${getCharmCrystal()?.media ?? ""}" alt="">
      <div>
        <div class="effect-wardrobe-title">\u0427\u0430\u0440\u043c-\u043a\u0440\u0438\u0441\u0442\u0430\u043b\u043b</div>
        <div class="effect-wardrobe-muted">\u0416\u0435\u0440\u0442\u0432: ${state.totalSacrifices}. \u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0430\u044f \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c: ${formatNumber(getNextCost())} \u0437\u043e\u043b\u043e\u0442\u0430.</div>
      </div>
    </div>
  `;

  const item = getSelectedItem();
  const valid = canSacrifice(item);
  sacrifice.textContent = "";

  const selected = document.createElement("div");
  selected.className = "effect-wardrobe-selected";
  selected.textContent = getSelectedItemText(item, valid);

  const action = document.createElement("div");
  action.className = `effect-wardrobe-action${!valid || sacrificeInProgress ? " effect-wardrobe-action-disabled" : ""}`;
  action.setAttribute("role", "button");
  action.setAttribute("tabindex", valid && !sacrificeInProgress ? "0" : "-1");
  action.textContent = `\u041f\u0440\u0438\u043d\u0435\u0441\u0442\u0438 \u0432 \u0436\u0435\u0440\u0442\u0432\u0443 \u0437\u0430 ${formatNumber(getNextCost())} \u0437\u043e\u043b\u043e\u0442\u0430`;
  if (valid && !sacrificeInProgress) {
    action.addEventListener("pointerup", (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestSacrificeSelectedItem();
    });
    action.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      requestSacrificeSelectedItem();
    });
  }
  sacrifice.append(selected, action);

  list.textContent = "";
  for (const [id, count] of Object.entries(state.sacrifices)) {
    const item = game.items.getObjectByID(id);
    const row = document.createElement("div");
    row.className = "effect-wardrobe-row";
    row.innerHTML = `
      <div>
        <div class="effect-wardrobe-title">${item?.name ?? id}</div>
        <div class="effect-wardrobe-effects">${getItemEffectDescriptions(item, count).join("<br>")}</div>
      </div>
      <strong>x${count}</strong>
    `;
    list.append(row);
  }

  if (Object.keys(state.sacrifices).length === 0) {
    const row = document.createElement("div");
    row.className = "effect-wardrobe-selected";
    row.textContent = "\u041d\u0430 \u043a\u0440\u0438\u0441\u0442\u0430\u043b\u043b\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0431\u043e\u043d\u0443\u0441\u043e\u0432.";
    list.append(row);
  }
}

function getItemEffectDescriptions(item, count) {
  if (!item || !hasTransferableBonus(item)) {
    return ["\u041d\u0435\u0442 passive/modifier \u0431\u043e\u043d\u0443\u0441\u043e\u0432."];
  }

  const descriptions = [];
  if (Array.isArray(item.modifiers)) {
    for (const modifier of item.modifiers) {
      const copy = modifier.clone();
      copy.value *= count;
      const description = copy.getDescription?.();
      if (description?.text !== undefined) descriptions.push(description.text);
      else if (Array.isArray(description) && description[0]?.text !== undefined) descriptions.push(description[0].text);
      else descriptions.push(`${copy.modifier?.localID ?? copy.modifier?.id ?? "\u0411\u043e\u043d\u0443\u0441"}: ${copy.value}`);
    }
  }
  if (Array.isArray(item.combatEffects) && item.combatEffects.length > 0) {
    descriptions.push(item.modifiedDescription || item.description || "\u0411\u043e\u0435\u0432\u043e\u0439 passive-\u044d\u0444\u0444\u0435\u043a\u0442.");
  }
  if (Array.isArray(item.conditionalModifiers) && item.conditionalModifiers.length > 0) {
    descriptions.push(item.modifiedDescription || item.description || "\u0423\u0441\u043b\u043e\u0432\u043d\u044b\u0439 passive-\u0431\u043e\u043d\u0443\u0441.");
  }
  return descriptions;
}

function getSelectedItemText(item, valid) {
  if (item === undefined || item === null) {
    return "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0432 \u0431\u0430\u043d\u043a\u0435 \u043f\u0440\u0435\u0434\u043c\u0435\u0442 \u0441 passive/modifier \u0431\u043e\u043d\u0443\u0441\u0430\u043c\u0438.";
  }
  if (state.sacrifices[item.id] !== undefined) {
    return `\u042d\u0442\u043e\u0442 \u043f\u0440\u0435\u0434\u043c\u0435\u0442 \u0443\u0436\u0435 \u043f\u0440\u0438\u043d\u0435\u0441\u0435\u043d \u0432 \u0436\u0435\u0440\u0442\u0432\u0443: ${item.name}`;
  }
  if (!valid) {
    return "\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043f\u0440\u0435\u0434\u043c\u0435\u0442 \u043d\u0435\u043b\u044c\u0437\u044f \u043f\u0440\u0438\u043d\u0435\u0441\u0442\u0438 \u0432 \u0436\u0435\u0440\u0442\u0432\u0443.";
  }
  return `\u0412\u044b\u0431\u0440\u0430\u043d \u043f\u0440\u0435\u0434\u043c\u0435\u0442: ${item.name}`;
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    renderEnchanterUI();
  }, 50);
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(() => queueRender());
  observer.observe(document.body, { childList: true, subtree: true });
}

function showMessage(message) {
  if (typeof addModalToQueue === "function") {
    addModalToQueue({ title: "\u0417\u0430\u0447\u0430\u0440\u043e\u0432\u0430\u0442\u0435\u043b\u044c", html: `<p>${message}</p>` });
  } else {
    console.warn(`[Enchanter] ${message}`);
  }
}

function showConfirm(title, html, onConfirm) {
  const old = document.getElementById("effect-wardrobe-confirm");
  old?.remove();

  const overlay = document.createElement("div");
  overlay.id = "effect-wardrobe-confirm";
  overlay.innerHTML = `
    <div class="effect-wardrobe-confirm-card">
      <div class="effect-wardrobe-header">
        <span>${title}</span>
        <button id="effect-wardrobe-confirm-close" type="button">X</button>
      </div>
      <div class="effect-wardrobe-confirm-body">
        <div>${html}</div>
        <div class="effect-wardrobe-confirm-actions">
          <button id="effect-wardrobe-confirm-cancel" class="btn btn-secondary" type="button">\u041e\u0442\u043c\u0435\u043d\u0430</button>
          <button id="effect-wardrobe-confirm-ok" class="btn btn-danger" type="button">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button>
        </div>
      </div>
    </div>
  `;
  document.body.append(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#effect-wardrobe-confirm-close")?.addEventListener("click", close);
  overlay.querySelector("#effect-wardrobe-confirm-cancel")?.addEventListener("click", close);
  overlay.querySelector("#effect-wardrobe-confirm-ok")?.addEventListener("click", () => {
    close();
    onConfirm();
  });
}

function formatNumber(value) {
  return Math.floor(value).toLocaleString("ru-RU");
}
