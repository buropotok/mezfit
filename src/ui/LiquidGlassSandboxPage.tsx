import { useState, type ReactElement } from 'react';
import { Tabs, TabsList, TabsTrigger, Text } from './index';
import type { UiIconPair } from './iconPair';
import './liquid-glass-sandbox.css';

function svg(paths: ReactElement | ReactElement[], filled = false) {
  return (
    <svg
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? undefined : 'currentColor'}
      strokeLinecap={filled ? undefined : 'round'}
      strokeLinejoin={filled ? undefined : 'round'}
      strokeWidth={filled ? undefined : 2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

const homeIcon: UiIconPair = {
  outline: svg([
    <path key="roof" d="M5 12l-2 0l9 -9l9 9l-2 0" />,
    <path key="walls" d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />,
    <path key="door" d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />,
  ]),
  filled: svg(<path d="M12.707 2.293l9 9c.63 .63 .184 1.707 -.707 1.707h-1v6a3 3 0 0 1 -3 3h-1v-7a3 3 0 0 0 -2.824 -2.995l-.176 -.005h-2a3 3 0 0 0 -3 3v7h-1a3 3 0 0 1 -3 -3v-6h-1c-.89 0 -1.337 -1.077 -.707 -1.707l9 -9a1 1 0 0 1 1.414 0m.293 11.707a1 1 0 0 1 1 1v7h-4v-7a1 1 0 0 1 .883 -.993l.117 -.007z" />, true),
};

const workoutIcon: UiIconPair = {
  outline: svg([
    <path key="a" d="M2 12h1" />,
    <path key="b" d="M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2" />,
    <path key="c" d="M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1" />,
    <path key="d" d="M9 12h6" />,
    <path key="e" d="M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1" />,
    <path key="f" d="M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2" />,
  ]),
  filled: svg([
    <path key="a" d="M4 7a1 1 0 0 1 1 1v8a1 1 0 0 1 -2 0v-3h-1a1 1 0 0 1 0 -2h1v-3a1 1 0 0 1 1 -1" />,
    <path key="b" d="M20 7a1 1 0 0 1 1 1v3h1a1 1 0 0 1 0 2h-1v3a1 1 0 0 1 -2 0v-8a1 1 0 0 1 1 -1" />,
    <path key="c" d="M16 5a2 2 0 0 1 2 2v10a2 2 0 1 1 -4 0v-4h-4v4a2 2 0 1 1 -4 0v-10a2 2 0 1 1 4 0v4h4v-4a2 2 0 0 1 2 -2" />,
  ], true),
};

const calendarIcon: UiIconPair = {
  outline: svg([
    <rect key="r" height="16" rx="2" width="18" x="3" y="5" />,
    <path key="p" d="M16 3v4M8 3v4M3 11h18" />,
  ]),
  filled: svg(<path d="M16 2a1 1 0 0 1 .993 .883l.007 .117v1h1a3 3 0 0 1 2.995 2.824l.005 .176v12a3 3 0 0 1 -2.824 2.995l-.176 .005h-12a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-12a3 3 0 0 1 2.824 -2.995l.176 -.005h1v-1a1 1 0 0 1 1.993 -.117l.007 .117v1h6v-1a1 1 0 0 1 1 -1zm3 7h-14v9.625c0 .705 .386 1.286 .883 1.366l.117 .009h12c.513 0 .936 -.53 .993 -1.215l.007 -.16v-9.625z" />, true),
};

const settingsIcon: UiIconPair = {
  outline: svg([
    <path key="a" d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065" />,
    <path key="b" d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />,
  ]),
  filled: svg(<path d="M14.647 4.081a.724 .724 0 0 0 1.08 .448c2.439 -1.485 5.23 1.305 3.745 3.744a.724 .724 0 0 0 .447 1.08c2.775 .673 2.775 4.62 0 5.294a.724 .724 0 0 0 -.448 1.08c1.485 2.439 -1.305 5.23 -3.744 3.745a.724 .724 0 0 0 -1.08 .447c-.673 2.775 -4.62 2.775 -5.294 0a.724 .724 0 0 0 -1.08 -.448c-2.439 1.485 -5.23 -1.305 -3.745 -3.744a.724 .724 0 0 0 -.447 -1.08c-2.775 -.673 -2.775 -4.62 0 -5.294a.724 .724 0 0 0 .448 -1.08c-1.485 -2.439 1.305 -5.23 3.744 -3.745a.724 .724 0 0 0 1.08 -.447c.673 -2.775 4.62 -2.775 5.294 0M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0 -6" />, true),
};

const iconTabs = [
  { value: 'home', label: 'Главная', icon: homeIcon },
  { value: 'workout', label: 'Тренировки', icon: workoutIcon },
  { value: 'calendar', label: 'Календарь', icon: calendarIcon },
  { value: 'settings', label: 'Настройки', icon: settingsIcon },
];

export function LiquidGlassSandboxPage() {
  const [iconValue, setIconValue] = useState('workout');
  const [textValue, setTextValue] = useState('today');

  return (
    <main className="liquid-glass-sandbox">
      <section className="liquid-glass-sandbox__intro">
        <Text variant="large-title">Liquid Glass sandbox</Text>
        <Text tone="muted">
          Реальный @tinymomentum/liquid-glass-react как material layer. Геометрия, selector, иконки и physics — Mezfit.
        </Text>
      </section>

      <section className="liquid-glass-sandbox__copy">
        <Text variant="headline">Проверка поведения</Text>
        <Text>Нажимай вкладки коротко и с удержанием. При переходе на другую вкладку линза раскрывается к T/2 и закрывается на второй половине пути.</Text>
        <Text>Если нажать уже активный selector, размер зависит от длительности удержания. Свайп не должен активировать линзу.</Text>
        <Text>Главная · Тренировки · Календарь · Настройки · Главная · Тренировки · Календарь · Настройки.</Text>
        <Text>0123456789 · ABCDEFGHIJKLMNOPQRSTUVWXYZ · прокручиваемый текст под материалом.</Text>
        <div className="liquid-glass-sandbox__gradient-card">
          <Text variant="headline">Цветной фон</Text>
          <Text>Эта область нужна, чтобы видеть distortion готового материала библиотеки.</Text>
        </div>
        <div className="liquid-glass-sandbox__spacer" />
      </section>

      <section className="liquid-glass-sandbox__text-tabs">
        <Text variant="footnote" tone="muted">mode=&quot;default&quot;</Text>
        <Tabs theme="liquidGlass" mode="default" value={textValue} onValueChange={setTextValue}>
          <TabsList aria-label="Период">
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="today">Сегодня</TabsTrigger>
            <TabsTrigger value="week">Неделя</TabsTrigger>
            <TabsTrigger value="month">Месяц</TabsTrigger>
            <TabsTrigger value="history">История</TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <section className="liquid-glass-sandbox__bottom-nav">
        <Tabs theme="liquidGlass" mode="icon" value={iconValue} onValueChange={setIconValue}>
          <TabsList aria-label="Быстрая навигация">
            {iconTabs.map((item) => (
              <TabsTrigger key={item.value} value={item.value} icon={item.icon}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </section>
    </main>
  );
}
