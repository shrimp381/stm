/**
 * STM rules data for the MCDM Talent class.
 * UI-free. Numbers here follow the Talent table in "The Talent and Psionics".
 */

export const MODULE_ID = "stm";
export const CLASS_ID = "talent";
export const POWERS_PACK = `${MODULE_ID}.stm-powers`;
export const TALENT_PACK = `${MODULE_ID}.stm-talent`;

export const STRAIN_TYPES = ["body", "mind", "soul"];
export const EFFECT_STEPS = [1, 3, 5, 7];

/** Class table fallbacks, used when the class item has no scale values (e.g. a Plutonium import). */
export const TABLE = {
  die: level => level >= 13 ? 8 : level >= 5 ? 6 : 4,
  strainMax: level => level + 4,
  firstOrder: level => level >= 10 ? 6 : level >= 4 ? 5 : 4,
  higherOrder: level => level + 1,
  maxOrder: level => level >= 17 ? 6 : level >= 13 ? 5 : level >= 9 ? 4 : level >= 5 ? 3 : 2,
  exertions: level => level >= 15 ? 4 : level >= 11 ? 3 : level >= 7 ? 2 : level >= 3 ? 1 : 0,
  boost: level => level >= 17 ? 3 : level >= 12 ? 2 : level >= 7 ? 1 : 0
};

export const SPECIALTIES = ["Chronopathy", "Metamorphosis", "Pyrokinesis", "Resopathy", "Telekinesis", "Telepathy"];

/** Specializations (subclass identifiers) and the power specialty each one is adept in. */
export const SPECIALIZATIONS = {
  chronopath: { label: "Chronopath", specialty: "Chronopathy" },
  metamorph: { label: "Metamorph", specialty: "Metamorphosis" },
  pyrokinetic: { label: "Pyrokinetic", specialty: "Pyrokinesis" },
  resopath: { label: "Resopath", specialty: "Resopathy" },
  telekinetic: { label: "Telekinetic", specialty: "Telekinesis" },
  telepath: { label: "Telepath", specialty: "Telepathy" },
  maverick: { label: "Maverick", specialty: null }
};

/** Learning New Powers table. */
export const LEARN_DAYS = { 2: 1, 3: 4, 4: 8, 5: 12, 6: 16 };

/**
 * Active Effect changes for each strain step. Mode numbers are CONST.ACTIVE_EFFECT_MODES:
 * 1 MULTIPLY, 2 ADD, 5 OVERRIDE. Functions receive the actor.
 * Steps with no automatable change (mind 1, soul 7) are handled in text or hooks.
 */
const ABL = a => [`system.abilities.${a}`];
export const STRAIN_CHANGES = {
  body: {
    1: () => ["str", "dex"].map(a => ({ key: `${ABL(a)}.check.roll.mode`, mode: 2, value: "-1" })),
    3: () => ["walk", "fly", "swim", "climb", "burrow"].map(m => ({ key: `system.attributes.movement.${m}`, mode: 1, value: "0.5" })),
    5: () => ["str", "dex"].map(a => ({ key: `${ABL(a)}.save.roll.mode`, mode: 2, value: "-1" })),
    7: actor => [{ key: "system.attributes.hp.tempmax", mode: 2, value: String(-Math.floor((actor.system.attributes?.hp?.max ?? 0) / 2)) }]
  },
  mind: {
    1: () => [],
    3: () => Object.keys(CONFIG.DND5E.skills).map(s => ({ key: `system.skills.${s}.value`, mode: 5, value: "0" })),
    5: () => [{ key: "system.attributes.ac.bonus", mode: 2, value: "-5" }],
    7: () => Object.keys(CONFIG.DND5E.abilities).map(a => ({ key: `${ABL(a)}.proficient`, mode: 5, value: "0" }))
  },
  soul: {
    1: () => ["wis", "cha"].map(a => ({ key: `${ABL(a)}.check.roll.mode`, mode: 2, value: "-1" })),
    3: () => [{ key: "system.attributes.death.roll.mode", mode: 2, value: "-1" }],
    5: () => ["wis", "cha"].map(a => ({ key: `${ABL(a)}.save.roll.mode`, mode: 2, value: "-1" })),
    7: () => []
  }
};

export const ICONS = {
  strain: "icons/magic/control/hypnosis-mesmerism-swirl.webp",
  focus: "icons/magic/perception/third-eye-blue-red.webp"
};
