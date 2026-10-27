#!/usr/bin/env python3
"""Build an enriched, non-destructive FitnessProgramer exercise work catalogue.

Input:  assets/exercises/<category>/<exercise>.json
Output: assets/work/<category>/<exercise>.json
Only name_ru and tracking_type are introduced; source files remain untouched.

Reference: ru-names-reference.json, extracted from the user-supplied Mezfit v2.0.0
catalogue. Exact and unambiguous equipment-qualified matches have priority.
Ambiguous translations are recorded for editorial review.
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "exercises"
TARGET = ROOT / "assets" / "work"
REFERENCE = Path(__file__).with_name("ru-names-reference.json")
REPORT = Path(__file__).with_name("work-generation-report.json")
VALID_TYPES = {"weight_reps", "time", "time_distance", "time_reps", "time_weight"}

# These overrides are intentional fitness terminology, not literal word substitutions.
MANUAL_RU = {
    "above head chest stretch": "Растяжка грудных мышц с руками над головой",
    "bench press": "Жим штанги лёжа",
    "plank": "Планка на предплечьях",
    "chin tuck": "Втягивание подбородка",
    "arm circles": "Круговые вращения руками",
    "arm scissors": "Скрестные махи руками («ножницы»)",
    "assault airbike": "Интервальная работа на аэробайке",
    "stationary bike": "Велотренажёр",
    "manual treadmill": "Бег на механической беговой дорожке",
    "treadmill": "Бег на беговой дорожке",
    "bike": "Велотренажёр",
    "bird dog": "«Птица-собака» (разноимённые подъёмы рук и ног на четвереньках)",
    "cat cow pose": "«Кошка-корова»",
    "fish pose": "Поза рыбы",
    "bow pose": "Поза лука",
    "sphinx stretch": "Поза сфинкса",
    "bhujangasana cobra abdominal stretch": "Поза кобры (бхуджангасана)",
    "dhanurasana rocking bow pose": "Поза лука с раскачиванием",
    "deadlift": "Становая тяга",
    "squat": "Приседания",
    "burpees": "Бёрпи",
    "burpee with push up": "Бёрпи с отжиманием",
    "burpee long jump": "Бёрпи с прыжком в длину",
    "battle rope": "Волны с тренировочными канатами",
    "hanging knee raises": "Подъём коленей в висе",
    "bird dog exercise": "«Птица-собака»",
    "superman": "«Супермен» лёжа на животе",
    "side plank rotation": "Боковая планка с поворотом корпуса",
    "side plank": "Боковая планка",
    "reverse plank": "Обратная планка",
    "wall sit": "Стульчик у стены",
    "l sit": "Уголок в упоре",
    "l-sit": "Уголок в упоре",
    "farmer's walk": "Прогулка фермера",
    "farmer walk": "Прогулка фермера",
    "jumping jacks": "Прыжки «ноги врозь — ноги вместе»",
    "mountain climber": "Альпинист",
    "mountain climbers": "Альпинист",
    "bicycle crunch": "Скручивания «велосипед»",
    "push up": "Отжимания от пола",
    "pull up": "Подтягивания на перекладине",
    "chin up": "Подтягивания обратным хватом",
    "dip": "Отжимания на брусьях",
    "dips": "Отжимания на брусьях",
    "glute bridge": "Ягодичный мостик",
    "hip thrust": "Ягодичный мостик с опорой на скамью",
    "bodyweight squat": "Приседания с собственным весом",
    "standing calf raise": "Подъём на носки стоя",
    "seated calf raise": "Подъём на носки сидя",
    "seated row": "Горизонтальная тяга сидя",
    "face pull": "Тяга каната к лицу",
    "incline dumbbell reverse fly": "Разведение гантелей в наклоне на скамье",
    "arm leg raises": "Разноимённые подъёмы рук и ног",
    "kneeling hip flexor stretch": "Растяжка сгибателей бедра стоя на колене",
    "90 90 hip stretch": "Растяжка тазобедренных суставов в положении 90/90",
    "foam roller calves": "Миофасциальный релиз икроножных мышц на ролике",
    "behind the neck pull up": "Подтягивания за голову",
    "dead hang": "Вис на перекладине",
    "back lever": "Горизонтальный вис спиной вниз («задний горизонт»)",
    "front lever": "Передний горизонтальный вис",
    "clean and jerk": "Толчок штанги",
    "barbell snatch": "Рывок штанги",
    "barbell hang clean": "Взятие штанги на грудь с виса",
    "kettlebell clean and press": "Взятие гири на грудь и жим",
    "hand gripper": "Сжатие кистевого эспандера",
    "wall slides": "Скольжение руками по стене",
    "side bridge": "Боковая планка",
    "spider plank": "Планка «паук»",
    "plank jack": "Прыжки ногами в планке",
    "side shuttle": "Челночные приставные шаги",
    "goblet squat": "Приседания с гирей у груди",
    "cossack squat": "Приседания «казак»",
    "atg split squat": "Глубокие разножные приседания (ATG)",
    "wall ball": "Броски мяча в стену из приседа",
    "jump rope": "Прыжки через скакалку",
    "jumping rope": "Прыжки через скакалку",
    "running": "Бег",
    "sprint": "Спринт",
    "swimming": "Плавание",
    "rowing machine": "Гребля на тренажёре",
    "rowing": "Гребля",
    "elliptical trainer": "Эллиптический тренажёр",
    "walking": "Ходьба",
    "bear crawl": "Медвежья ходьба",
    "crab walk": "Ходьба «краб»",
    "climbing monkey bars": "Передвижение по рукоходу",
    "reverse crunch": "Обратные скручивания",
    "heel slide": "Скольжение пяткой по полу",
    "hell slide": "Скольжение пяткой по полу",
    "4 point tummy vacuum exercise": "Вакуум живота стоя на четвереньках",
}

EQUIPMENT_FORMS = [
    (r"\bbarbell\b|\bez bar\b|\bez-bar\b", "со штангой"),
    (r"\bdumbbells?\b", "с гантелями"),
    (r"\bkettlebells?\b", "с гирей"),
    (r"\bsmith(?: machine)?\b", "в тренажёре Смита"),
    (r"\bcable\b|\bhigh pulley\b|\blow pulley\b", "на блоке"),
    (r"\b(?:resistance )?bands?\b|\bbanded\b", "с резиновой лентой"),
    (r"\b(?:lever|machine)\b", "в тренажёре"),
    (r"\bmedicine ball\b", "с медицинболом"),
    (r"\bstability ball\b|\bswiss ball\b|\bexercise ball\b", "на фитболе"),
    (r"\bbosu ball\b|\bbosu\b", "на BOSU"),
    (r"\btrx\b|\bsuspension\b", "на подвесных петлях"),
    (r"\bplate\b", "с диском от штанги"),
    (r"\bbench\b", "на скамье"),
    (r"\brope\b", "с канатом"),
    (r"\bbodyweight\b", "с собственным весом"),
    (r"\bweighted\b", "с отягощением"),
]

MOVEMENTS = [
    (r"reverse wrist curl|wrist extension", "Разгибание кистей"),
    (r"wrist curl|wrist flexion", "Сгибание кистей"),
    (r"hammer curl", "Молотковые сгибания рук"),
    (r"preacher curl|scott curl", "Сгибание рук на скамье Скотта"),
    (r"biceps curl|bicep curl|arm curl|concentration curl|reverse curl|\bcurl\b", "Сгибание рук на бицепс"),
    (r"skull crushers?|lying triceps extension", "Французский жим лёжа"),
    (r"triceps pushdown|tricep pushdown|pushdown", "Разгибание рук на верхнем блоке"),
    (r"triceps extension|tricep extension|overhead extension|kickback", "Разгибание рук на трицепс"),
    (r"bench press|floor press", "Жим лёжа"),
    (r"chest press", "Жим от груди"),
    (r"shoulder press|military press|overhead press|arnold press", "Жим над головой"),
    (r"leg press", "Жим ногами"),
    (r"leg extension", "Разгибание ног"),
    (r"leg curl", "Сгибание ног"),
    (r"calf raise|heel raise", "Подъём на носки"),
    (r"tibialis raise|toe raise", "Подъём носков стоп"),
    (r"lateral raise|side raise", "Подъём рук через стороны"),
    (r"front raise", "Подъём рук перед собой"),
    (r"rear delt fly|reverse fly|reverse raise|rear delt raise", "Разведение рук в наклоне"),
    (r"chest fly|pec fly|cable fly|\bfly\b|\bflies\b", "Сведение рук перед грудью"),
    (r"lat pulldown|lateral pulldown|\bpulldown\b", "Тяга верхнего блока"),
    (r"face pull", "Тяга к лицу"),
    (r"upright row", "Тяга к подбородку"),
    (r"seated row|low row|bent over row|bent-over row|\brow\b", "Тяга к поясу"),
    (r"shrugs?|\bshrug\b", "Шраги"),
    (r"pull[\s-]?ups?", "Подтягивания"),
    (r"chin[\s-]?ups?", "Подтягивания обратным хватом"),
    (r"push[\s-]?ups?", "Отжимания"),
    (r"\bdips?\b", "Отжимания на брусьях"),
    (r"hip thrust|glute bridge|\bbridge\b", "Ягодичный мостик"),
    (r"hip abduction", "Отведение бедра"),
    (r"hip adduction", "Приведение бедра"),
    (r"hip extension|kickbacks?|donkey kick", "Разгибание бедра назад"),
    (r"hip flexion", "Сгибание бедра"),
    (r"good morning", "Наклоны со штангой на плечах («гуд морнинг»)"),
    (r"deadlift", "Становая тяга"),
    (r"squat", "Приседания"),
    (r"lunge", "Выпады"),
    (r"step[\s-]?ups?", "Зашагивания на платформу"),
    (r"step[\s-]?downs?", "Спуск с платформы"),
    (r"box jump|broad jump|\bjump\b|\bjumps\b", "Прыжки"),
    (r"crunch", "Скручивания"),
    (r"sit[\s-]?ups?", "Подъём корпуса"),
    (r"leg raise|leg lifts?|knee raise", "Подъём ног"),
    (r"rollout|ab wheel|ab roller", "Выкатывание ролика для пресса"),
    (r"russian twist|torso twist|\btwist\b", "Повороты корпуса"),
    (r"\bplank\b", "Планка"),
    (r"side bend", "Наклоны корпуса в стороны"),
    (r"extension|hyperextension", "Разгибания"),
    (r"rotation|external rotation|internal rotation", "Вращение"),
    (r"stretch", "Растяжка"),
    (r"\bhold\b|\bhang\b", "Удержание положения"),
    (r"\bwalk\b|\bwalking\b", "Ходьба"),
    (r"\brun\b|\brunning\b|\bsprint\b", "Бег"),
    (r"\bbike\b|\bcycling\b", "Велотренажёр"),
    (r"\bpose\b", "Поза"),
]

MODIFIERS = [
    (r"\bseated\b|\bsitting\b", "сидя"),
    (r"\bstanding\b", "стоя"),
    (r"\blying\b|\bsupine\b", "лёжа"),
    (r"\bprone\b", "лёжа на животе"),
    (r"\bkneeling\b", "стоя на коленях"),
    (r"\bincline\b", "на наклонной скамье"),
    (r"\bdecline\b", "на скамье с отрицательным наклоном"),
    (r"\bflat\b", "на горизонтальной скамье"),
    (r"\bclose grip\b|\bnarrow grip\b", "узким хватом"),
    (r"\bwide grip\b", "широким хватом"),
    (r"\breverse grip\b|\bunderhand\b", "обратным хватом"),
    (r"\bneutral grip\b|\bhammer grip\b", "нейтральным хватом"),
    (r"\boverhand\b", "хватом сверху"),
    (r"\bone arm\b|\bsingle arm\b|\b1 arm\b|\bunilateral\b", "одной рукой"),
    (r"\bone leg\b|\bsingle leg\b|\b1 leg\b", "на одной ноге"),
    (r"\balternating\b|\balternate\b", "попеременно"),
    (r"\bbehind (?:the )?back\b", "за спиной"),
    (r"\bbehind (?:the )?neck\b", "за голову"),
    (r"\boverhead\b", "над головой"),
    (r"\bwith partner\b|\bassisted\b", "с помощью партнёра"),
    (r"\bside lying\b", "лёжа на боку"),
]

BODY_PARTS = [
    (r"\b(?:chest|pectoral|pec)\b", "грудных мышц"),
    (r"\bshoulder\b", "плечевого пояса"),
    (r"\b(?:back|lat|lats)\b", "мышц спины"),
    (r"\bneck\b", "мышц шеи"),
    (r"\b(?:quad|quads|quadriceps)\b", "квадрицепса"),
    (r"\b(?:hamstring|hamstrings)\b", "задней поверхности бедра"),
    (r"\b(?:calf|calves)\b", "икроножных мышц"),
    (r"\b(?:glute|glutes|piriformis)\b", "ягодичных мышц"),
    (r"\bhip\b", "мышц тазобедренного сустава"),
    (r"\b(?:adductor|inner thigh)\b", "приводящих мышц бедра"),
    (r"\b(?:biceps)\b", "бицепса"),
    (r"\b(?:triceps)\b", "трицепса"),
    (r"\b(?:forearm|wrist)\b", "предплечий"),
    (r"\b(?:abs|abdominal|core)\b", "мышц живота"),
]

def normalize(raw: str) -> str:
    s = unicodedata.normalize("NFKC", raw).lower().replace("’", "'")
    s = re.sub(r"\((?:male|female)\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def reference_lookup(name: str, equipment: list[str], refs: dict[str, str]) -> tuple[str | None, str]:
    key = normalize(name)
    if key in refs:
        return refs[key], "reference_exact"
    prefixes = []
    equip = " ".join(equipment).lower()
    for english, token in [
        ("barbell", "barbell"), ("dumbbell", "dumbbell"), ("kettlebell", "kettlebell"),
        ("cable", "cable"), ("smith", "smith"), ("lever", "machine"), ("band", "band"),
    ]:
        if token in equip and not re.search(r"\b" + english + r"\b", key):
            prefixes.append(english)
    for token in prefixes:
        augmented = normalize(token + " " + name)
        if augmented in refs:
            return refs[augmented], "reference_equipment"
    # Very-high-confidence name spelling/spacing differences only.
    plausible = [(k, SequenceMatcher(None, key, k).ratio()) for k in refs
                 if abs(len(k)-len(key)) <= 4 and k[:1] == key[:1]]
    plausible.sort(key=lambda pair: pair[1], reverse=True)
    if plausible and plausible[0][1] >= .965 and (len(plausible) < 2 or plausible[0][1]-plausible[1][1] >= .025):
        return refs[plausible[0][0]], "reference_typography"
    return None, ""

def fallback_translation(name: str, equipment: list[str]) -> tuple[str, str]:
    key = normalize(name)
    if key in MANUAL_RU:
        return MANUAL_RU[key], "editorial"
    lower = name.lower()
    for expr, body in BODY_PARTS:
        if re.search(expr, lower) and re.search(r"\bstretch(?:ing)?\b", lower):
            result = "Растяжка " + body
            break
    else:
        result = ""
    if result:
        base = "stretch"
    else:
        base = ""
        for regex, ru in MOVEMENTS:
            if re.search(r"\b(?:" + regex + r")\b", lower):
                result, base = ru, regex
                break
    if not result:
        # Named poses are retained (as a proper noun) rather than falsely mapped
        # to a different familiar exercise.
        if "pose" in lower:
            return "Поза «" + name.replace("|", " / ").strip() + "»", "review_named_pose"
        return name, "review_untranslated"

    used = set()
    mods = []
    for pattern, ru in MODIFIERS:
        if re.search(pattern, lower) and ru not in used:
            mods.append(ru)
            used.add(ru)

    # For exercises with explicit implement, prioritize that over generic "Full Gym".
    equip_part = []
    for pattern, ru in EQUIPMENT_FORMS:
        if re.search(pattern, lower) and ru not in used:
            equip_part.append(ru)
            used.add(ru)
    if not equip_part and result in {"Жим лёжа", "Становая тяга", "Приседания", "Сгибание рук на бицепс"}:
        equip = " ".join(equipment).lower()
        for token, form in [
            ("barbell", "со штангой"), ("dumbbell", "с гантелями"),
            ("kettlebell", "с гирей"), ("smith", "в тренажёре Смита"),
            ("cable", "на блоке"), ("machine", "в тренажёре"),
        ]:
            if token in equip and form not in used:
                equip_part.append(form)
                break

    # Avoid redundant descriptions: press is a bench movement by definition.
    if result == "Жим лёжа":
        mods = [m for m in mods if m != "лёжа"]
    # Generic stretch should not append equipment ambiguously.
    if base == "stretch":
        ru = result + ((" " + " ".join(mods)) if mods else "")
    else:
        ru = result + ((" " + " ".join(equip_part)) if equip_part else "") + ((" " + " ".join(mods)) if mods else "")
    return ru, "review_composed"

def tracking_type(item: dict) -> tuple[str, str]:
    name = str(item["name"]).lower()
    desc = str(item.get("how_to") or "").lower()
    eq = " ".join(item.get("equipment") or []).lower()

    # Distance is a standard metric only when the equipment or activity supports it.
    if re.search(r"\b(treadmill|stationary bike|airbike|cycling|bicycle erg|rowing machine|row ergometer|elliptical|running|sprint(?:ing)?|walking|swimming|ski erg|skierg|bike)\b", name):
        if re.search(r"\b(bicycle crunch|air bike crunch)\b", name):
            return "weight_reps", "bodyweight_repetitions"
        return "time_distance", "distance_activity"

    # Loaded timed efforts (holds and carries) track both time and weight.
    loaded = bool(re.search(r"\b(weighted|barbell|dumbbell|kettlebell|plate|sandbag|farmers?|farmer's)\b", name))
    static_name = bool(re.search(r"\b(plank|hold|static|isometric|wall sit|dead hang|front lever|back lever|l-sit|l sit)\b", name))
    dynamic_static_variant = bool(re.search(r"\b(twist|rotation|tap|jack|walk|row|pushup|push-up|raise|extension|reach|dip|pull|up and down|up-down)\b", name))
    if static_name and not dynamic_static_variant:
        return ("time_weight" if loaded else "time"), "static_hold"

    if re.search(r"\b(?:farmer'?s? walk|suitcase carry|front rack carry|overhead carry|weighted carry)\b", name):
        return "time_weight", "loaded_carry"

    # Stretches, yoga poses and self-myofascial techniques are normally dosed by duration.
    stretch = bool(re.search(r"\b(stretch|asana|yoga|pose|foam roll|foam roller|mobility)\b", name))
    if stretch:
        # Active repetitive mobilisation should be counted as repetitions.
        if re.search(r"\b(dynamic|rotation|circle|swings|pull-apart)\b", name) or (
            re.search(r"\brepeat (?:for|the)|\brepetitions\b", desc)
            and not re.search(r"\bhold (?:this|the|for)|\bseconds\b", desc)
        ):
            return "weight_reps", "active_mobility_repetitions"
        return "time", "mobility_duration"

    # Intervals explicitly prescribe reps achieved within the measured time.
    if re.search(r"\b(amrap|emom|for time|timed reps|in one minute|per minute)\b", name + " " + desc[:220]):
        return "time_reps", "timed_repetitions"

    # Non-distance cardiovascular drills use elapsed time and repetitions when
    # counting movement cycles is useful, otherwise time only.
    if re.search(r"\b(burpee|jumping jack|mountain climber|high knees|jump rope|skipping rope|box jump|battle rope)\b", name):
        if re.search(r"\b(jumping jack|burpee|mountain climber|box jump)\b", name):
            return "time_reps", "cardio_repetitions"
        return "time", "stationary_cardio_duration"
    if re.search(r"\b(running in place|side shuffle|agility drill|shuttle)\b", name):
        return "time", "agility_duration"

    # The five-type domain currently has no repetitions-only value. Non-loaded
    # dynamic exercises use weight_reps with optional zero external weight.
    return "weight_reps", "dynamic_repetitions"

def main() -> None:
    raw = json.loads(REFERENCE.read_text(encoding="utf-8"))["names"]
    refs = {normalize(k): v.strip() for k,v in raw.items()}
    inputs = sorted(p for p in SOURCE.glob("*/*.json") if p.name != "_manifest.json")
    if not inputs:
        raise RuntimeError("No source exercise JSON found")
    destinations = set()
    all_results = []
    by_source: dict[str, tuple[str,str,str,str]] = {}
    # Reviewed work records take precedence over automatic suggestions and
    # keep duplicate catalogue appearances identical across muscle categories.
    for existing_path in sorted(TARGET.glob("*/*.json")):
        reviewed = json.loads(existing_path.read_text(encoding="utf-8"))
        if not isinstance(reviewed, dict) or not reviewed.get("name_ru") or reviewed.get("tracking_type") not in VALID_TYPES:
            raise ValueError("Invalid existing work record: " + str(existing_path))
        identity = str(reviewed.get("source_url") or reviewed["name"].strip().lower())
        previous = by_source.get(identity)
        reviewed_pair = (reviewed["name_ru"], reviewed["tracking_type"])
        if previous and previous[:2] != reviewed_pair:
            raise ValueError("Conflicting reviewed exercise duplicates: " + identity)
        by_source[identity] = (reviewed_pair[0], reviewed_pair[1], "existing_reviewed", "existing_reviewed")
    issues = []
    type_reasons = Counter()
    translation_reasons = Counter()
    for source in inputs:
        data = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("name"), str) or not data["name"].strip():
            raise ValueError("Invalid input: " + str(source))
        if "tracking_type" in data or "name_ru" in data:
            raise ValueError("Source unexpectedly already contains enrichment: " + str(source))
        key = str(data.get("source_url") or data["name"].strip().lower())
        if key in by_source:
            name_ru, typ, tr_reason, ty_reason = by_source[key]
        else:
            name_ru, tr_reason = reference_lookup(data["name"], list(data.get("equipment") or []), refs)
            if not name_ru:
                name_ru, tr_reason = fallback_translation(data["name"], list(data.get("equipment") or []))
            typ, ty_reason = tracking_type(data)
            by_source[key] = name_ru, typ, tr_reason, ty_reason
        if typ not in VALID_TYPES or not isinstance(name_ru, str) or not name_ru.strip():
            raise ValueError("Invalid enrichment: " + str(source))
        dest = TARGET / source.relative_to(SOURCE)
        if dest in destinations:
            raise ValueError("Duplicate destination: " + str(dest))
        destinations.add(dest)
        enriched = dict(data)
        enriched["name_ru"] = name_ru
        enriched["tracking_type"] = typ
        if dest.exists() and json.loads(dest.read_text(encoding="utf-8")) != enriched:
            raise ValueError("Refusing to overwrite reviewed work record: " + str(dest))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(enriched, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if (set(enriched) - set(data)) != {"name_ru", "tracking_type"} or any(enriched[k] != v for k,v in data.items()):
            raise AssertionError("Original field value changed: " + str(source))
        type_reasons[typ] += 1
        translation_reasons[tr_reason] += 1
        if tr_reason.startswith("review"):
            issues.append({"path":str(source.relative_to(ROOT)), "en":data["name"],
                           "ru":name_ru, "translation_reason":tr_reason,
                           "tracking_type":typ,"tracking_reason":ty_reason})
        all_results.append(str(dest.relative_to(ROOT)))
    if len(destinations) != len(inputs):
        raise AssertionError("Some inputs were not copied")
    stale = set(TARGET.glob("*/*.json"))-destinations
    if stale:
        raise RuntimeError("Unexpected preexisting work JSON files: " + str(sorted(stale)[:5]))
    summary = {
        "source_json_count":len(inputs),
        "work_json_count":len(destinations),
        "unique_exercises":len(by_source),
        "tracking_type_counts":dict(type_reasons),
        "translation_match_counts":dict(translation_reasons),
        "translation_review_count":len(issues),
        "translation_review":issues,
        "source_unchanged":True
    }
    REPORT.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in summary.items() if k!="translation_review"},ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
