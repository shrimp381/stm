/**
 * STM: sheet support for the MCDM Talent class on D&D 5e (Foundry v13, dnd5e 5.x).
 *
 * - Default dnd5e character sheet: a Psionics tab is added to the stock sheet and
 *   shown only on characters with a Talent class item. No sheet switch needed.
 * - Tidy 5e Sheets: the same tab, registered through Tidy's API.
 * - Items used from anywhere (sheet, Tidy, Argon, hotbar) run through the
 *   dnd5e.preUseActivity hook, so manifesting always goes through the strain flow.
 */

import { MODULE_ID, CLASS_ID, STRAIN_TYPES } from "./data.js";
import {
  t, isTalent, isResponsibleUser, manifestPower, useStrainFeature, psychicBoost, bypass,
  syncStrainEffects, strainToMaintain, powerConcentration, getStrain, strainTotal, hitDiceLeft,
  spendHitDice, chooseIgnore, effectActive, talentLevel, featureItem,
  applyStrain, allocateStrain, setStrain, learnFromOthers, learnPower, syncFeatures, getPowerIndex
} from "./mechanics.js";
import { BODY_TEMPLATE, prepareTabContext, bindTab } from "./tab.js";

const PART_TEMPLATE = `modules/${MODULE_ID}/templates/stm-part.hbs`;
const PART_ID = "stmPsionics";
const POWER_SECTION = "stm-powers";
const EXERTION_SECTION = "stm-exertion";

/* -------------------------------------------- */
/*  First render per actor                      */
/* -------------------------------------------- */

const prepared = new Set();
function ensurePrepared(actor) {
  if (!actor?.isOwner || prepared.has(actor.uuid)) return;
  prepared.add(actor.uuid);
  syncStrainEffects(actor);
}

/* -------------------------------------------- */
/*  Default dnd5e sheet                         */
/* -------------------------------------------- */

function extendDefaultSheet() {
  const Sheet = dnd5e.applications.actor.CharacterActorSheet;
  if (!Sheet || Sheet.PARTS[PART_ID]) return;

  // Insert the Psionics part among the tab bodies, before the non-tab parts.
  const parts = {};
  for (const [key, part] of Object.entries(Sheet.PARTS)) {
    if (key === "abilityScores") {
      parts[PART_ID] = {
        container: { classes: ["tab-body"], id: "tabs" },
        template: PART_TEMPLATE,
        templates: [BODY_TEMPLATE],
        scrollable: [""]
      };
    }
    parts[key] = part;
  }
  if (!parts[PART_ID]) parts[PART_ID] = { container: { classes: ["tab-body"], id: "tabs" }, template: PART_TEMPLATE, templates: [BODY_TEMPLATE], scrollable: [""] };
  Sheet.PARTS = parts;
  Sheet.TABS = [...Sheet.TABS, { tab: PART_ID, label: "STM.Tab", icon: "fa-solid fa-brain", condition: isTalent }];

  const proto = Sheet.prototype;

  const partContext = proto._preparePartContext;
  proto._preparePartContext = async function(partId, context, options) {
    context = await partContext.call(this, partId, context, options);
    if (partId === PART_ID) context.stm = await prepareTabContext(this.actor, { editable: this.isEditable });
    return context;
  };

  const onRender = proto._onRender;
  proto._onRender = function(context, options) {
    onRender.call(this, context, options);
    if (!isTalent(this.actor)) return;
    bindTab(this.element, this.actor, () => this.render({ parts: [PART_ID] }));
    if (this.isEditable) ensurePrepared(this.actor);
  };

  // Features tab: psionic powers and exertion options get their own sections.
  const featuresContext = proto._prepareFeaturesContext;
  proto._prepareFeaturesContext = async function(context, options) {
    context = await featuresContext.call(this, context, options);
    if (!isTalent(this.actor) || !Array.isArray(context.sections)) return context;
    const columns = context.sections[0]?.columns ?? [];
    const add = (id, label, order) => context.sections.push({
      id, label, order, columns, items: [],
      groups: { origin: id, activation: id },
      dataset: { "group-origin": id, "group-activation": id }
    });
    if (this.actor.items.some(i => i.getFlag(MODULE_ID, "power"))) add(POWER_SECTION, "STM.Powers", 60);
    if (this.actor.items.some(i => i.getFlag(MODULE_ID, "exertion"))) add(EXERTION_SECTION, "STM.Exertion", 70);
    context.sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return context;
  };

  const itemFeature = proto._prepareItemFeature;
  proto._prepareItemFeature = async function(item, ctx) {
    await itemFeature.call(this, item, ctx);
    if (!ctx?.groups) return;
    const section = item.getFlag?.(MODULE_ID, "power") ? POWER_SECTION : item.getFlag?.(MODULE_ID, "exertion") ? EXERTION_SECTION : null;
    if (section) ctx.groups.origin = ctx.groups.activation = section;
  };
}

/* -------------------------------------------- */
/*  Tidy 5e Sheets                              */
/* -------------------------------------------- */

function registerTidyTab(api) {
  api.registerCharacterTab(
    new api.models.HandlebarsTab({
      title: "STM.Tab",
      tabId: `${MODULE_ID}-psionics`,
      iconClass: "fa-solid fa-brain",
      path: `/${BODY_TEMPLATE}`,
      tabContentsClasses: ["stm-tidy-tab"],
      enabled: context => isTalent(context.actor),
      getData: async context => ({
        ...context,
        stm: await prepareTabContext(context.actor, { editable: context.editable ?? context.actor?.isOwner })
      }),
      onRender: params => {
        const actor = params.data?.actor ?? params.app?.actor ?? params.app?.document;
        if (!actor) return;
        bindTab(params.tabContentsElement, actor, () => params.app.render());
        if (actor.isOwner) ensurePrepared(actor);
      }
    })
  );
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const setting = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `STM.Settings.${key}.Name`, hint: `STM.Settings.${key}.Hint`, scope: "world", config: true, ...data
  });
  setting("resourceSlot", {
    type: String, default: "primary",
    choices: { primary: "STM.Settings.resourceSlot.Primary", secondary: "STM.Settings.resourceSlot.Secondary", tertiary: "STM.Settings.resourceSlot.Tertiary", none: "STM.Settings.resourceSlot.None" }
  });
  setting("automateDeath", { type: Boolean, default: true });
  setting("cosmeticEffects", { type: Boolean, default: false });
  setting("halveHealing", { type: Boolean, default: true });
  setting("maintainPrompt", { type: Boolean, default: true });
  setting("restPrompt", { type: Boolean, default: true });

  CONFIG.DND5E.featureTypes.class.subtypes.stmPower = "STM.Subtype.Power";
  CONFIG.DND5E.featureTypes.class.subtypes.stmExertion = "STM.Subtype.Exertion";

  foundry.applications.handlebars.loadTemplates([BODY_TEMPLATE, PART_TEMPLATE]);
  extendDefaultSheet();

  game.modules.get(MODULE_ID).api = {
    isTalent, getStrain, setStrain, applyStrain, allocateStrain, manifestPower, strainToMaintain,
    spendHitDice, chooseIgnore, learnFromOthers, learnPower, syncFeatures, syncStrainEffects, getPowerIndex
  };
});

Hooks.once("tidy5e-sheet.ready", registerTidyTab);

/** Route power and feature use through the strain flow. */
Hooks.on("dnd5e.preUseActivity", activity => {
  if (bypass.has(activity?.uuid)) return;
  const item = activity?.item;
  const actor = item?.actor;
  if (!item || !isTalent(actor)) return;
  const power = item.getFlag(MODULE_ID, "power");
  if (power) {
    // Follow-up activities (e.g. detonating Detonate's spark) run without a new manifestation.
    if (power.free?.includes(activity.id)) return;
    manifestPower(activity);
    return false;
  }
  if (item.getFlag(MODULE_ID, "feature") === "psychicBoost") { psychicBoost(activity); return false; }
  const strain = item.getFlag(MODULE_ID, "strain");
  if (strain && (strain[activity.id] ?? strain["*"])) { useStrainFeature(activity); return false; }
});

/** Failed concentration save while holding powers: offer Strain to Maintain. */
Hooks.on("dnd5e.rollConcentrationV2", (rolls, { subject }) => {
  const actor = subject;
  if (!isTalent(actor) || !actor.isOwner || !game.settings.get(MODULE_ID, "maintainPrompt")) return;
  const roll = rolls?.[0];
  if (!roll?.isFailure) return;
  if (powerConcentration(actor).length) strainToMaintain(actor);
});

/** Long rest: strain to 0 and Ignore Strain resets. */
Hooks.on("dnd5e.preRestCompleted", (actor, result) => {
  if (!isTalent(actor) || !result.longRest) return;
  result.updateData[`flags.${MODULE_ID}.strain`] = Object.fromEntries(STRAIN_TYPES.map(k => [k, 0]));
  result.updateData[`flags.${MODULE_ID}.ignore`] = null;
});

Hooks.on("dnd5e.restCompleted", async (actor, result) => {
  if (!isTalent(actor) || !isResponsibleUser(actor)) return;
  await syncStrainEffects(actor);
  if (!game.settings.get(MODULE_ID, "restPrompt")) return;
  if (result.longRest) {
    if (talentLevel(actor) >= 20) await chooseIgnore(actor);
  } else if (strainTotal(getStrain(actor)) && hitDiceLeft(actor)) {
    await spendHitDice(actor);
  }
});

/** Soul strain 7: supernatural healing is halved. */
Hooks.on("dnd5e.calculateDamage", (actor, damages) => {
  if (!isTalent(actor) || !game.settings.get(MODULE_ID, "halveHealing")) return;
  if (!effectActive(actor, "soul", 7)) return;
  for (const d of damages) {
    if (d.type === "healing" && d.value < 0) {
      d.value = -Math.floor(Math.abs(d.value) / 2);
      d.active ??= {};
      d.active.stmHalved = true;
    }
  }
});

/** Level or HP changes move the numbers the effects depend on. */
Hooks.on("updateItem", (item, changes, _opts, userId) => {
  if (userId !== game.user.id || item.type !== "class" || item.identifier !== CLASS_ID) return;
  if (foundry.utils.hasProperty(changes, "system.levels")) syncStrainEffects(item.parent);
});
Hooks.on("createItem", (item, _opts, userId) => {
  if (userId === game.user.id && item.type === "class" && item.identifier === CLASS_ID) syncStrainEffects(item.parent);
});
Hooks.on("updateActor", (actor, changes, _opts, userId) => {
  if (userId !== game.user.id || !isTalent(actor)) return;
  if (foundry.utils.hasProperty(changes, "system.abilities.con") || foundry.utils.hasProperty(changes, "system.attributes.hp.max")) syncStrainEffects(actor);
});
