# STM

Strain tracking and psionics for the **Talent** class on the D&D 5e system. STM adds a **Psionics** tab that tracks body, mind and soul strain, applies strain effects automatically, and runs the whole manifestation flow: order, manifestation test, Adept rerolls, Psionic Exertion, strain assignment, and the power's own attack, save or damage card.

- **Both sheets:** the tab appears on the default D&D 5e character sheet (no sheet switch needed) and on **Tidy 5e Sheets**. It only shows on characters with a Talent class.
- **Works from anywhere:** using a power or feature from the sheet, Tidy, Argon Combat HUD or the hotbar goes through the same strain flow.

Requirements: Foundry VTT v13, D&D 5e system 5.x (built against 5.0.4). Tidy 5e Sheets is optional.

## Install

In Foundry: **Add-on Modules → Install Module**, paste this manifest URL:

```
https://raw.githubusercontent.com/Shrimp381/stm/main/module.json
```

Enable **STM** in your world.

## Compendiums

The **STM: Talent** compendium folder contains:

- **STM: Talent Class & Features.**
  - **The Talent class.** Its level-up covers:
    - Hit Points and proficiencies
    - the class features
    - Psionic Specialization at 2nd level
    - Psionic Exertion choices at 3rd, 7th, 11th and 15th
    - Ability Score Improvements
    - power picks
    - scale values: manifestation die, strain maximum, 1st-order powers, highest order, Psychic Boost uses
  - **All seven specializations:** Chronopath, Metamorph, Pyrokinetic, Resopath, Telekinetic, Telepath and Maverick, with every feature.
  - **The nine Psionic Exertion options.**
- **STM: Psionic Powers.** All 103 powers, foldered by order. Each has:
  - its manifestation time, range, duration and concentration
  - an attack, save, heal or damage activity where the text has one
  - damage that grows with increased order where the power says so
  - level scaling for 1st-order damage powers

## Set up a character

Drag the **Talent** class from the compendium onto a character and level up as normal.

- **Powers:** pick four 1st-order powers and two powers of 2nd order or higher at 1st level, then one power per level after that. The level-up dialog can't limit the list by order, so only take powers of an order you can manifest. The tab shows your maximum order.
- **Imported with Plutonium?** If the class came from Plutonium or another importer, open the Psionics tab and click **Add missing Talent features**. This adds every class and specialization feature for your level from the STM compendium. If the character has no specialization item, pick your specialization from the dropdown at the top of the tab.

## The Psionics tab

| Section | What it does |
|---|---|
| **Strain** | Total strain against your maximum, a bar split by type, and a track for body, mind and soul. Click a pip to set a track directly. The effects at 1, 3, 5 and 7 light up as they apply. **Gain strain** and **Remove** open the split dialog for manual changes. |
| **Stats** | Manifestation die, power save DC, power attack, highest order and concentration slots. |
| **Buttons** | **Psychic Boost**, **Failed concentration save** (Strain to Maintain), **Spend Hit Dice on strain**, **Learn from others**. At 20th level, the **Ignore Strain** choice. |
| **Concentrating** | The powers you're concentrating on and the order each was manifested at. The next manifestation score goes up by one for each. Click × to end one. |
| **Psionic Powers** | Known powers grouped by order, with filters by specialty and concentration. **Manifest** starts the flow. Click a name to read it. **Learn power** adds one from the compendium. |
| **Talent Features** | Your class and specialization features with their uses. Buttons marked with a brain cost strain. |
| **Psionic Exertion** | Your chosen options and their costs. |

### Manifesting

1. **Choose the order.** Pick the order to manifest at (increased order up to 6th). The dialog shows the manifestation score, including +1 for each other power you're concentrating on. If you're at your concentration limit, pick which power to end.
2. **Manifestation test.** For 2nd order and up, STM rolls your manifestation die against the score:
   - roll higher: no strain
   - roll equal: 1 strain
   - roll lower: strain equal to the order
3. **Options.** Depending on your features:
   - **Adept reroll:** when the power's specialty matches your specialization. Pick the roll you keep.
   - **Reduce Stress** (Maverick): halves the test strain.
   - **Psionic Exertion:** choose one option. Its strain is added to the test strain.
4. **Assign strain.** Split the strain between body, mind and soul. If it would take you past your maximum, choose one:
   - **Manifest, then die**
   - **Don't manifest:** you gain no strain and drop to 0 HP
5. **Chat cards.** A card shows the test, the strain and any new strain effects. Then the power's own activity runs. Increased order scales damage automatically for powers that say so.

### Automation

- **Strain effects** are one Active Effect named *Strain*, rebuilt whenever strain changes. Ignore Strain leaves the chosen type out.

  | Strain | Body | Mind | Soul |
  |---|---|---|---|
  | 1 | disadvantage on STR/DEX checks | Dash, Disengage and Dodge are listed only (not enforced) | disadvantage on WIS/CHA checks |
  | 3 | speed halved | skill proficiencies removed | disadvantage on death saves |
  | 5 | disadvantage on STR/DEX saves | −5 AC | disadvantage on WIS/CHA saves |
  | 7 | hit point maximum halved | save proficiencies removed | healing halved (setting) |
- **Concentration:**
  - A *Psionic Focus* effect raises your concentration limit to your proficiency bonus.
  - Powers use the system's own concentration.
  - When you fail a concentration save while holding powers, STM offers **Strain to Maintain**.
- **Rests:**
  - **Long rest:** strain goes to 0. At 20th level you're asked which type to ignore.
  - **Short rest:** you're offered the Hit Dice exchange, 1 strain per die.
- **Resource:** the strain total and maximum are mirrored to the primary resource (you can change or turn this off in settings), so they show on the sheet header and token bars. Edit strain on the tab, not the resource.
- **Strain-costing features:** Decay, Time Pocket, Mind Surgeon, Death Foiled, Manifest Ally, Strong Mind, Truth Hurts, Shock Absorption and Fickle Readiness ask for the strain amount first. Effects that scale with it (damage, healing) use that amount.
- **Energy Unleashed** (Maverick): rolled automatically every time you gain strain.
- **Death:** going over the strain maximum sets HP to 0 and death saves to three failures. This can be turned off in settings.

## Settings

| Setting | Default |
|---|---|
| Show strain as a sheet resource | Primary resource |
| Apply strain death and 0 HP | On |
| Roll optional cosmetic strain effects | Off |
| Halve healing at soul strain 7 | On |
| Offer Strain to Maintain | On |
| Rest prompts | On |

## Macro API

`game.modules.get("stm").api` exposes:
- `getStrain`, `setStrain` and `applyStrain`
- `allocateStrain`
- `manifestPower(activity)`
- `strainToMaintain`, `spendHitDice` and `chooseIgnore`
- `learnFromOthers`, `learnPower` and `syncFeatures`

## Not automated

- **Mind strain 1:** the rule that you can't Dash, Disengage or Dodge is listed only, not enforced.
- **Exertion effects:** Psionic Exertion adds strain. The effect itself (prone, charmed, doubled area, and so on) is applied by the GM.
- **Spells and powers:** the rule that you can't concentrate on a spell and a power at the same time isn't enforced.
- **Learning from Others:** a tie on the manifestation die isn't covered by the rules and is treated as a failure.

## Content

*The Talent and Psionics* is © MCDM Productions. The compendium text is taken from that book for use at your own table. Check MCDM's licence before you redistribute it publicly.
