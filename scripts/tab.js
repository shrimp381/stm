/**
 * The Psionics tab: context preparation and click handling, shared by the
 * default dnd5e character sheet and Tidy 5e Sheets.
 *
 * Controls use data-stm-action (not data-action) so neither sheet's own
 * ApplicationV2 action dispatch picks them up.
 */

import {
  MODULE_ID, TALENT_PACK, SPECIALTIES, SPECIALIZATIONS, STRAIN_TYPES, EFFECT_STEPS, TABLE
} from "./data.js";
import {
  t, tf, ordinal, talentLevel, specialization, getStrain, strainTotal, strainMax, manifestDie, maxOrder,
  intMod, prof, ignoredType, featureItem, powerItems, exertionItems, usesOf, powerConcentration,
  hitDiceLeft, setTrack, allocateStrain, applyStrain, strainToMaintain, spendHitDice, chooseIgnore,
  learnFromOthers, learnPower, syncFeatures, getPowerIndex, syncStrainEffects
} from "./mechanics.js";

export const BODY_TEMPLATE = `modules/${MODULE_ID}/templates/stm-body.hbs`;

const viewState = new Map();
function stateFor(actor) {
  if (!viewState.has(actor.uuid)) viewState.set(actor.uuid, { filter: "all", open: null });
  return viewState.get(actor.uuid);
}

let exertionIndex = null;
async function getExertionIndex() {
  if (exertionIndex) return exertionIndex;
  const pack = game.packs.get(TALENT_PACK);
  if (!pack) return [];
  const index = await pack.getIndex({ fields: ["flags.stm.exertion"] });
  exertionIndex = index.filter(e => e.flags?.stm?.exertion).map(e => ({ uuid: e.uuid, name: e.name }));
  return exertionIndex;
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#x27;": "'", "&#39;": "'", "&nbsp;": " " };
const plain = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&[#\w]+;/g, e => ENTITIES[e] ?? e).replace(/\s+/g, " ").trim();
const clip = (s, n) => s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n))}…`;

export async function prepareTabContext(actor, { editable = actor.isOwner } = {}) {
  const view = stateFor(actor);
  const level = talentLevel(actor);
  const spec = specialization(actor);
  const strain = getStrain(actor);
  const total = strainTotal(strain);
  const max = strainMax(actor);
  const ignore = ignoredType(actor);
  const pb = prof(actor);
  const int = intMod(actor);

  const scaleBase = Math.max(max, total) || 1;
  const bar = STRAIN_TYPES.map(k => ({ key: k, width: `${(strain[k] / scaleBase * 100).toFixed(2)}%` }));
  const state = total > max ? { cls: "bad", label: t("State.Over") }
    : total === max ? { cls: "warn", label: t("State.AtMax") }
    : { cls: max - total <= 2 ? "warn" : "", label: tf("State.Left", { n: max - total }) };

  const tracks = STRAIN_TYPES.map(k => ({
    key: k,
    label: t(`Type.${k}`),
    value: strain[k],
    ignored: ignore === k,
    pips: Array.from({ length: Math.max(8, strain[k]) }, (_, i) => ({ n: i + 1, on: i < strain[k], odd: (i + 1) % 2 === 1 })),
    effects: EFFECT_STEPS.map(s => ({ step: s, text: t(`Effect.${k}.${s}`), on: strain[k] >= s }))
  }));

  // Concentration
  const conc = powerConcentration(actor).map(c => ({ id: c.effect.id, name: c.item.name, order: ordinal(c.order) }));
  const limit = Math.max(actor.system.attributes?.concentration?.limit ?? 0, pb);
  const slots = Array.from({ length: Math.max(0, limit - conc.length) });

  // Powers
  const adept = featureItem(actor, "adept");
  const adeptSpecialty = adept ? (adept.getFlag(MODULE_ID, "specialty") ?? spec.specialty) : null;
  const concIds = new Set(powerConcentration(actor).map(c => c.item.id));
  const mo = maxOrder(actor);
  const powers = powerItems(actor).map(i => {
    const p = i.getFlag(MODULE_ID, "power");
    return {
      id: i.id, name: i.name, img: i.img, order: p.order, o1: p.order === 1, specialty: p.specialty,
      time: p.time ?? "", range: p.range ?? "", duration: p.duration ?? "",
      concentration: !!p.concentration, adept: adeptSpecialty === p.specialty,
      aboveMax: p.order > mo, active: concIds.has(i.id), open: view.open === i.id,
      text: i.system.description?.value ?? "", increased: !!p.increased
    };
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const firstKnown = powers.filter(p => p.order === 1).length;
  const higherKnown = powers.length - firstKnown;
  const filtered = powers.filter(p => view.filter === "all" || (view.filter === "conc" ? p.concentration : p.specialty === view.filter));
  const groups = [1, 2, 3, 4, 5, 6].map(o => ({
    order: o, label: `${ordinal(o)} ${t("Order")}`,
    note: o === 1 ? t("AtWill") : o > mo ? t("AboveMax") : tf("ScoreFrom", { n: o }),
    items: filtered.filter(p => p.order === o)
  })).filter(g => g.items.length);
  const filters = [["all", t("All")], ["conc", t("Concentration")], ...SPECIALTIES.map(s => [s, s])]
    .map(([id, label]) => ({ id, label, active: view.filter === id }));

  const known = new Set(powers.map(p => p.name));
  const index = await getPowerIndex();
  const learnable = [1, 2, 3, 4, 5, 6].filter(o => o <= mo).map(o => ({
    label: `${ordinal(o)} ${t("Order")}`,
    options: index.filter(p => p.order === o && !known.has(p.name)).map(p => ({ uuid: p.uuid, label: `${p.name} · ${p.specialty}` }))
  })).filter(g => g.options.length);

  // Exertion
  const exAllowed = TABLE.exertions(level);
  const exOwned = exertionItems(actor).map(i => ({
    id: i.id, name: i.name, img: i.img,
    cost: i.getFlag(MODULE_ID, "exertion")?.costText ?? "",
    text: clip(plain(i.system.description?.value), 220)
  }));
  const ownedNames = new Set(exOwned.map(e => e.name));
  const exAddable = exOwned.length < exAllowed ? (await getExertionIndex()).filter(e => !ownedNames.has(e.name)) : [];

  // Features
  const features = actor.items.filter(i => i.getFlag(MODULE_ID, "feature") && !i.getFlag(MODULE_ID, "exertion"))
    .map(i => {
      const uses = usesOf(i);
      const acts = [...(i.system.activities ?? [])].map(a => ({ id: a.id, name: a.name || t("Use") }));
      const strainConf = i.getFlag(MODULE_ID, "strain") ?? {};
      return {
        id: i.id, name: i.name, img: i.img, level: i.getFlag(MODULE_ID, "level") ?? 1,
        spec: !!i.getFlag(MODULE_ID, "specialization"),
        uses, empty: uses && uses.value <= 0,
        activities: acts.map(a => ({ ...a, strain: !!(strainConf[a.id] ?? strainConf["*"]) })),
        text: clip(plain(i.system.description?.value), 240)
      };
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const boost = featureItem(actor, "psychicBoost");
  const boostUses = usesOf(boost);

  return {
    editable,
    level,
    spec,
    specOptions: spec.fromItem ? null : Object.entries(SPECIALIZATIONS).map(([value, s]) => ({ value, label: s.label, selected: value === spec.key })),
    total, max, state, bar, over: total > max,
    tracks, ignore, ignoreLabel: ignore ? t(`Type.${ignore}`) : "", level20: level >= 20,
    stats: [
      { label: t("Stat.Die"), value: `d${manifestDie(actor)}` },
      { label: t("Stat.Dc"), value: 8 + pb + int },
      { label: t("Stat.Attack"), value: `${pb + int >= 0 ? "+" : ""}${pb + int}` },
      { label: t("Stat.MaxOrder"), value: ordinal(mo) },
      { label: t("Stat.Conc"), value: `${conc.length}/${limit}` }
    ],
    boost: boost ? { id: boost.id, uses: boostUses, disabled: !editable || !total || (boostUses && boostUses.value <= 0) } : null,
    hitDice: hitDiceLeft(actor),
    conc, slots, concScore: conc.length,
    powers: groups, filters, noPowers: !powers.length,
    counts: {
      first: { n: firstKnown, max: TABLE.firstOrder(level), over: firstKnown > TABLE.firstOrder(level) },
      higher: { n: higherKnown, max: TABLE.higherOrder(level), over: higherKnown > TABLE.higherOrder(level) },
      maxOrder: ordinal(mo)
    },
    learnable,
    exertion: { owned: exOwned, allowed: exAllowed, addable: exAddable, count: exOwned.length },
    features
  };
}

/**
 * Wire the tab's controls. Safe on every render: listeners attach once per root element.
 * @param {HTMLElement} root
 * @param {Actor} actor
 * @param {Function} rerender  re-render the tab after a view-only change
 */
export function bindTab(root, actor, rerender) {
  const el = root?.classList?.contains("stm-root") ? root : root?.querySelector?.(".stm-root");
  if (!el || el._stmBound) return;
  el._stmBound = true;

  el.addEventListener("click", async event => {
    const target = event.target.closest("[data-stm-action]");
    if (!target || !el.contains(target) || target.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      await handleAction(target.dataset.stmAction, target, actor, rerender, el);
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err.message);
    }
  });

  el.addEventListener("change", async event => {
    const target = event.target.closest("[data-stm-change]");
    if (!target) return;
    event.stopPropagation();
    if (target.dataset.stmChange === "spec") {
      await actor.setFlag(MODULE_ID, "specialization", target.value);
    }
  });
}

async function handleAction(action, target, actor, rerender, el) {
  const view = stateFor(actor);
  const itemId = target.closest("[data-item-id]")?.dataset.itemId;
  const item = itemId ? actor.items.get(itemId) : null;
  switch (action) {
    case "pip": {
      const type = target.dataset.type, n = Number(target.dataset.n);
      return setTrack(actor, type, getStrain(actor)[type] === n ? n - 1 : n);
    }
    case "gain": {
      const alloc = await allocateStrain(actor, { amount: 1, min: 1, max: 30, mode: "gain", title: t("GainStrain"), hint: t("ManualHint") });
      if (alloc) return applyStrain(actor, alloc.delta, { reason: t("ManualChange") });
      return;
    }
    case "remove": {
      const total = strainTotal(getStrain(actor));
      if (!total) return;
      const alloc = await allocateStrain(actor, { amount: 1, min: 1, max: total, mode: "remove", title: t("RemoveStrain") });
      if (alloc) return applyStrain(actor, alloc.delta, { reason: t("ManualChange") });
      return;
    }
    case "boost": return item?.use?.();
    case "maintain": return strainToMaintain(actor);
    case "spendHd": return spendHitDice(actor);
    case "learnOthers": return learnFromOthers(actor);
    case "ignore": return chooseIgnore(actor);
    case "endConc": return actor.endConcentration(target.dataset.effectId);
    case "manifest": return item?.use?.();
    case "toggle": view.open = view.open === itemId ? null : itemId; return rerender();
    case "forget": {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("ForgetPower") },
        content: `<p>${tf("ForgetConfirm", { name: item?.name ?? "" })}</p>`,
        rejectClose: false
      });
      if (ok) return item?.delete();
      return;
    }
    case "learn": {
      const uuid = el.querySelector("[data-stm-learn]")?.value;
      if (uuid) return learnPower(actor, uuid);
      return;
    }
    case "addExertion": {
      const uuid = el.querySelector("[data-stm-exertion]")?.value;
      if (uuid) return learnPower(actor, uuid);
      return;
    }
    case "feature": {
      const activity = item?.system.activities?.get(target.dataset.activityId);
      return activity ? activity.use() : item?.use?.();
    }
    case "filter": view.filter = target.dataset.filter; return rerender();
    case "sync": {
      const n = await syncFeatures(actor);
      ui.notifications.info(tf("Synced", { n: n ?? 0 }));
      return;
    }
    case "resync": return syncStrainEffects(actor);
  }
}
