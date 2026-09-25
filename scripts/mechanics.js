/**
 * STM core mechanics for the MCDM Talent: strain, manifestation, exertion,
 * Strain to Maintain, Psychic Boost, rests and strain-costing features.
 *
 * No sheet code here: everything is callable from either sheet, from items used
 * through any UI (Argon, hotbar, Tidy), or from macros via game.modules.get("stm").api.
 */

import {
  MODULE_ID, CLASS_ID, POWERS_PACK, TALENT_PACK, STRAIN_TYPES, EFFECT_STEPS, TABLE,
  SPECIALIZATIONS, LEARN_DAYS, STRAIN_CHANGES, ICONS
} from "./data.js";

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

export const t = key => game.i18n.localize(`STM.${key}`);
export const tf = (key, data) => game.i18n.format(`STM.${key}`, data);
export const ordinal = n => tf("Ordinal", { n, suffix: t(`OrdinalSuffix.${n}`) });
const esc = s => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s)) : String(s);
const setting = key => game.settings.get(MODULE_ID, key);

export function isTalent(actor) {
  return actor?.type === "character" && !!actor.classes?.[CLASS_ID];
}

export function talentLevel(actor) {
  return actor?.classes?.[CLASS_ID]?.system?.levels ?? 0;
}

export function intMod(actor) {
  return actor.system.abilities?.int?.mod ?? 0;
}

export function prof(actor) {
  return actor.system.attributes?.prof ?? 2;
}

function scale(actor, id) {
  return actor.system.scale?.[CLASS_ID]?.[id];
}

export function manifestDie(actor) {
  return Number(scale(actor, "manifestation-die")?.faces) || TABLE.die(talentLevel(actor));
}

export function strainMax(actor) {
  return Number(scale(actor, "strain-max")?.value) || TABLE.strainMax(talentLevel(actor));
}

export function maxOrder(actor) {
  return Number(scale(actor, "max-order")?.value) || TABLE.maxOrder(talentLevel(actor));
}

/** Specialization: from a Talent subclass item, else the tab's selector flag. */
export function specialization(actor) {
  const sub = Object.values(actor.subclasses ?? {}).find(s => s.system?.classIdentifier === CLASS_ID);
  const key = sub?.identifier ?? actor.getFlag(MODULE_ID, "specialization") ?? "";
  return { key, fromItem: !!sub, label: SPECIALIZATIONS[key]?.label ?? sub?.name ?? "", specialty: SPECIALIZATIONS[key]?.specialty ?? null };
}

export function getStrain(actor) {
  const s = actor.getFlag(MODULE_ID, "strain") ?? {};
  return Object.fromEntries(STRAIN_TYPES.map(k => [k, Math.max(0, Number(s[k]) || 0)]));
}

export const strainTotal = strain => STRAIN_TYPES.reduce((a, k) => a + strain[k], 0);

export function ignoredType(actor) {
  return actor.getFlag(MODULE_ID, "ignore") || null;
}

/** Is strain effect `step` of `type` currently in force? */
export function effectActive(actor, type, step, strain = getStrain(actor)) {
  return ignoredType(actor) !== type && strain[type] >= step;
}

export function featureItem(actor, key) {
  return actor.items.find(i => i.getFlag(MODULE_ID, "feature") === key);
}

export function powerItems(actor) {
  return actor.items.filter(i => i.getFlag(MODULE_ID, "power"));
}

export function exertionItems(actor) {
  return actor.items.filter(i => i.getFlag(MODULE_ID, "exertion"));
}

export function usesOf(item) {
  const u = item?.system?.uses;
  if (!u?.max) return null;
  return { value: u.value ?? Math.max(0, u.max - (u.spent ?? 0)), max: u.max };
}

async function spendUse(item) {
  if (!item) return;
  await item.update({ "system.uses.spent": (item.system.uses.spent ?? 0) + 1 });
}

/** Powers this actor is concentrating on, with the order each was manifested at. */
export function powerConcentration(actor) {
  const out = [];
  for (const effect of actor.concentration?.effects ?? []) {
    const data = effect.getFlag("dnd5e", "item") ?? {};
    const item = actor.items.get(data.id);
    const power = item?.getFlag(MODULE_ID, "power");
    if (!power) continue;
    out.push({ effect, item, order: Math.min(6, power.order + (Number(effect.getFlag("dnd5e", "scaling")) || 0)) });
  }
  return out;
}

/** One client handles automatic prompts for an actor: an active owning player, else the first active GM. */
export function isResponsibleUser(actor) {
  const players = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  if (players.length) return players[0].id === game.user.id;
  return game.users.activeGM?.id === game.user.id;
}

export async function chat(actor, { title, subtitle = "", body = "", cls = "", img = "", rolls = [] }) {
  // Results are written into the card; Dice So Nice (if installed) still shows the dice.
  if (game.dice3d) for (const r of rolls) game.dice3d.showForRoll(r, game.user, true);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="stm-card ${cls}"><header>${img ? `<img src="${img}" alt="">` : ""}<h3>${title}</h3>${subtitle ? `<span>${subtitle}</span>` : ""}</header>${body}</div>`
  });
}

/* -------------------------------------------- */
/*  Managed effects                             */
/* -------------------------------------------- */

const syncing = new Set();

/** Keep the Strain and Psionic Focus effects and the mirrored resource in step with the flags. */
export async function syncStrainEffects(actor) {
  if (!actor?.isOwner || !isTalent(actor) || syncing.has(actor.id)) return;
  syncing.add(actor.id);
  try {
    const strain = getStrain(actor);
    const ignore = ignoredType(actor);
    const changes = [];
    const lines = [];
    for (const type of STRAIN_TYPES) {
      if (type === ignore) continue;
      for (const step of EFFECT_STEPS) {
        if (strain[type] < step) continue;
        changes.push(...STRAIN_CHANGES[type][step](actor));
        lines.push(`<li>${t(`Type.${type}`)} ${step}: ${t(`Effect.${type}.${step}`)}</li>`);
      }
    }
    const tag = STRAIN_TYPES.map(k => `${t(`Type.${k}`)[0]}${strain[k]}`).join(" ");
    await upsertManaged(actor, "strain", lines.length ? {
      name: `${t("StrainEffect")} (${tag})`,
      img: ICONS.strain,
      description: `<ul>${lines.join("")}</ul>`,
      changes
    } : null);

    await upsertManaged(actor, "focus", {
      name: t("FocusEffect"),
      img: ICONS.focus,
      description: `<p>${t("FocusEffectHint")}</p>`,
      changes: [{ key: "system.attributes.concentration.limit", mode: 4, value: String(prof(actor)) }]
    });

    await syncResource(actor, strain);
  } finally {
    syncing.delete(actor.id);
  }
}

async function upsertManaged(actor, kind, data) {
  const existing = actor.effects.filter(e => e.getFlag(MODULE_ID, "managed") === kind);
  const [keep, ...extra] = existing;
  if (extra.length) await actor.deleteEmbeddedDocuments("ActiveEffect", extra.map(e => e.id));
  if (!data) {
    if (keep) await keep.delete();
    return;
  }
  const sig = JSON.stringify([data.name, data.changes]);
  if (keep) {
    if (keep.getFlag(MODULE_ID, "sig") === sig) return;
    await keep.update({ ...data, [`flags.${MODULE_ID}.sig`]: sig });
    return;
  }
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    ...data, transfer: false, disabled: false,
    flags: { [MODULE_ID]: { managed: kind, sig } }
  }]);
}

async function syncResource(actor, strain) {
  const slot = setting("resourceSlot");
  if (!slot || slot === "none") return;
  const res = actor.system.resources?.[slot];
  if (!res) return;
  const value = strainTotal(strain), max = strainMax(actor), label = t("Strain");
  if (res.value === value && res.max === max && res.label === label) return;
  await actor.update({
    [`system.resources.${slot}.value`]: value,
    [`system.resources.${slot}.max`]: max,
    [`system.resources.${slot}.label`]: label,
    [`system.resources.${slot}.sr`]: false,
    [`system.resources.${slot}.lr`]: false
  });
}

/* -------------------------------------------- */
/*  Changing strain                             */
/* -------------------------------------------- */

export async function setStrain(actor, strain) {
  const clean = Object.fromEntries(STRAIN_TYPES.map(k => [k, Math.max(0, Math.round(Number(strain[k]) || 0))]));
  await actor.update({ [`flags.${MODULE_ID}.strain`]: clean });
  await syncStrainEffects(actor);
  return clean;
}

/** Set one track directly (sheet pips). */
export async function setTrack(actor, type, value) {
  const strain = getStrain(actor);
  strain[type] = Math.max(0, value);
  return setStrain(actor, strain);
}

/**
 * Apply a signed change per strain type.
 * @returns {Promise<{html: string, gained: number, lost: number, rolls: Roll[], died: boolean}>}
 */
export async function applyStrain(actor, delta, { reason = "", silent = false } = {}) {
  const before = getStrain(actor);
  const after = {};
  for (const k of STRAIN_TYPES) after[k] = Math.max(0, before[k] + (Number(delta[k]) || 0));
  const gained = STRAIN_TYPES.reduce((a, k) => a + Math.max(0, after[k] - before[k]), 0);
  const lost = STRAIN_TYPES.reduce((a, k) => a + Math.max(0, before[k] - after[k]), 0);
  await setStrain(actor, after);

  const max = strainMax(actor);
  const total = strainTotal(after);
  const parts = STRAIN_TYPES.filter(k => after[k] !== before[k])
    .map(k => `${t(`Type.${k}`)} ${after[k] > before[k] ? "+" : "−"}${Math.abs(after[k] - before[k])}`);
  const newly = [];
  for (const k of STRAIN_TYPES) for (const s of EFFECT_STEPS) {
    if (before[k] < s && after[k] >= s) newly.push(`${t(`Type.${k}`)} ${s}: ${t(`Effect.${k}.${s}`)}${ignoredType(actor) === k ? ` (${t("Ignored")})` : ""}`);
  }

  const rolls = [];
  let html = reason ? `<p>${reason}</p>` : "";
  html += `<p class="stm-strain-line"><strong>${parts.join(", ") || t("NoChange")}</strong> · ${tf("StrainOf", { total, max })}</p>`;
  if (newly.length) html += `<p class="stm-new">${tf("NewEffects", { list: newly.join("; ") })}</p>`;

  if (gained && setting("cosmeticEffects")) {
    const r = await new Roll("1d8").evaluate();
    rolls.push(r);
    html += `<p class="stm-cosmetic"><span class="stm-roll">d8 ${r.total}</span> ${t(`Cosmetic.${r.total}`)}</p>`;
  }
  if (gained && featureItem(actor, "energyUnleashed")) {
    const r = await new Roll(`${gained}d6`).evaluate();
    rolls.push(r);
    html += `<p class="stm-unleashed">${tf("EnergyUnleashed", { dc: 8 + prof(actor) + intMod(actor), n: gained, total: r.total })}</p>`;
  }

  let died = false;
  if (total > max) {
    died = true;
    html += `<p class="stm-death">${tf("Death", { total, max })}</p>`;
    if (setting("automateDeath")) await actor.update({ "system.attributes.hp.value": 0, "system.attributes.death.failure": 3 });
  }

  if (!silent) {
    await chat(actor, {
      title: gained ? t("StrainGained") : t("StrainRemoved"),
      subtitle: gained ? `+${gained}` : `−${lost}`,
      body: html, cls: died ? "death" : gained ? "gain" : "relief", img: ICONS.strain, rolls
    });
  }
  return { html, gained, lost, rolls, died };
}

/* -------------------------------------------- */
/*  Allocation dialog                           */
/* -------------------------------------------- */

const { DialogV2 } = foundry.applications.api;

function dialogRoot(event, arg) {
  return arg?.element ?? (arg instanceof HTMLElement ? arg : event?.target?.element ?? null);
}

/**
 * Ask how strain is split across body, mind and soul.
 * @param {Actor} actor
 * @param {object} o
 * @param {number} o.amount            starting amount
 * @param {number} [o.min]             variable amount lower bound
 * @param {number} [o.max]             variable amount upper bound
 * @param {"gain"|"remove"} [o.mode]
 * @param {string} o.title
 * @param {string} [o.hint]
 * @param {boolean} [o.manifest]       offer "manifest and die" / "don't manifest" past the maximum
 * @returns {Promise<{result: "apply"|"die"|"refuse", delta: object, amount: number}|null>}
 */
export async function allocateStrain(actor, o) {
  const mode = o.mode ?? "gain";
  const sign = mode === "remove" ? -1 : 1;
  const current = getStrain(actor);
  const max = strainMax(actor);
  const st = { amount: o.amount, a: { body: 0, mind: 0, soul: 0 } };
  const variable = Number.isFinite(o.min) && Number.isFinite(o.max) && o.min !== o.max;
  if (mode === "remove") st.amount = Math.min(st.amount, strainTotal(current));

  const tracks = STRAIN_TYPES.map(k => `
    <div class="stm-al" data-type="${k}">
      <h4>${t(`Type.${k}`)}</h4>
      <div class="stm-al-n"><b data-n>0</b><small data-now></small></div>
      <div class="stm-al-step">
        <button type="button" data-step="-1" aria-label="${tf("Less", { type: t(`Type.${k}`) })}">−</button>
        <button type="button" data-step="1" aria-label="${tf("More", { type: t(`Type.${k}`) })}">+</button>
      </div>
      <button type="button" class="stm-al-all" data-all>${tf("AllOf", { type: t(`Type.${k}`) })}</button>
    </div>`).join("");

  const content = `<div class="stm-dialog">
    ${o.hint ? `<p class="stm-hint">${o.hint}</p>` : ""}
    ${variable ? `<div class="stm-row"><label for="stm-amt">${t("Amount")}</label>
      <input id="stm-amt" type="number" min="${o.min}" max="${o.max}" value="${st.amount}" data-amount>
      <span class="stm-hint">${o.min}–${o.max}</span></div>` : ""}
    <div class="stm-alloc">${tracks}</div>
    <p class="stm-sum" data-sum></p>
    <div class="stm-newfx" data-newfx></div>
    <div class="stm-warn" data-over hidden>${o.manifest ? t("OverMaxManifest") : t("OverMax")}</div>
  </div>`;

  const used = () => STRAIN_TYPES.reduce((a, k) => a + st.a[k], 0);
  const wouldExceed = () => mode === "gain" && strainTotal(current) + st.amount > max;

  const update = root => {
    if (!root) return;
    for (const k of STRAIN_TYPES) {
      const box = root.querySelector(`.stm-al[data-type="${k}"]`);
      box.querySelector("[data-n]").textContent = `${mode === "remove" ? "−" : "+"}${st.a[k]}`;
      box.querySelector("[data-now]").textContent = tf("NowTo", { now: current[k], to: current[k] + sign * st.a[k] });
    }
    const after = strainTotal(current) + sign * used();
    root.querySelector("[data-sum]").innerHTML = tf("AllocSum", { used: used(), amount: st.amount, after, max });
    const newly = [];
    if (mode === "gain") for (const k of STRAIN_TYPES) for (const s of EFFECT_STEPS) {
      if (current[k] < s && current[k] + st.a[k] >= s) newly.push(`<div>${t(`Type.${k}`)} ${s}: ${t(`Effect.${k}.${s}`)}</div>`);
    }
    root.querySelector("[data-newfx]").innerHTML = newly.join("");
    const over = wouldExceed();
    root.querySelector("[data-over]").hidden = !over;
    const full = used() === st.amount;
    const btn = a => root.closest(".application, .dialog, dialog")?.querySelector(`[data-action="${a}"]`) ?? root.parentElement?.querySelector(`[data-action="${a}"]`);
    const apply = btn("apply"), die = btn("die"), refuse = btn("refuse");
    if (apply) { apply.hidden = over; apply.disabled = !full; }
    if (die) { die.hidden = !over; die.disabled = !full; }
    if (refuse) refuse.hidden = !over;
  };

  const buttons = [{ action: "apply", label: mode === "remove" ? t("RemoveStrain") : t("ApplyStrain"), icon: "fa-solid fa-check", default: true, callback: () => "apply" }];
  if (mode === "gain") buttons.push({ action: "die", label: o.manifest ? t("ManifestAndDie") : t("TakeAndDie"), icon: "fa-solid fa-skull", callback: () => "die" });
  if (o.manifest) buttons.push({ action: "refuse", label: t("DontManifest"), icon: "fa-solid fa-hand", callback: () => "refuse" });
  buttons.push({ action: "cancel", label: t("Cancel"), icon: "fa-solid fa-xmark", callback: () => null });

  const result = await DialogV2.wait({
    window: { title: o.title, icon: "fa-solid fa-brain" },
    classes: ["stm-dialog-app"],
    position: { width: 460 },
    content,
    buttons,
    rejectClose: false,
    render: (event, arg) => {
      const app = dialogRoot(event, arg);
      const root = app?.querySelector?.(".stm-dialog") ?? app;
      if (!root) return;
      root.addEventListener("click", ev => {
        const b = ev.target.closest("button");
        if (!b || !root.contains(b)) return;
        ev.preventDefault();
        const k = b.closest(".stm-al")?.dataset.type;
        if (!k) return;
        if (b.hasAttribute("data-all")) {
          st.a = { body: 0, mind: 0, soul: 0 };
          st.a[k] = mode === "remove" ? Math.min(st.amount, current[k]) : st.amount;
        } else {
          const d = Number(b.dataset.step);
          if (d > 0 && used() >= st.amount) return;
          if (mode === "remove" && d > 0 && st.a[k] >= current[k]) return;
          st.a[k] = Math.max(0, st.a[k] + d);
        }
        update(root);
      });
      root.querySelector("[data-amount]")?.addEventListener("change", ev => {
        st.amount = Math.clamp(Number(ev.target.value) || o.min, o.min, o.max);
        if (mode === "remove") st.amount = Math.min(st.amount, strainTotal(current));
        ev.target.value = st.amount;
        st.a = { body: 0, mind: 0, soul: 0 };
        update(root);
      });
      update(root);
    }
  });
  if (!result) return null;
  if (result === "refuse") return { result, delta: { body: 0, mind: 0, soul: 0 }, amount: 0 };
  if (used() !== st.amount) return null;
  const delta = Object.fromEntries(STRAIN_TYPES.map(k => [k, sign * st.a[k]]));
  return { result, delta, amount: st.amount };
}

/* -------------------------------------------- */
/*  Manifesting a power                         */
/* -------------------------------------------- */

/** Activity uses that should run normally (set just before the module re-runs them). */
export const bypass = new Set();

async function runActivity(activity, usage = {}) {
  bypass.add(activity.uuid);
  try {
    return await activity.use(usage, { configure: false }, {});
  } finally {
    bypass.delete(activity.uuid);
  }
}

function exertionOptions(actor, order) {
  const out = [];
  for (const item of exertionItems(actor)) {
    const ex = item.getFlag(MODULE_ID, "exertion");
    (ex.costs ?? []).forEach((c, i) => {
      const n = c.value === "order" ? order : c.value === "half" ? Math.max(1, Math.floor(order / 2)) : Number(c.value) || 0;
      out.push({ value: `${item.id}:${i}`, label: c.label ? `${item.name} (${c.label})` : item.name, n, item });
    });
  }
  return out;
}

function adeptFor(actor, power) {
  const item = featureItem(actor, "adept");
  if (!item) return null;
  const specialty = item.getFlag(MODULE_ID, "specialty") ?? specialization(actor).specialty;
  return specialty === power.specialty ? item : null;
}

/** Manifest a power: order, manifestation test, exertion, strain, then run the item's activity. */
export async function manifestPower(activity) {
  const item = activity.item;
  const actor = item.actor;
  const power = item.getFlag(MODULE_ID, "power");
  if (!actor || !power) return;

  const die = manifestDie(actor);
  const conc = powerConcentration(actor);
  const others = conc.filter(c => c.item.id !== item.id);
  const limit = actor.system.attributes?.concentration?.limit ?? 1;
  const concentrates = !!activity.duration?.concentration && !game.settings.get("dnd5e", "disableConcentration");
  const allConc = [...(actor.concentration?.effects ?? [])];
  const mustEnd = concentrates && !allConc.some(e => e.getFlag("dnd5e", "item")?.id === item.id) && allConc.length >= limit;

  /* Stage 1: order */
  const orders = Array.from({ length: 7 - power.order }, (_, i) => power.order + i);
  const pre = await DialogV2.wait({
    window: { title: tf("ManifestTitle", { name: item.name }), icon: "fa-solid fa-brain" },
    classes: ["stm-dialog-app"],
    position: { width: 440 },
    content: `<div class="stm-dialog">
      <div class="stm-row"><label for="stm-order">${t("ManifestAt")}</label>
        <select id="stm-order" name="order">${orders.map(o => `<option value="${o}">${ordinal(o)} ${t("Order")}${o > power.order ? ` (+${o - power.order})` : ""}</option>`).join("")}</select></div>
      <p class="stm-score" data-score></p>
      ${mustEnd ? `<div class="stm-row"><label for="stm-end">${t("EndConcentration")}</label>
        <select id="stm-end" name="end">${allConc.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></div>
        <p class="stm-hint">${tf("ConcLimit", { limit })}</p>` : ""}
    </div>`,
    buttons: [
      { action: "go", label: t("Manifest"), icon: "fa-solid fa-brain", default: true,
        callback: (event, button) => {
          const form = button.form ?? button.closest("form") ?? button.closest(".application");
          return {
            order: Number(form.querySelector("[name=order]")?.value) || power.order,
            end: form.querySelector("[name=end]")?.value || null
          };
        } },
      { action: "cancel", label: t("Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false,
    render: (event, arg) => {
      const root = dialogRoot(event, arg);
      const sel = root?.querySelector("[name=order]");
      const out = root?.querySelector("[data-score]");
      if (!sel || !out) return;
      const draw = () => {
        const o = Number(sel.value);
        out.innerHTML = o < 2 ? t("NoTest")
          : tf("ScoreLine", { score: o + others.length, order: o, n: others.length, die, strain: o });
      };
      sel.addEventListener("change", draw);
      draw();
    }
  });
  if (!pre) return;
  const order = pre.order;
  const scaling = order - power.order;
  const score = order + (order >= 2 ? others.length : 0);

  /* Stage 2: manifestation test, rerolls, exertion */
  const rolls = [];
  let pick = 0;
  const adept = order >= 2 ? adeptFor(actor, power) : null;
  const reduceItem = featureItem(actor, "reduceStress");
  const exOpts = exertionOptions(actor, order);
  let choice = { ex: "", reduce: false };
  let adeptUsed = false;

  if (order >= 2) rolls.push(await new Roll(`1d${die}`).evaluate());
  const testStrain = () => {
    if (order < 2) return 0;
    const r = rolls[pick].total;
    return r > score ? 0 : r === score ? 1 : order;
  };

  if (order >= 2 || exOpts.length) {
    for (;;) {
      const ts = testStrain();
      const adeptLeft = adept ? (usesOf(adept)?.value ?? 0) : 0;
      const reduceLeft = reduceItem ? (usesOf(reduceItem)?.value ?? 0) : 0;
      const r = rolls[pick]?.total;
      const outcome = order < 2 ? "" : r > score ? `<span class="stm-out good">${t("Outcome.Clean")}</span>`
        : r === score ? `<span class="stm-out warn">${t("Outcome.One")}</span>`
        : `<span class="stm-out bad">${tf("Outcome.Full", { n: order })}</span>`;
      const res = await DialogV2.wait({
        window: { title: tf("ManifestTitle", { name: item.name }), icon: "fa-solid fa-brain" },
        classes: ["stm-dialog-app"],
        position: { width: 440 },
        content: `<div class="stm-dialog">
          ${order >= 2 ? `<div class="stm-test">
            ${rolls.map((x, i) => `<label class="stm-die ${rolls.length > 1 ? (i === pick ? "pick" : "alt") : ""}">
              <input type="radio" name="pick" value="${i}" ${i === pick ? "checked" : ""} ${rolls.length > 1 ? "" : "hidden"}>${x.total}</label>`).join("")}
            <div class="stm-vs">${tf("DieVsScore", { die, score })}<br>${outcome}</div></div>
            ${rolls.length > 1 ? `<p class="stm-hint">${t("PickRoll")}</p>` : ""}` : `<p>${t("NoTest")}</p>`}
          ${exOpts.length ? `<div class="stm-row"><label for="stm-ex">${t("Exertion")}</label>
            <select id="stm-ex" name="ex"><option value="">${t("None")}</option>
            ${exOpts.map(e => `<option value="${e.value}" ${e.value === choice.ex ? "selected" : ""}>${esc(e.label)} · ${tf("NStrain", { n: e.n })}</option>`).join("")}</select></div>` : ""}
          ${reduceItem && ts > 0 ? `<label class="stm-row"><input type="checkbox" name="reduce" ${choice.reduce ? "checked" : ""} ${reduceLeft > 0 ? "" : "disabled"}>
            ${tf("ReduceStress", { n: reduceLeft })}</label>` : ""}
        </div>`,
        buttons: [
          ...(adept && !adeptUsed && adeptLeft > 0 ? [{ action: "reroll", label: tf("Reroll", { name: adept.name, n: adeptLeft }), icon: "fa-solid fa-dice", callback: (e, b) => ({ action: "reroll", ...read(b) }) }] : []),
          { action: "continue", label: t("Continue"), icon: "fa-solid fa-check", default: true, callback: (e, b) => ({ action: "continue", ...read(b) }) },
          { action: "cancel", label: t("Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
        ],
        rejectClose: false
      });
      if (!res) return;
      pick = res.pick ?? pick;
      choice = { ex: res.ex ?? "", reduce: !!res.reduce };
      if (res.action === "reroll") {
        adeptUsed = true;
        await spendUse(adept);
        rolls.push(await new Roll(`1d${die}`).evaluate());
        pick = rolls[1].total > rolls[0].total ? 1 : 0;
        continue;
      }
      break;
    }
  }

  function read(button) {
    const form = button.form ?? button.closest("form") ?? button.closest(".application");
    const p = form?.querySelector("[name=pick]:checked");
    return {
      pick: p ? Number(p.value) : undefined,
      ex: form?.querySelector("[name=ex]")?.value ?? "",
      reduce: !!form?.querySelector("[name=reduce]")?.checked
    };
  }

  const ts = testStrain();
  const reduced = choice.reduce && ts > 0 ? Math.max(1, Math.floor(ts / 2)) : ts;
  const ex = exOpts.find(e => e.value === choice.ex);
  const total = reduced + (ex?.n ?? 0);

  /* Stage 3: strain */
  let alloc = null;
  if (total > 0) {
    alloc = await allocateStrain(actor, {
      amount: total, mode: "gain", manifest: true,
      title: tf("AssignStrain", { name: item.name }),
      hint: tf("AssignHint", { n: total, test: reduced, ex: ex?.n ?? 0 })
    });
    if (!alloc) return;
    if (alloc.result === "refuse") {
      if (setting("automateDeath")) await actor.update({ "system.attributes.hp.value": 0 });
      return chat(actor, { title: item.name, subtitle: t("HeldBack"), body: `<p>${t("Refused")}</p>`, cls: "death", img: item.img, rolls });
    }
  }
  if (choice.reduce && ts > 0) await spendUse(reduceItem);

  /* Card, strain, then the power's own activity */
  const strainRes = alloc ? await applyStrain(actor, alloc.delta, { silent: true }) : null;
  const testLine = order >= 2
    ? `<p><span class="stm-roll">d${die}: ${rolls.map(r => r.total).join(" → ")}</span> ${tf("VsScore", { score })}${choice.reduce && ts > 0 ? ` · ${t("ReducedStress")}` : ""}</p>`
    : `<p>${t("NoTest")}</p>`;
  const body = `<p class="stm-meta">${ordinal(order)} ${t("Order")} ${power.specialty}${scaling ? ` (+${scaling})` : ""} · ${tf("DcAttack", { dc: 8 + prof(actor) + intMod(actor), atk: prof(actor) + intMod(actor) })}</p>
    ${testLine}${ex ? `<p>${tf("ExertionUsed", { name: esc(ex.label), n: ex.n })}</p>` : ""}${strainRes?.html ?? `<p>${t("NoStrain")}</p>`}`;
  await chat(actor, {
    title: item.name, subtitle: t("Manifested"), body, img: item.img,
    cls: strainRes?.died ? "death" : strainRes?.gained ? "gain" : "clean",
    rolls: [...rolls, ...(strainRes?.rolls ?? [])]
  });

  const usage = { scaling };
  if (mustEnd && pre.end) usage.concentration = { begin: true, end: pre.end };
  return runActivity(activity, usage);
}

/* -------------------------------------------- */
/*  Features                                    */
/* -------------------------------------------- */

/** Strain range for a feature activity: { min, max } or null. */
function featureStrain(activity) {
  const conf = activity.item.getFlag(MODULE_ID, "strain");
  const c = conf?.[activity.id] ?? conf?.["*"];
  if (!c) return null;
  const actor = activity.item.actor;
  const resolve = v => v === "pb" ? prof(actor)
    : v === "cr" ? Math.max(1, Math.floor(talentLevel(actor) / 3))
    : v === "any" ? Math.max(1, strainMax(actor) - strainTotal(getStrain(actor)) + 1)
    : Number(v) || 1;
  const min = resolve(c.min ?? c.max ?? 1);
  return { min, max: Math.max(min, resolve(c.max ?? c.min ?? 1)) };
}

/** A feature activity that costs strain: pick the amount, assign it, then run the activity scaled by it. */
export async function useStrainFeature(activity) {
  const actor = activity.item.actor;
  const range = featureStrain(activity);
  const uses = usesOf(activity.item);
  if (uses && uses.value <= 0 && activity.consumption?.targets?.length) {
    return ui.notifications.warn(tf("NoUses", { name: activity.item.name }));
  }
  const alloc = await allocateStrain(actor, {
    amount: range.min, min: range.min, max: range.max, mode: "gain",
    title: `${activity.item.name}${activity.name && activity.name !== activity.item.name ? `: ${activity.name}` : ""}`,
    hint: range.min === range.max ? tf("FeatureCost", { n: range.min }) : tf("FeatureRange", { min: range.min, max: range.max })
  });
  if (!alloc) return;
  const res = await applyStrain(actor, alloc.delta, { silent: true });
  await chat(actor, { title: activity.item.name, subtitle: tf("NStrain", { n: alloc.amount }), body: res.html, img: activity.item.img, cls: res.died ? "death" : "gain", rolls: res.rolls });
  return runActivity(activity, { scaling: Math.max(0, alloc.amount - 1) });
}

/** Psychic Boost: remove strain equal to proficiency bonus. */
export async function psychicBoost(activity) {
  const actor = activity.item.actor;
  const total = strainTotal(getStrain(actor));
  if (!total) return ui.notifications.info(t("NoStrainToRemove"));
  const uses = usesOf(activity.item);
  if (uses && uses.value <= 0) return ui.notifications.warn(tf("NoUses", { name: activity.item.name }));
  const n = Math.min(prof(actor), total);
  const alloc = await allocateStrain(actor, { amount: n, mode: "remove", title: activity.item.name, hint: tf("BoostHint", { n: prof(actor) }) });
  if (!alloc) return;
  await applyStrain(actor, alloc.delta, { reason: activity.item.name });
  return runActivity(activity, {});
}

/* -------------------------------------------- */
/*  Concentration, rests, learning              */
/* -------------------------------------------- */

/** Strain to Maintain: keep every concentrated power by gaining strain equal to their total order. */
export async function strainToMaintain(actor) {
  const conc = powerConcentration(actor);
  if (!conc.length) return ui.notifications.info(t("NotConcentrating"));
  const sum = conc.reduce((a, c) => a + c.order, 0);
  const list = conc.map(c => `${esc(c.item.name)} (${ordinal(c.order)})`).join(", ");
  const choice = await DialogV2.wait({
    window: { title: t("StrainToMaintain"), icon: "fa-solid fa-brain" },
    classes: ["stm-dialog-app"],
    content: `<div class="stm-dialog"><p>${tf("MaintainPrompt", { n: conc.length })}</p><p class="stm-hint">${list}</p></div>`,
    buttons: [
      { action: "keep", label: tf("KeepAll", { n: sum }), icon: "fa-solid fa-link", default: true, callback: () => "keep" },
      { action: "drop", label: t("LetEnd"), icon: "fa-solid fa-link-slash", callback: () => "drop" }
    ],
    rejectClose: false
  });
  if (choice === "keep") {
    const alloc = await allocateStrain(actor, { amount: sum, mode: "gain", title: t("StrainToMaintain"), hint: list });
    if (!alloc) return;
    return applyStrain(actor, alloc.delta, { reason: tf("Maintained", { list }) });
  }
  if (choice === "drop") {
    for (const c of conc) await actor.endConcentration(c.effect);
    return chat(actor, { title: t("ConcentrationBroken"), body: `<p>${tf("Ended", { list })}</p>`, img: ICONS.strain });
  }
}

/** Hit dice still available on the Talent class item. */
export function hitDiceLeft(actor) {
  const cls = actor.classes?.[CLASS_ID];
  if (!cls) return 0;
  return Math.max(0, (cls.system.levels ?? 0) - (cls.system.hd?.spent ?? cls.system.hitDiceUsed ?? 0));
}

/** Spend Talent Hit Dice to remove strain, 1 per die. */
export async function spendHitDice(actor) {
  const total = strainTotal(getStrain(actor));
  const hd = hitDiceLeft(actor);
  const max = Math.min(total, hd);
  if (!max) return ui.notifications.info(total ? t("NoHitDice") : t("NoStrainToRemove"));
  const alloc = await allocateStrain(actor, { amount: max, min: 0, max, mode: "remove", title: t("SpendHitDice"), hint: tf("SpendHint", { hd }) });
  if (!alloc || !alloc.amount) return;
  const cls = actor.classes[CLASS_ID];
  const key = cls.system.hd ? "system.hd.spent" : "system.hitDiceUsed";
  await cls.update({ [key]: (foundry.utils.getProperty(cls, key) ?? 0) + alloc.amount });
  return applyStrain(actor, alloc.delta, { reason: tf("SpentHitDice", { n: alloc.amount }) });
}

/** Level 20: choose which strain type to ignore until the next long rest. */
export async function chooseIgnore(actor) {
  const current = ignoredType(actor);
  const choice = await DialogV2.wait({
    window: { title: t("IgnoreStrain"), icon: "fa-solid fa-shield-halved" },
    classes: ["stm-dialog-app"],
    content: `<div class="stm-dialog"><p>${t("IgnorePrompt")}</p></div>`,
    buttons: ["body", "mind", "soul"].map(k => ({ action: k, label: t(`Type.${k}`), default: k === current, callback: () => k })),
    rejectClose: false
  });
  if (!choice) return;
  await actor.setFlag(MODULE_ID, "ignore", choice);
  await syncStrainEffects(actor);
  return chat(actor, { title: t("IgnoreStrain"), body: `<p>${tf("Ignoring", { type: t(`Type.${choice}`) })}</p>`, img: ICONS.focus });
}

/** Compendium index of powers (cached). */
let powerIndex = null;
export async function getPowerIndex() {
  if (powerIndex) return powerIndex;
  const pack = game.packs.get(POWERS_PACK);
  if (!pack) return [];
  const index = await pack.getIndex({ fields: ["flags.stm.power", "img"] });
  powerIndex = index.filter(e => e.flags?.stm?.power).map(e => ({ uuid: e.uuid, name: e.name, img: e.img, ...e.flags.stm.power }));
  powerIndex.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return powerIndex;
}

/** Learning from Others: roll the manifestation die against a power's base order. */
export async function learnFromOthers(actor) {
  const known = new Set(powerItems(actor).map(i => i.name));
  const max = maxOrder(actor);
  const options = (await getPowerIndex()).filter(p => p.order >= 2 && p.order <= max && !known.has(p.name));
  if (!options.length) return ui.notifications.info(t("NothingToLearn"));
  const uuid = await DialogV2.wait({
    window: { title: t("LearnFromOthers"), icon: "fa-solid fa-eye" },
    classes: ["stm-dialog-app"],
    content: `<div class="stm-dialog"><p class="stm-hint">${t("LearnHint")}</p>
      <div class="stm-row"><label for="stm-lp">${t("PowerSeen")}</label><select id="stm-lp" name="power">
      ${options.map(p => `<option value="${p.uuid}">${esc(p.name)} · ${ordinal(p.order)} ${esc(p.specialty)}</option>`).join("")}</select></div></div>`,
    buttons: [
      { action: "roll", label: tf("RollDie", { die: manifestDie(actor) }), icon: "fa-solid fa-dice", default: true,
        callback: (e, b) => (b.form ?? b.closest(".application")).querySelector("[name=power]").value },
      { action: "cancel", label: t("Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  if (!uuid) return;
  const p = options.find(o => o.uuid === uuid);
  const die = manifestDie(actor);
  const adept = featureItem(actor, "adept");
  const twice = adept && (adept.getFlag(MODULE_ID, "specialty") ?? specialization(actor).specialty) === p.specialty;
  const roll = await new Roll(twice ? `2d${die}kh` : `1d${die}`).evaluate();
  const r = roll.total;
  const ok = r > p.order;
  const body = `<p><span class="stm-roll">${twice ? `2d${die}kh` : `d${die}`} = ${r}</span> ${tf("VsOrder", { order: p.order })}</p>
    <p>${ok ? tf("LearnOk", { days: LEARN_DAYS[p.order] }) : r === p.order ? t("LearnTie") : t("LearnFail")}</p>`;
  return chat(actor, { title: tf("Learning", { name: p.name }), subtitle: t("Reaction"), body, img: p.img, cls: ok ? "clean" : "gain", rolls: [roll] });
}

/** Add a power from the compendium. */
export async function learnPower(actor, uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) return;
  if (actor.items.some(i => i.getFlag(MODULE_ID, "power") && i.name === doc.name)) return;
  const data = doc.toObject();
  foundry.utils.setProperty(data, "_stats.compendiumSource", uuid);
  delete data._id;
  await actor.createEmbeddedDocuments("Item", [data]);
}

/** Add Talent class and specialization features the actor is missing (e.g. after a Plutonium import). */
export async function syncFeatures(actor) {
  const pack = game.packs.get(TALENT_PACK);
  if (!pack) return;
  const level = talentLevel(actor);
  const spec = specialization(actor).key;
  const index = await pack.getIndex({ fields: ["flags.stm", "system.identifier", "type"] });
  const owned = new Set(actor.items.map(i => i.system?.identifier).filter(Boolean));
  const wanted = index.filter(e => {
    const f = e.flags?.stm ?? {};
    if (e.type !== "feat" || !f.feature || f.exertion) return false;
    if ((f.level ?? 1) > level) return false;
    if (f.specialization && f.specialization !== spec) return false;
    return !owned.has(e.system?.identifier);
  });
  const docs = await Promise.all(wanted.map(e => pack.getDocument(e._id)));
  const data = docs.filter(Boolean).map(d => {
    const o = d.toObject();
    delete o._id;
    foundry.utils.setProperty(o, "_stats.compendiumSource", d.uuid);
    return o;
  });
  if (data.length) await actor.createEmbeddedDocuments("Item", data);
  await syncStrainEffects(actor);
  return data.length;
}

export { SPECIALIZATIONS, TABLE, STRAIN_TYPES, EFFECT_STEPS, LEARN_DAYS };
