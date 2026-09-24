import { Checkbox as KonstaCheckbox, List as KonstaList, ListInput, ListItem as KonstaListItem, Radio as KonstaRadio } from 'konsta/react';
import { Divider, Surface, Text } from './index';

export function FormControlsCatalog() {
  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Forms</Text>
      <Text variant="caption" tone="muted">Canonical Konsta UI form primitives using the iOS dark theme.</Text>
      <Divider />
      <Text variant="headline">ListInput</Text>
      <KonstaList nested>
        <ListInput
          floatingLabel
          inputId="ui-kit-form-name"
          label={<label htmlFor="ui-kit-form-name">Имя</label>}
        />
        <ListInput
          floatingLabel
          inputId="ui-kit-form-name-filled"
          label={<label htmlFor="ui-kit-form-name-filled">Имя</label>}
          defaultValue="Андрей"
        />
        <ListInput
          floatingLabel
          inputId="ui-kit-form-name-disabled"
          label={<label htmlFor="ui-kit-form-name-disabled">Имя</label>}
          defaultValue="Андрей"
          disabled
        />
        <ListInput
          floatingLabel
          inputId="ui-kit-form-name-error"
          label={<label htmlFor="ui-kit-form-name-error">Имя</label>}
          error="Обязательное поле"
        />
      </KonstaList>
      <Divider />
      <Text variant="headline">Textarea</Text>
      <KonstaList nested>
        <ListInput
          floatingLabel
          inputId="ui-kit-form-description"
          label={<label htmlFor="ui-kit-form-description">Описание</label>}
          type="textarea"
          inputClassName="!h-20 resize-none"
        />
        <ListInput
          floatingLabel
          inputId="ui-kit-form-description-filled"
          label={<label htmlFor="ui-kit-form-description-filled">Описание</label>}
          type="textarea"
          inputClassName="!h-20 resize-none"
          defaultValue={'Первая строка\nВторая строка'}
        />
        <ListInput
          floatingLabel
          inputId="ui-kit-form-description-disabled"
          label={<label htmlFor="ui-kit-form-description-disabled">Описание</label>}
          type="textarea"
          inputClassName="!h-20 resize-none"
          defaultValue="Недоступное описание"
          disabled
        />
      </KonstaList>
      <Divider />
      <Text variant="headline">Checkbox</Text>
      <KonstaList nested>
        <KonstaListItem label title="Checkbox" media={<KonstaCheckbox component="div" />} />
        <KonstaListItem label title="Checkbox selected" media={<KonstaCheckbox component="div" defaultChecked />} />
        <KonstaListItem label title="Checkbox disabled" media={<KonstaCheckbox component="div" disabled />} />
      </KonstaList>
      <Divider />
      <Text variant="headline">Radio</Text>
      <KonstaList nested>
        <KonstaListItem label title="Radio" media={<KonstaRadio component="div" name="ui-kit-radio" value="one" defaultChecked />} />
        <KonstaListItem label title="Radio alternative" media={<KonstaRadio component="div" name="ui-kit-radio" value="two" />} />
        <KonstaListItem label title="Radio disabled" media={<KonstaRadio component="div" name="ui-kit-radio-disabled" value="disabled" disabled />} />
      </KonstaList>
    </Surface>
  );
}
