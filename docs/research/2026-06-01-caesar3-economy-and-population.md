# Caesar III Economy & Population — Research Report

_Compiled 2026-06-01 for CityLife colony-sim design basis_

**Sources consulted** (inline throughout; key references):

- Caesar III Augustus Ultimate Handbook — https://www.caesar3augustus.com/
- Caesar 3 Heaven / HeavenGames forums — https://caesar3.heavengames.com/
- Impressions Games Wiki (Fandom) — https://impressionsgames.fandom.com/wiki/Housing_(Caesar_3)
- Archive.org Caesar III Manual scan — https://archive.org/stream/Caesar_III_Manual/Caesar_III_Manual_djvu.txt
- Julius open-source remake wiki — https://github.com/bvschaik/julius/wiki/
- GOG.com Caesar Series forum — https://www.gog.com/forum/caesar_series/
- Teoalida's Caesar 3 analysis — https://www.teoalida.com/games/caesar3/
- Steam guide "Caesar 3 Basics" — https://steamcommunity.com/sharedfiles/filedetails/?id=2803261871
- Pinouchon closed-loop block design — http://pinouchon.github.io/caesar3/2016/08/25/caesar3-palace-block-design.html

---

## 1. IMMIGRATION & POPULATION

### 1.1 Entry Points and the Kingdom Road

All immigrants enter the map from a single edge point — the start of the **Kingdom Road** (Rome Road). A newly placed housing plot that is within 2 tiles of a road will pull an immigrant walker from that entry. The immigrant graphic is a person walking along roads toward an empty housing tile.

### 1.2 What Triggers Immigration

Immigration is governed by a **city sentiment score** (0–100), which the game computes from multiple factors. When sentiment is high enough, immigrant groups spawn periodically at the entry gate and walk toward vacant plots. Key factors:

| Factor                                 | Effect on Sentiment                                         |
| -------------------------------------- | ----------------------------------------------------------- |
| Wages ≥ Rome standard (30 Dn baseline) | Positive                                                    |
| Wages 2–8 Dn above Rome                | Strongly positive                                           |
| Wages below Rome                       | Negative (emigration risk)                                  |
| Tax rate ≤ 5–6%                        | Mildly positive                                             |
| Tax rate > 10%                         | Negative                                                    |
| Tax rate 20–24%                        | Strongly negative, but achievable late-game with high wages |
| Food available (at least 1 type)       | Required for level 3+ housing, positive signal              |
| Unfilled housing vacancies present     | Prerequisite — immigrants only come when there is space     |
| City health (disease outbreaks)        | Very negative                                               |
| Unemployment > 15%                     | Negative (prosperity falls)                                 |

**Initial population bootstrap:** The first ~100 residents arrive with no sentiment check — they come as soon as housing plots with road access exist. After population exceeds 100, sentiment drives further immigration.

**Sources:** [Altered Gamer immigration guide](https://www.alteredgamer.com/caeser-3/16880-attracting-immigrants-to-your-city/), [GOG emigration glitch thread](https://www.gog.com/forum/caesar_series/the_caesar_3_emigration_glitch_what_it_is_and_how_to_avoid_it), [Archive.org Manual](https://archive.org/stream/Caesar_III_Manual/Caesar_III_Manual_djvu.txt)

### 1.3 The Sentiment Glitch at 200 Population (Very Hard)

A documented quirk: at population 200–299, the game **hard-codes a -10 sentiment penalty** on Very Hard difficulty, regardless of actual city conditions. This creates a loop: pop hits 200 → mass emigration → pop drops below 200 → immigrants return → repeat. At 300+ population, sentiment becomes fully dynamic. This reveals that the game tracks a small-population phase and a large-population phase with different sentiment models. [GOG emigration glitch](https://www.gog.com/forum/caesar_series/the_caesar_3_emigration_glitch_what_it_is_and_how_to_avoid_it)

### 1.4 Emigration

When sentiment falls below a threshold, residents **devolve** their housing (see §2.5) and if there is nowhere to move down to, they leave the city. Emigration walkers visually exit through the Kingdom Road. Triggers:

- Wages fall below Rome standard
- Food supply interrupted (no food in market)
- Taxes extremely high
- Disease epidemic
- Gods angry (fires, floods from divine punishment)
- Housing devolution (residents lose their house, no lower-tier vacancies)

### 1.5 Population Counting

Population = number of people in all occupied housing tiles. Plebeian housing (levels 1–12) holds the **workforce**; patrician housing (levels 13–20) holds the wealthy who pay more taxes but contribute **zero workers** to the labor pool. Population is per-tile: a 4×4 luxury palace holds 200 people but provides 0 workers.

---

## 2. HOUSING EVOLUTION

### 2.1 Physical Sizes

Houses begin as 1×1 tiles and can merge into 2×2, 3×3, and 4×4 structures as they evolve. Merging happens automatically when adjacent 1×1 plots of the same type are eligible for the same upgrade simultaneously.

| Size   | Tile footprint | Housing levels |
| ------ | -------------- | -------------- |
| Small  | 1×1            | Levels 1–10    |
| Medium | 2×2            | Levels 11–16   |
| Large  | 3×3            | Levels 15–18   |
| Grand  | 4×4            | Levels 19–20   |

### 2.2 The Complete Housing Ladder

All requirements are **cumulative** — a higher level requires everything from all lower levels plus its own additions. Population figures are for a single housing unit.

#### Plebeian Housing (Levels 1–12) — Workers and taxpayers

| Level | Name           | Size | Pop | Key Added Requirements                          |
| ----- | -------------- | ---- | --- | ----------------------------------------------- |
| 1     | Small Tent     | 1×1  | 5   | Road access only                                |
| 2     | Large Tent     | 1×1  | 7   | Water: well OR fountain                         |
| 3     | Small Shack    | 1×1  | 9   | 1 food type (from market)                       |
| 4     | Large Shack    | 1×1  | 11  | 1 temple (any god)                              |
| 5     | Small Hovel    | 1×1  | 13  | Fountain water (not just well)                  |
| 6     | Large Hovel    | 1×1  | 15  | 10 entertainment points                         |
| 7     | Small Casa     | 1×1  | 17  | 1 education (school OR library walker)          |
| 8     | Large Casa     | 1×1  | 19  | Bathhouse access + pottery (from market)        |
| 9     | Small Insulae  | 1×1  | 19  | 25 entertainment points                         |
| 10    | Medium Insulae | 1×1  | 20  | Doctor OR hospital + furniture (from market)    |
| 11    | Large Insulae  | 2×2  | 84  | School AND library + barber + oil (from market) |
| 12    | Grand Insulae  | 2×2  | 84  | 35 entertainment + 2 food types                 |

#### Patrician Housing (Levels 13–20) — Tax revenue only, no workers

| Level | Name          | Size | Pop | Key Added Requirements                                               |
| ----- | ------------- | ---- | --- | -------------------------------------------------------------------- |
| 13    | Small Villa   | 2×2  | 40  | 2 temples + 1 type of wine (local OR imported)                       |
| 14    | Medium Villa  | 2×2  | 42  | 40 entertainment + doctor AND hospital                               |
| 15    | Large Villa   | 3×3  | 90  | 45 entertainment + academy (3 education: school + library + academy) |
| 16    | Grand Villa   | 3×3  | 100 | 50 entertainment + 3 temples + 3 food types                          |
| 17    | Small Palace  | 3×3  | 106 | 55 entertainment + 2 wine types (local AND imported)                 |
| 18    | Medium Palace | 3×3  | 112 | 60 entertainment + 4 temples                                         |
| 19    | Large Palace  | 4×4  | 190 | 70 entertainment                                                     |
| 20    | Luxury Palace | 4×4  | 200 | 80 entertainment + hippodrome                                        |

**Note on entertainment points:** Theater = 10 pts; Amphitheater = 10 pts (one show) or 15 pts (two shows); Colosseum = 15 pts (one show) or 25 pts (two shows); Hippodrome = 30 pts. Entertainment is scored by coverage walkers (actors, gladiators, lion tamers, chariot racers) passing the house.

**Sources:** [Caesar III Augustus housing levels](https://mmxl.wz.cz/c3a/housing.html), [Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2803261871), [Teoalida](https://www.teoalida.com/games/caesar3/), [HeavenGames forum](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=7447)

### 2.3 Goods Required at Housing Levels

Goods arrive via market walkers. The market buyer fetches goods when nearby houses need them.

| Good                               | Source                                   | Required from level       |
| ---------------------------------- | ---------------------------------------- | ------------------------- |
| Pottery                            | Pottery workshop (clay → pottery)        | Level 8 (Large Casa)      |
| Furniture                          | Furniture workshop (timber → furniture)  | Level 10 (Medium Insulae) |
| Oil                                | Oil workshop (olives → oil)              | Level 11 (Large Insulae)  |
| Wine (local OR imported)           | Wine workshop (vines → wine) OR imported | Level 13 (Small Villa)    |
| Wine (local AND imported, 2 types) | Both local production + import trade     | Level 17 (Small Palace)   |

### 2.4 Desirability

All houses need positive **desirability** to evolve. Desirability is a tile-based score summing contributions from nearby buildings and terrain:

- Gardens: +2 per tile in range
- Plazas: +2 per tile
- Statues (small/medium/large): +4/+8/+12
- Temples/Oracle: moderate positive
- Industrial buildings (farms, workshops, mines): negative
- Higher elevation: inherent bonus
- Reservoirs: strong negative (hulking structures)
- Aqueducts: mild negative

### 2.5 Devolution

If any requirement is removed (e.g., market stops delivering pottery, walker coverage lapses), the house **devolves** one level per game cycle. Residents become homeless — they wander until they find a lower-tier empty plot. If none exists, they emigrate. This means service interruptions cause immediate visible population displacement, not just a slow decline.

---

## 3. LABOR & EMPLOYMENT

### 3.1 The Labor Pool Model

Caesar III uses a **city-wide labor pool** rather than workers commuting from specific houses to specific jobs. The total available workforce is approximately **2/3 of the plebeian population aged 22–50**. When a building needs workers, it draws from this pool. Patrician residents (villa/palace) contribute zero workers.

Key implications:

- You cannot have too many jobs — any excess labor becomes unemployment
- The labor pool shrinks if plebeian housing is lost (villa conversion)
- Wages affect the whole city, not per-building

### 3.2 Labor Seeker Walkers

The **labor seeker** is a plain-brown-clothed citizen emitted by buildings that employ workers. The labor seeker's job is NOT to fetch individual workers — it is to **establish that a building has road access to housing** (a "labor access" flag). Once the flag is set, the building draws from the city-wide pool automatically.

Rules:

- A labor seeker gets access if it passes within **2 tiles** of housing
- If only 1 tile away, partial access (less labor drawn)
- The labor seeker and the service walker from the same building **always take the same exit road** when there are multiple options
- Buildings (especially workshops and farms) **re-spawn a labor seeker** periodically because they have no dedicated random walker

### 3.3 Building Staffing and Output

| Condition         | Production                                                 |
| ----------------- | ---------------------------------------------------------- |
| Full labor (100%) | Normal production rate                                     |
| 50–99% staffed    | Proportionally reduced output                              |
| Below 50% staffed | Building stops accepting new deliveries / halts production |
| 0% staffed        | Building stops entirely                                    |

### 3.4 Labor Priority (8 Sectors)

The player-controlled Labor Advisor lets you set allocation priority across 8 sectors. Excess labor goes to lower-priority sectors first. Typical priority order:

1. Fire Prevention (prefects)
2. Water Services
3. Engineering (engineer posts)
4. Food Production
5. Military
6. Industry and Commerce
7. Governance / Religion
8. Health / Education

Workers retire at age 50 and stop contributing to the pool. The game tracks individual citizen ages.

**Unemployment targets:**

- > 15% unemployment: Prosperity rating falls
- < 5% unemployment: Prosperity rating rises
- Optimal: 5–10%

**Wages:**

- Rome baseline: 30 denarii/month (implied; wages are described as monthly units)
- Recommended minimum: Rome +2 Dn
- Recommended target: Rome +8 Dn (maximizes morale; no benefit beyond +8)
- Effect: wages affect sentiment/morale, not direct employment allocation
- High wages allow higher tax rates (20–24% sustainable at Rome +8 Dn wages)

**Sources:** [HeavenGames walker questions](https://caesar3.heavengames.com/cgi-bin/forums/display.cgi?action=ct&f=2,6191,1350,all), [HeavenGames labor explanation](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=6156), [wages forum](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=5959), [Hacker News summary](https://news.ycombinator.com/item?id=33845676)

### 3.5 Walker Taxonomy

Walkers are the core service-delivery mechanism. Every service is delivered by a walker physically walking road tiles to housing. If the walker does not pass a house, that house does not receive the service.

| Walker type            | Origin building                 | Purpose                                   | Approx range                  |
| ---------------------- | ------------------------------- | ----------------------------------------- | ----------------------------- |
| Immigrant              | Entry gate                      | Fills vacant housing                      | Full map                      |
| Emigrant               | Housing                         | Leaves when sentiment bad                 | Full map                      |
| Labor seeker           | Any employer                    | Establishes labor access                  | 26–52 tiles (4 walk patterns) |
| Cart pusher            | Farm/workshop/quarry            | Delivers goods to granary/warehouse       | Medium                        |
| Market buyer           | Market                          | Fetches food/goods from granary/warehouse | Crow-flies distance           |
| Market trader (seller) | Market                          | Delivers goods to housing                 | Patrol: ~26–39 tiles          |
| Prefect                | Prefecture                      | Fire suppression + crime deterrence       | 48–52 tiles                   |
| Engineer               | Engineer's Post                 | Building repair                           | 48–52 tiles                   |
| Tax collector          | Forum                           | Collects taxes from housing               | 40–44 tiles                   |
| Priest                 | Temple                          | Religion access                           | 26–39 tiles                   |
| Actor                  | Actor Colony → Theater          | Entertainment (+10 pts)                   | ~26–39 tiles                  |
| Gladiator              | Gladiator School → Amphitheater | Entertainment                             | ~26–39 tiles                  |
| Doctor                 | Doctor's Clinic                 | Health access                             | ~26–39 tiles                  |
| Barber                 | Barber                          | Barber access                             | ~26–39 tiles                  |
| Bath worker            | Bathhouse                       | Bath access                               | ~26–39 tiles                  |
| School child           | School                          | Education walker                          | ~20 tiles                     |
| Librarian              | Library                         | Education walker                          | ~26–39 tiles                  |

**Walker pattern:** Each walker cycles through 4 walk patterns (3 short, 1 long). Short walk limit = 26 tiles for most walkers. Long walk can reach 39–52 tiles depending on type. This means if a road loop is too large, the walker turns back before covering the full loop.

**Road rule — "same exit":** When a building abuts two road segments, the labor seeker and service walker both use the same one (whichever the engine selects first clockwise from the building's north corner). Adding a new road connection can break coverage by diverting walkers onto the wrong branch.

**Source:** [Walker ranges forum](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=1336), [Walker questions (extended)](https://caesar3.heavengames.com/cgi-bin/forums/display.cgi?action=ct&f=2,6191,1350,all)

---

## 4. RESOURCE & PRODUCTION CHAINS

### 4.1 Production Rates (Annual Cartloads)

The game's internal unit is **cartloads**. A cartload ≈ 100 units of goods.

| Building type                                          | Cartloads/year | Notes                             |
| ------------------------------------------------------ | -------------- | --------------------------------- |
| Wheat farm (central/southern)                          | 19.2           | Feeds ~320 people                 |
| Wheat farm (northern)                                  | 9.6            | Feeds ~160 people                 |
| All other farms (fruit, veg, pig, olive, vine)         | 9.6            | Each feeds ~160 people            |
| Timber yard                                            | 9.6            | —                                 |
| Clay pit                                               | 9.6            | —                                 |
| Iron mine                                              | 9.6            | —                                 |
| Marble quarry                                          | 4.8            | Exception: same rate as workshops |
| All workshops (pottery, furniture, oil, wine, weapons) | 4.8            | —                                 |

**Key ratio:** 1 raw material producer (9.6/yr) supports exactly **2 workshops** (2 × 4.8 = 9.6). Raw material is the bottleneck; never build more than 2 workshops per raw source.

**Source:** [HeavenGames production rates forum](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=7508), [production rates wine/pottery etc.](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=6509)

### 4.2 Household Consumption Rates

| Good                  | Consumption per house/year (cartloads) | Notes                             |
| --------------------- | -------------------------------------- | --------------------------------- |
| Food (any type)       | 0.24                                   | Per household; market distributes |
| Pottery               | 0.24                                   | Per household                     |
| Furniture             | 0.24                                   | Per household                     |
| Oil                   | 0.24                                   | Per household                     |
| Wine (standard house) | 0.24                                   | Per household                     |
| Wine (palace-level)   | 0.48                                   | Double rate for palaces           |

**Supply math:** 1 workshop produces 4.8 cartloads/year ÷ 0.24 consumption = **enough for 20 standard houses** per workshop. For palaces on wine: 4.8 ÷ 0.48 = enough for only **10 palaces** per wine workshop.

### 4.3 Complete Production Chains

```
RAW MATERIAL          WORKSHOP          FINISHED GOOD      HOUSING NEED
─────────────         ─────────         ─────────────      ────────────
Clay Pit  ──────────→ Pottery Shop  ──→ Pottery         (Level 8+)
Timber Yard ─────────→ Furniture Shop ─→ Furniture      (Level 10+)
Olive Farm ──────────→ Oil Workshop ──→ Oil             (Level 11+)
Vine Farm ───────────→ Wine Workshop ─→ Wine            (Level 13+)
Iron Mine ───────────→ Weapons Shop ──→ Weapons         (Military/Export)

FOOD CHAINS (no workshop, direct to granary):
Wheat Farm ──────────────────────────→ Wheat (food)    (Level 3+)
Vegetable Farm ──────────────────────→ Vegetables      (food variety)
Fruit Farm ──────────────────────────→ Fruit           (food variety)
Pig Farm ────────────────────────────→ Meat            (food variety)
Fishing Wharf (on water) ───────────→ Fish             (food variety)

CONSTRUCTION MATERIALS:
Marble Quarry ───────────────────────→ Marble          (temples, oracles)
                                                        (Each large temple = 2 tons)
Timber Yard  ────────────────────────→ Timber          (shipyard boats: 3 cart timber each)
```

### 4.4 Distribution Chain

1. **Farms/workshops → Cart pusher walker → Granary (food) or Warehouse (goods)**
2. **Market buyer walker** goes from market to granary/warehouse using "crow-flies" distance (ignores road topology)
3. **Market trader walker** patrols road from market, delivering food+goods to all housing within walker range
4. **Housing** receives service when market trader passes within 2 tiles of road

**Granary rules:**

- Holds 3,200 food units (32 cartloads)
- Granary at below 50% capacity: warehouses auto-transfer food to it
- Food goes ONLY to granaries (farms cannot deliver to warehouses directly for housing consumption)
- Granary needs 6 workers

**Warehouse rules:**

- Holds 32 goods units (approximately 3,200 units of manufactured goods)
- Stores all non-food goods + raw materials + food overflow
- First warehouse = trade center (imports arrive here first)
- Needs 6 workers

**Market rules:**

- 5 workers
- Market buyer (roaming): fetches from nearest granary/warehouse by straight-line distance
- Market trader (service walker): covers ~26–39 tile radius on road

### 4.5 Trade (Imports/Exports)

Trade is conducted via **Docks** (sea, ships hold 12 cartloads) and **Trade Missions** (land, caravans hold 8 cartloads). Routes must be opened on the Empire Map (cost varies per route).

| Commodity                     | Notes on value                                 |
| ----------------------------- | ---------------------------------------------- |
| Iron (raw)                    | Sells for ~600 Dn                              |
| Weapons (finished)            | Sells for up to 4,000 Dn                       |
| Marble                        | Most expensive raw export (no workshop needed) |
| Pottery, Furniture, Oil, Wine | Profitable finished goods                      |
| Wheat, Food                   | Lower value, primarily for city use            |

Trade supply levels (per route):

- 1 basket = ~15 cartloads/year
- 2 baskets = ~25 cartloads/year
- 3 baskets = ~40 cartloads/year

Exports can substitute for local production of goods (e.g., import wine instead of building vine farms + workshop). You **cannot simultaneously import and export the same commodity**.

---

## 5. CONSTRUCTION & ECONOMY

### 5.1 Complete Building Costs (Denarii)

From the Caesar III Augustus Ultimate Handbook building summary ([source](https://www.caesar3augustus.com/book/appendix/buildingsummary)):

#### Infrastructure

| Building               | Cost (Dn) | Workers |
| ---------------------- | --------- | ------- |
| Road (per tile)        | ~12       | 0       |
| Aqueduct (per segment) | 8         | 0       |
| Reservoir              | 80        | 0       |
| Fountain               | 15        | 4       |
| Well                   | 5         | 0       |
| Garden                 | 12        | 0       |
| Plaza                  | 15        | 0       |
| Bridge (Low)           | 40        | 0       |
| Bridge (Ship)          | 100       | 0       |
| Wall (per segment)     | 12        | 0       |
| Gatehouse              | 100       | 3       |
| Tower                  | 150       | 6       |

#### Industrial

| Building            | Cost (Dn) | Workers |
| ------------------- | --------- | ------- |
| Farm (all types)    | 40        | 10      |
| Clay Pit            | 40        | 10      |
| Timber Yard         | 40        | 10      |
| Iron Mine           | 50        | 10      |
| Marble Quarry       | 50        | 10      |
| Workshop, Pottery   | 40        | 10      |
| Workshop, Furniture | 40        | 10      |
| Workshop, Oil       | 50        | 10      |
| Workshop, Wine      | 45        | 10      |
| Workshop, Weapons   | 50        | 10      |
| Granary             | 100       | 6       |
| Warehouse           | 70        | 6       |
| Market              | 40        | 5       |
| Dock                | 100       | 12      |
| Wharf               | 60        | 6       |
| Shipyard            | 100       | 10      |

#### Services

| Building          | Cost (Dn) | Workers |
| ----------------- | --------- | ------- |
| Prefecture        | 30        | 6       |
| Engineer's Post   | 30        | 5       |
| Doctor's Clinic   | 30        | 5       |
| Barber            | 25        | 2       |
| Bathhouse         | 50        | 10      |
| Hospital          | 300       | 30      |
| School            | 50        | 10      |
| Library           | 75        | 20      |
| Academy           | 100       | 30      |
| Forum             | 75        | 6       |
| Senate            | 400       | 30      |
| Temple (Small)    | 50        | 2       |
| Temple (Large)    | 150       | 5       |
| Oracle            | 200       | 0       |
| Theater           | 50        | 8       |
| Actor Colony      | 50        | 5       |
| Amphitheatre      | 100       | 12      |
| Gladiator School  | 75        | 8       |
| Colosseum         | 500       | 25      |
| Lion Pit House    | 75        | 8       |
| Hippodrome        | 2,500     | 150     |
| Barracks          | 150       | 10      |
| Fort              | 250       | 16      |
| Military Academy  | 100       | 30      |
| Governor's House  | 150       | 0       |
| Governor's Villa  | 400       | 0       |
| Governor's Palace | 700       | 0       |
| Mission Post      | 100       | 20      |
| Small Statue      | 12        | 0       |
| Medium Statue     | 60        | 0       |
| Large Statue      | 150       | 0       |
| Chariot Maker     | 75        | 10      |

### 5.2 Do Buildings Require Materials to Construct?

**No** — in vanilla Caesar III, all buildings are built with **denarii only**. No materials (timber, marble, clay) are consumed during construction, except:

- Marble is required for oracles and large temples (2 tons per large temple, delivered to the construction site)
- Ships require timber (3 cartloads per ship) via shipyard

This is a noted simplification versus historical realism and vs. Caesar IV, which did introduce material costs.

### 5.3 Wages, Taxes, Treasury

**Wages:**

- Paid from treasury monthly
- All employed workers paid the city wage rate
- Rome baseline wage: ~30 Dn/month per worker-equivalent
- Player sets one city-wide wage (not per-building)
- Wages are NOT in full denarii; internally tracked as 1/10 denarii (sestertii equivalent), player only pays 10% of total calculated wages

**Taxes:**

- Forum sends tax collector walkers who collect from all housing within range
- Rate set by player (0–25%)
- Plebeian housing: small tax revenue per house
- Patrician housing: very large tax revenue (multiplier 4–16× compared to tents)
- Suggested sustainable rate: 7–20% depending on city development

**Treasury:**

- Single city treasury (denarii)
- Income: taxes collected by forum, trade export revenue
- Expenditure: construction costs (one-time), wages (ongoing), trade import costs
- No debt mechanism in base game — if treasury goes to 0, buildings stop functioning
- Annual tribute to Caesar required

**City ratings (affect ability to progress):**

- **Prosperity** — rises if city earns more than it spends, low unemployment, good wages, evolving housing
- **Culture** — temples, schools, libraries, academies, entertainment per capita
- **Peace** — absence of crime, riots
- **Favor** — Caesar's approval; falls if mission objectives unmet; triggers dismissal below 10

---

## 6. CITY LAYOUT

### 6.1 Roads as Service Conduit

In Caesar III, **roads are the arterial system for all services**. Nothing works without roads because all service is delivered by walkers walking road tiles. Core rules:

1. Every building must be within **2 tiles of a road** to have labor access, receive service, or deliver goods
2. Walker turns at intersections are unpredictable — they pick a direction and may fail to cover all branches
3. Intersections break walker patterns — a walker on a looped road will always follow the loop correctly; an intersection gives the walker a choice and it will only take one branch

### 6.2 The Closed-Loop Block Design

The canonical Caesar III city design is the **closed-loop housing block**: a loop of road with housing on the inside and service buildings arranged around it. This ensures walkers circulate continuously without the split-coverage problem.

**Safe loop sizes** ([Pinouchon block design analysis](http://pinouchon.github.io/caesar3/2016/08/25/caesar3-palace-block-design.html)):

- ≤ 54 tiles circumference: safe
- 54–60 tiles: risky
- > 60 tiles: walker problems appear consistently

Housing blocks are connected to the rest of the city via **gatehouses** — random walkers do not pass through gatehouses, so placing a gatehouse between the residential loop and the industrial zone prevents service walkers from drifting into the wrong area. This is intentional design.

**Practical block sizes:**

- Standard 9×9 housing block (inner 7×7 tiles + road perimeter) = 32-tile perimeter loop
- A single fountain at center covers 9×9 in temperate/central maps (fountain radius = 4 tiles)
- Desert fountain radius = 3 tiles (7×7 block only)

### 6.3 Water Infrastructure

**System: River → Reservoir → Aqueduct → Secondary Reservoir → Fountain/Bathhouse → Housing**

| Component           | Cost  | Coverage                                 | Notes                                                              |
| ------------------- | ----- | ---------------------------------------- | ------------------------------------------------------------------ |
| Well                | 5 Dn  | 3-tile radius                            | Basic water, allows Level 2 only                                   |
| Fountain            | 15 Dn | 4-tile radius (central), 3-tile (desert) | Enables Level 5+; requires pipe from reservoir                     |
| Reservoir           | 80 Dn | 24×24 pipe grid                          | Must be adjacent to water source; needs labor                      |
| Aqueduct (per tile) | 8 Dn  | —                                        | Connects reservoirs; cannot cross each other; roads can pass under |
| Bathhouse           | 50 Dn | Walker coverage                          | Needs underground pipe connection from reservoir; enables Level 8  |

**Key rules:**

- Reservoirs require **labor to operate** but aqueducts do not
- Aqueducts follow terrain (gravity-fed), can twist/turn, cannot intersect each other
- Fountains only supply water when connected via pipe to a reservoir
- Bath-houses also need reservoir pipe connection (separate from fountain requirement)
- Housing needs **both** fountain AND bathhouse for higher-level evolution (different services)
- Wells provide water access for Level 2 only; fountains needed from Level 5

**Sources:** [Caesar3 Augustus water guide](https://www.caesar3augustus.com/book/water/reservoiraqueduct), [Altered Gamer city guide](https://www.alteredgamer.com/caeser-3/16052-city-building-guide-the-basics-of-building-a-city/)

### 6.4 Industrial Zone Separation

Best practice: keep industrial buildings (farms, mines, workshops) **separate from residential zones**, connected via a non-gatehouse road. Industrial buildings reduce desirability for nearby housing, preventing evolution. The industrial zone has its own road network feeding into granaries/warehouses, which are then accessible to market buyers from the residential zone.

---

## SYNTHESIS: Adapting Caesar III → CityLife

_CityLife context:_ Floating-island colony sim. AI "Hermes" citizens propose mechanics, a dev routine implements them. Current state: terrain/biomes, road grid with block frames, autoGrow buildings (habitat/commercial/industrial/solar) that pop up on an 8-game-hour timer gated only by treasury. Settlers have bank accounts; city-plan of named plots/zones. Key problem: buildings spawn with no labour or material cost — the timer mechanism is purely treasury-gated and must be replaced with a real economy.\*

---

### Caesar III Lessons Most Applicable to CityLife

1. **The walker/coverage model** is the whole game. Every service = a person walking. This is brilliant for an island sim — settlers visibly move between buildings.
2. **The 1 raw → 2 workshops ratio** is clean and teachable. Copy it exactly.
3. **Housing evolution as a progression gate** is the reward loop. Each new tier requires new infrastructure, which requires new industry.
4. **Sentiment/immigration as the population growth engine** means the player builds services to attract people, not just spend money.
5. **Closed-loop blocks with gatehouse isolation** translate perfectly to CityLife's "block frame" road system.

---

### Proposed First Mechanics in Dependency Order

The following mechanics are ordered so each mechanic's prerequisites are already implemented before it is added. Each entry includes: the rule, key numbers, material/labour costs, and dependencies.

---

#### MECHANIC 1: Raw Material Extraction Buildings

**Rule:** An Extraction Site (mine, timber yard, solar-ore collector) is a building tile that, when staffed, produces raw material at a fixed rate and delivers it to a Depot (warehouse) via a cart-walker. No extraction = no downstream production.

**Data/Numbers (adapted from Caesar III):**

- Ore Mine: produces 9.6 cartloads/year (8 per month) — equivalent to 1 cart/~3.75 game-hours
- Timber Yard: produces 9.6 cartloads/year
- Solar-crystal harvester (CityLife original): 4.8 cartloads/year (rarer, high-value)
- All extractors: 10 settler-workers required to operate at full rate
- Partial staffing (1–9 workers): output scaled linearly (e.g., 5 workers = 50% rate)
- Zero workers: building idle, no output

**Material/Labour Costs to BUILD:**

- Ore Mine: 50 Dn + 20 timber units (floats need anchoring)
- Timber Yard: 40 Dn + 10 stone units
- Solar-crystal harvester: 80 Dn + 30 ore units

**Dependencies:** None — this is the foundation. Requires: road grid (already exists), treasury system (already exists), Depot/storage building (build alongside).

---

#### MECHANIC 2: Materials Economy — All Construction Consumes Materials

**Rule:** Replace the treasury-only timer pop-up with a dual requirement: (a) treasury payment AND (b) materials consumed from Depot inventory. Building cannot begin if Depot does not have sufficient materials. Construction takes real time (a "construction walker" or build-timer) proportional to material cost.

**Data/Numbers:**
| Building tier | Dn cost | Timber | Ore | Stone |
|---|---|---|---|---|
| Road (per tile) | 5 Dn | 0 | 0 | 2 stone |
| Habitat (small, 1×1) | 30 Dn | 5 timber | 2 ore | 0 |
| Habitat (medium, 2×2) | 80 Dn | 15 timber | 5 ore | 0 |
| Industrial building | 40–50 Dn | 10 timber | 5 ore | 0 |
| Solar field (1×1) | 60 Dn | 0 | 10 ore | 5 stone |
| Depot/Warehouse | 70 Dn | 10 timber | 5 ore | 5 stone |
| Commercial zone | 50 Dn | 8 timber | 3 ore | 0 |

_(Numbers are CityLife design proposals calibrated to Caesar III's cost ratios — adjust via playtesting.)_

**Construction time:** 1 game-hour per 10 Dn of cost (a 50 Dn building takes 5 game-hours to construct once materials are reserved).

**Labour to BUILD:** Each construction project requires a "builder" settler present at the site during construction. A settler assigned to construction cannot simultaneously fill another job.

**Dependencies:** Mechanic 1 (raw material must exist before it can be consumed). Requires: Depot building, inventory tracking system.

---

#### MECHANIC 3: Workshop Production Chain

**Rule:** A Workshop takes raw material from Depot (input) and converts it to finished goods (output) at half the raw material rate, delivering finished goods to a second Depot slot. Workshop must be staffed. Market/commercial buildings distribute finished goods to habitats.

**Data/Numbers (Caesar III ratios):**
| Workshop | Input | Input cartloads/yr consumed | Output good | Output cartloads/yr |
|---|---|---|---|---|
| Smelter | Ore | 9.6 | Metal bars | 4.8 |
| Sawmill | Timber (raw logs) | 9.6 | Planks | 4.8 |
| Energy Fab | Solar crystals | 4.8 | Power cells | 2.4 |
| (future) Fabricator | Metal bars | 4.8 | Components | 4.8 |

**Staffing:** 10 settlers per workshop.
**Ratio rule:** 1 extraction site → 2 workshops of the matching type.
**Build cost:** 40–50 Dn + 10 timber + 5 ore.

**Dependencies:** Mechanic 1 (raw materials), Mechanic 2 (construction material cost). Requires: Depot inventory system, cart-walker/delivery system.

---

#### MECHANIC 4: Habitat Evolution Gated by Materials + Services

**Rule:** Replace the 8-hour-timer autoGrow with a Caesar III–style requirement ladder. A habitat tile upgrades one level only when ALL requirements are simultaneously met. If any requirement is lost, it devolves one level.

**Proposed CityLife housing ladder** (inspired by Caesar III, adapted for colony theme):

| Level | Name              | Settlers | Requirements                              |
| ----- | ----------------- | -------- | ----------------------------------------- |
| 1     | Settler Tent      | 5        | Road access                               |
| 2     | Basic Bunk        | 8        | Power (solar cell delivery)               |
| 3     | Hab Unit          | 12       | Food supply (from food depot)             |
| 4     | Family Quarters   | 18       | Water recycling (utility coverage)        |
| 5     | Crew Block        | 24       | Metal goods (planks/bars from commercial) |
| 6     | Residential Block | 35       | Entertainment (comm hub walker)           |
| 7     | Colony Flat       | 50       | Education (school walker coverage)        |
| 8     | Comfort Flat      | 65       | Health (medic walker) + power cells       |
| 9     | High-Rise         | 100      | Two food types + components               |
| 10    | Sky Villa         | 150      | Academy + 3 entertainment types           |

**Numbers:**

- Each habitat tier unlocks tax revenue increase (×1.5 per tier)
- High-Rise+ are "patrician equivalent": 0 workers but high tax (island elite)
- Housing consumption: 0.24 cartloads/year per good per habitat (exact Caesar III rate)

**Dependencies:** Mechanics 1–3 (goods must exist to be consumed). Requires: walker/coverage system for services, market/commercial distribution building.

---

#### MECHANIC 5: Settler Immigration Tied to Vacancy + Jobs + Services

**Rule:** Settlers arrive at the island's **entry point** (dock or landing pad) at a rate proportional to city sentiment. Sentiment is computed each game-day from: (vacant habitats exist) AND (jobs available) AND (wages ≥ off-island standard) AND (food available). Settler groups walk from entry to the nearest vacant habitat.

**Data/Numbers:**

- Base sentiment range: 0–100
- Sentiment = 50 (neutral) → small trickle of settlers (5–10/month)
- Sentiment > 70 → good immigration (20–30/month)
- Sentiment > 85 → boom (50+/month)
- Sentiment < 30 → emigration begins
- Sentiment < 10 → mass exodus
- Bootstrap rule (Caesar III lesson): first 50 settlers arrive with no sentiment check
- Emigration: settlers who cannot find housing OR whose habitat devolves AND no lower vacancy exists → walk to entry point and leave

**Sentiment factors:**
| Factor | Sentiment delta |
|---|---|
| Vacancies exist | +10 (prerequisite signal) |
| Job vacancy exists | +5 |
| Wages ≥ off-island rate | +10 |
| Wages +3 Dn above off-island | +5 |
| Food available | +10 |
| Two food types | +5 |
| Unemployment > 15% | -15 |
| Power outage in habitats | -10 |
| Disease event | -20 |
| No entertainment | -5 |

**Dependencies:** Mechanics 2 and 4 (habitats must have real requirements before immigration matters). Requires: entry-point building, sentiment system, settler agent model.

---

### Additional Recommended Mechanics (Post-Core)

**MECHANIC 6: Labour Pool and Staffing Walker**
Implement the Caesar III labor seeker pattern: each employer building emits a staffing walker periodically. When it passes within 2 road-tiles of a habitat, that building gets labor access and draws from the city-wide settler pool. Without labor access, production halts. This fixes the CityLife "no labour" problem at its root.

**MECHANIC 7: Road Material Cost and Grid Efficiency**
Roads cost stone per tile. Closed-loop blocks (≤ 54-tile perimeter) are explicitly rewarded by the service walker coverage model — longer routes don't cover the whole loop. Road construction requires a builder settler during placement.

**MECHANIC 8: Desirability Zones**
Industrial buildings (mines, smelters) emit a negative desirability radius (e.g., -5 per tile within 3 tiles). Habitats within this radius cannot evolve past level 5. Parks, plazas, decorations add +2–+8. This enforces zone separation (industrial vs. residential) without hard zoning rules.

**MECHANIC 9: Taxes and Treasury Balance**
Habitats pay tax proportional to level (Level 1 = 1 Dn/month; Level 10 = 25 Dn/month). Tax collector walker from Forum building collects from habitats in range. Treasury funds wages (ongoing) and construction (one-time). Wages paid monthly to each employed settler from pool.

---

### Dependency Graph Summary

```
MECHANIC 1: Extraction (Mine/Timber)
    ↓
MECHANIC 2: Material construction costs
    ↓
MECHANIC 3: Workshop chains (ore→metal, timber→planks)
    ↓
MECHANIC 4: Habitat evolution gated by goods+services
    ↓
MECHANIC 5: Immigration/emigration tied to vacancy+jobs+services
    ↓
MECHANIC 6: Labour pool + staffing walker
    ↓
MECHANIC 7: Road material cost
    ↓
MECHANIC 8: Desirability zones
    ↓
MECHANIC 9: Taxes and treasury balance (wraps the loop)
```

Mechanics 1–5 form the minimum viable economy loop: **extract → produce → distribute → house → attract settlers**. This loop should be playable and enjoyable before adding desirability or taxes.

---

## Key Sources

- [Housing (Caesar 3) — Impressions Games Wiki](<https://impressionsgames.fandom.com/wiki/Housing_(Caesar_3)>)
- [Caesar III Augustus Ultimate Handbook — Building Summary](https://www.caesar3augustus.com/book/appendix/buildingsummary)
- [Caesar III Augustus — Housing Levels](https://mmxl.wz.cz/c3a/housing.html)
- [Caesar III Augustus — Water: Reservoir & Aqueduct](https://www.caesar3augustus.com/book/water/reservoiraqueduct)
- [Caesar III Augustus — Storage & Distribution](https://www.caesar3augustus.com/book/farmingindustry/storagedistribution)
- [Caesar III Augustus — Trade](https://caesar3augustus.com/book/trade/start)
- [HeavenGames — Industrial Buildings](https://caesar3.heavengames.com/buildings/industry/)
- [HeavenGames — Production Rates](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=7508)
- [HeavenGames — Walker Ranges](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=1336)
- [HeavenGames — Walker Questions (extended)](https://caesar3.heavengames.com/cgi-bin/forums/display.cgi?action=ct&f=2,6191,1350,all)
- [HeavenGames — Labor Explanation](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=6156)
- [HeavenGames — Wages & Employment](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=5959)
- [HeavenGames — Raw material/workshop production](https://caesar3.heavengames.com/cgi-bin/caeforumscgi/display.cgi?action=st&fn=2&tn=5844)
- [GOG Forum — Emigration Glitch](https://www.gog.com/forum/caesar_series/the_caesar_3_emigration_glitch_what_it_is_and_how_to_avoid_it)
- [Altered Gamer — Attracting Immigrants](https://www.alteredgamer.com/caeser-3/16880-attracting-immigrants-to-your-city/)
- [Caesar III Manual — Archive.org](https://archive.org/stream/Caesar_III_Manual/Caesar_III_Manual_djvu.txt)
- [Teoalida — Caesar 3 Analysis](https://www.teoalida.com/games/caesar3/)
- [Steam Guide — Caesar 3 Basics](https://steamcommunity.com/sharedfiles/filedetails/?id=2803261871)
- [Pinouchon — Closed-loop block design](http://pinouchon.github.io/caesar3/2016/08/25/caesar3-palace-block-design.html)
- [Julius open-source remake wiki](https://github.com/bvschaik/julius/wiki/Improvements-from-Caesar-3)
- [Hacker News — Caesar III labor discussion](https://news.ycombinator.com/item?id=33845676)
