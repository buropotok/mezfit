import type { ExerciseDefinition } from './api';

const cyrillic = /[А-Яа-яЁё]/;
const latin = /[A-Za-z]/;

const equipmentPrefixes: Array<[RegExp, string]> = [
  [/^EZ Barbell\s+/i, 'штанга EZ'],
  [/^Barbell\s+/i, 'штанга'],
  [/^Dumbbell\s+/i, 'гантели'],
  [/^Cable\s+/i, 'трос'],
  [/^Smith\s+/i, 'тренажёр Смита'],
  [/^Lever\s+/i, 'тренажёр'],
  [/^Machine\s+/i, 'тренажёр'],
  [/^Sled\s+/i, 'тренажёр'],
  [/^Kettlebell\s+/i, 'гиря'],
  [/^Band\s+/i, 'резинка'],
  [/^Bodyweight\s+/i, 'свой вес'],
];

const phrases: Array<[RegExp, string]> = [
  [/Decline Bench Press/gi, 'Жим лёжа (обратный наклон)'],
  [/Incline Bench Press/gi, 'Жим лёжа (наклон)'],
  [/Close Grip Bench Press/gi, 'Жим лёжа узким хватом'],
  [/Wide Grip Bench Press/gi, 'Жим лёжа широким хватом'],
  [/Bench Press/gi, 'Жим лёжа'],
  [/Overhead Press/gi, 'Жим над головой'],
  [/Shoulder Press/gi, 'Жим на плечи'],
  [/Chest Press/gi, 'Жим на грудь'],
  [/Leg Press/gi, 'Жим ногами'],
  [/Romanian Deadlift/gi, 'Румынская тяга'],
  [/Sumo Deadlift/gi, 'Становая тяга сумо'],
  [/Rack Pull/gi, 'Тяга с рамы'],
  [/Deadlift/gi, 'Становая тяга'],
  [/Front Squat/gi, 'Фронтальные приседания'],
  [/Hack Squat/gi, 'Гакк-приседания'],
  [/Split Squat/gi, 'Сплит-приседания'],
  [/Full Squat/gi, 'Приседания'],
  [/Squat/gi, 'Приседания'],
  [/Rear Lunge/gi, 'Обратные выпады'],
  [/Lunge/gi, 'Выпады'],
  [/Step up/gi, 'Зашагивания'],
  [/Bent Over Row/gi, 'Тяга в наклоне'],
  [/Incline Row/gi, 'Тяга на наклонной скамье'],
  [/Upright Row/gi, 'Тяга к подбородку'],
  [/Rear Delt Row/gi, 'Тяга на заднюю дельту'],
  [/One Arm Row/gi, 'Тяга одной рукой'],
  [/Seated Row/gi, 'Тяга сидя'],
  [/Row/gi, 'Тяга'],
  [/Lat Pulldown/gi, 'Тяга верхнего блока'],
  [/Pulldown/gi, 'Тяга блока'],
  [/Pull Up/gi, 'Подтягивания'],
  [/Pull-up/gi, 'Подтягивания'],
  [/Push Up/gi, 'Отжимания'],
  [/Push-up/gi, 'Отжимания'],
  [/Hammer Curl/gi, 'Молотковые сгибания рук'],
  [/Concentration Curl/gi, 'Концентрированные сгибания рук'],
  [/Preacher Curl/gi, 'Сгибания рук на скамье Скотта'],
  [/Reverse Curl/gi, 'Обратные сгибания рук'],
  [/Wrist Curl/gi, 'Сгибания запястий'],
  [/Curl/gi, 'Сгибание рук'],
  [/Triceps Extension/gi, 'Разгибание рук на трицепс'],
  [/Triceps Pushdown/gi, 'Разгибание рук на блоке'],
  [/Leg Extension/gi, 'Разгибание ног'],
  [/Leg Curl/gi, 'Сгибание ног'],
  [/Hip Adduction/gi, 'Приведение бедра'],
  [/Hip Abduction/gi, 'Отведение бедра'],
  [/Hip Thrust/gi, 'Ягодичный мост'],
  [/Calf Raise/gi, 'Подъём на носки'],
  [/Lateral Raise/gi, 'Подъём рук в стороны'],
  [/Front Raise/gi, 'Подъём рук перед собой'],
  [/Shrug/gi, 'Шраги'],
  [/Reverse Fly/gi, 'Обратная разводка'],
  [/Revers Fly/gi, 'Обратная разводка'],
  [/Fly/gi, 'Разводка'],
  [/Pullover/gi, 'Пуловер'],
  [/Kneeling Crunch/gi, 'Скручивания на коленях'],
  [/Crunch/gi, 'Скручивания'],
  [/Sit up/gi, 'Подъём корпуса'],
  [/Sit-up/gi, 'Подъём корпуса'],
  [/Plank/gi, 'Планка'],
  [/Butt Kicks/gi, 'Захлёст голени'],
  [/Jumping Jack/gi, 'Прыжки «Джампинг Джек»'],
  [/Mountain Climber/gi, 'Альпинист'],
  [/Battling Ropes/gi, 'Работа с канатами'],
  [/Running/gi, 'Бег'],
  [/Walking/gi, 'Ходьба'],
  [/Cycling/gi, 'Велотренажёр'],
];

const words: Record<string, string> = {
  standing: 'стоя', seated: 'сидя', lying: 'лёжа', kneeling: 'на коленях',
  one: 'одной', arm: 'рукой', single: 'одной', alternating: 'попеременно', alternate: 'попеременно',
  wide: 'широким', grip: 'хватом', close: 'узким', reverse: 'обратный',
  rear: 'задний', front: 'передний', lateral: 'боковой', incline: 'наклон', decline: 'обратный наклон',
  overhead: 'над головой', extension: 'разгибание', press: 'жим', raise: 'подъём',
  calf: 'икр', calves: 'икр', chest: 'грудь', back: 'спина', shoulder: 'плечо', shoulders: 'плечи',
  biceps: 'бицепс', triceps: 'трицепс', forearm: 'предплечье', forearms: 'предплечья',
  leg: 'нога', legs: 'ноги', hip: 'бедро', hips: 'бёдра', waist: 'корпус',
  with: 'с', rope: 'канатом', attachment: 'рукоятью', bench: 'скамья', concentration: 'концентрированное',
};

const translit: Record<string, string> = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л',
  m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'й', z: 'з',
};

function transliterateWord(value: string): string {
  return value.split('').map((char) => {
    const low = char.toLowerCase();
    const mapped = translit[low];
    if (!mapped) return char;
    return char === char.toUpperCase() ? mapped.charAt(0).toUpperCase() + mapped.slice(1) : mapped;
  }).join('');
}

export function localizeBundledExerciseName(name: string, referenceSource?: string | null): string {
  if (referenceSource !== 'gym_keeper_apk' || cyrillic.test(name) || !latin.test(name)) return name;

  let value = name
    .replace(/\s*\((male|female)\)/gi, '')
    .replace(/\s*\((with )?[^)]*attachment[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let equipment = '';
  for (const [pattern, label] of equipmentPrefixes) {
    if (pattern.test(value)) {
      equipment = label;
      value = value.replace(pattern, '');
      break;
    }
  }

  for (const [pattern, replacement] of phrases) value = value.replace(pattern, replacement);

  value = value.split(/(\s+|[-/])/).map((part) => {
    if (!latin.test(part)) return part;
    const mapped = words[part.toLowerCase()];
    return mapped ?? transliterateWord(part);
  }).join('');

  value = value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.)])/g, '$1')
    .trim();

  if (!value) value = 'Упражнение';
  return equipment ? `${value} · ${equipment}` : value;
}

export function exerciseDisplayName(exercise: Pick<ExerciseDefinition, 'name' | 'reference_source'>): string {
  return localizeBundledExerciseName(exercise.name, exercise.reference_source);
}
