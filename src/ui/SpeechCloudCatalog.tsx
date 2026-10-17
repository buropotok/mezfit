import { useState } from 'react';
import { Button as KonstaButton } from 'konsta/react';
import { Avatar, Divider, Surface, Text } from './primitives';
import { TextArea } from './FormControls';
import { SpeechCloud } from './SpeechCloud';

export function SpeechCloudCatalog() {
  const [text, setText] = useState('Привет! Сегодня начнём с разминки. Я помогу тебе провести тренировку.');
  const [open, setOpen] = useState(false);
  return <Surface as="section" className="ui-kit-section">
    <Text variant="title">SpeechCloud</Text>
    <Divider />
    <Text variant="body">Облачко тренера: морфинг, растровый текст и хвостик. Нажми на затемнение, чтобы закрыть.</Text>
    <TextArea label="Текст подсказки" value={text} onChange={(event) => setText(event.target.value)} />
    <div className="ui-kit-row">
      <SpeechCloud isOpen={open} onOpenChange={setOpen} text={text} avatar={<Avatar name="Тренер" />} />
      <KonstaButton strong onClick={() => setOpen(true)} disabled={!text.trim()}>Показать</KonstaButton>
    </div>
  </Surface>;
}
