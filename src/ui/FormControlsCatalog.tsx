import { Checkbox, Divider, Radio, Surface, Text, TextInput } from './index';

export function FormControlsCatalog() {
  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Form controls</Text>
      <Text variant="caption" tone="muted">TextInput uses Body for field content and Caption for its floating label and feedback.</Text>
      <Divider />
      <div className="ui-kit-stack">
        <TextInput label="Имя" />
        <TextInput label="Имя" defaultValue="Андрей" />
        <TextInput label="Имя" placeholder="Введите имя" />
        <TextInput label="Имя" defaultValue="Андрей" disabled />
        <TextInput label="Имя" error="Обязательное поле" />
        <TextInput label="Имя" defaultValue="Андрей" success="Данные корректны" />
      </div>
      <Divider />
      <div className="ui-kit-stack">
        <Checkbox label="Checkbox" />
        <Checkbox label="Checkbox selected" defaultChecked />
        <Checkbox label="Checkbox disabled" disabled />
        <Radio name="ui-kit-radio" label="Radio" defaultChecked />
        <Radio name="ui-kit-radio" label="Radio alternative" />
        <Radio name="ui-kit-radio-disabled" label="Radio disabled" disabled />
      </div>
    </Surface>
  );
}
