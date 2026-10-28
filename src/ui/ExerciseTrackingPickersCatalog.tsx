import { useRef, useState } from 'react';
import { Button, Divider, Surface, Text } from './primitives';
import { NumPicker } from './num-picker/NumPicker';
import { WeightRepsPicker } from './weight-reps-picker/WeightRepsPicker';
import { DurationPicker, formatDurationSeconds } from './duration-picker/DurationPicker';
import { DistancePicker } from './distance-picker/DistancePicker';
import { WeightPicker } from './weight-picker/WeightPicker';

function formatDistanceMeters(value: number): string {
  return `${Math.floor(value / 1000)} км ${String(value % 1000).padStart(3, '0')} м`;
}

/** Interactive demos of the public controlled picker APIs; no training or persistence state. */
export function ExerciseTrackingPickersCatalog() {
  const numTarget = useRef<HTMLSpanElement | null>(null);
  const weightRepsTarget = useRef<HTMLSpanElement | null>(null);
  const durationTarget = useRef<HTMLSpanElement | null>(null);
  const distanceTarget = useRef<HTMLSpanElement | null>(null);
  const weightTarget = useRef<HTMLSpanElement | null>(null);

  const [numOpened, setNumOpened] = useState(false);
  const [numValue, setNumValue] = useState(123);
  const [weightRepsOpened, setWeightRepsOpened] = useState(false);
  const [weightRepsValue, setWeightRepsValue] = useState({ reps: 8, weightKg: 77.75 });
  const [durationOpened, setDurationOpened] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(125);
  const [distanceOpened, setDistanceOpened] = useState(false);
  const [distanceMeters, setDistanceMeters] = useState(2050);
  const [weightOpened, setWeightOpened] = useState(false);
  const [weightKg, setWeightKg] = useState(70.75);

  return (
    <>
      <Surface as="section" className="ui-kit-section">
        <Text variant="title">Num picker</Text>
        <Text variant="caption" tone="muted">Целые числа от 0 до 999. Слева — сотни 0–9, справа — последние две цифры 00–99.</Text>
        <Divider />
        <div className="ui-kit-stack">
          <Text>Выбрано: {numValue}</Text>
          <span ref={numTarget} style={{ display: 'inline-flex' }}>
            <Button onClick={() => setNumOpened(true)}>Выбрать число</Button>
          </span>
        </div>
      </Surface>
      <NumPicker opened={numOpened} target={numTarget.current} value={numValue} onChange={setNumValue} onClose={() => setNumOpened(false)} />

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">Вес + повторения</Text>
        <Text variant="caption" tone="muted">Цифровой ввод неотрицательных повторений и целых килограммов без заданной верхней границы; дробные килограммы с шагом 0,25 кг выбираются колесом 00 / 25 / 5 / 75.</Text>
        <Divider />
        <div className="ui-kit-stack">
          <Text>Повторения: {weightRepsValue.reps} · Вес: {weightRepsValue.weightKg} кг</Text>
          <span ref={weightRepsTarget} style={{ display: 'inline-flex' }}>
            <Button onClick={() => setWeightRepsOpened(true)}>Выбрать повторения и вес</Button>
          </span>
        </div>
      </Surface>
      <WeightRepsPicker opened={weightRepsOpened} target={weightRepsTarget.current} value={weightRepsValue} onChange={setWeightRepsValue} onClose={() => setWeightRepsOpened(false)} />

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">DurationPicker · продолжительность</Text>
        <Text variant="caption" tone="muted">Часы 0–23, минуты и секунды 0–59. Формат HH:mm:ss; значение — 0–86 399 секунд без циклического времени суток.</Text>
        <Divider />
        <div className="ui-kit-stack">
          <Text>Выбрано: {formatDurationSeconds(durationSeconds)} ({durationSeconds} с)</Text>
          <span ref={durationTarget} style={{ display: 'inline-flex' }}>
            <Button onClick={() => setDurationOpened(true)}>Выбрать продолжительность</Button>
          </span>
        </div>
      </Surface>
      <DurationPicker opened={durationOpened} target={durationTarget.current} value={durationSeconds} onChange={setDurationSeconds} onClose={() => setDurationOpened(false)} />

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">DistancePicker · дистанция</Text>
        <Text variant="caption" tone="muted">Километры 0–100 и метры 0–999. Диапазон 0–100 999 м, точность до одного метра.</Text>
        <Divider />
        <div className="ui-kit-stack">
          <Text>Выбрано: {formatDistanceMeters(distanceMeters)} ({distanceMeters} м)</Text>
          <span ref={distanceTarget} style={{ display: 'inline-flex' }}>
            <Button onClick={() => setDistanceOpened(true)}>Выбрать дистанцию</Button>
          </span>
        </div>
      </Surface>
      <DistancePicker opened={distanceOpened} target={distanceTarget.current} value={distanceMeters} onChange={setDistanceMeters} onClose={() => setDistanceOpened(false)} />

      <Surface as="section" className="ui-kit-section">
        <Text variant="title">WeightPicker · вес</Text>
        <Text variant="caption" tone="muted">Только вес: 0–399,75 кг, шаг 0,25 кг. Два колеса — килограммы и дроби 00 / 25 / 5 / 75.</Text>
        <Divider />
        <div className="ui-kit-stack">
          <Text>Выбрано: {weightKg} кг</Text>
          <span ref={weightTarget} style={{ display: 'inline-flex' }}>
            <Button onClick={() => setWeightOpened(true)}>Выбрать вес</Button>
          </span>
        </div>
      </Surface>
      <WeightPicker opened={weightOpened} target={weightTarget.current} value={weightKg} onChange={setWeightKg} onClose={() => setWeightOpened(false)} />
    </>
  );
}
