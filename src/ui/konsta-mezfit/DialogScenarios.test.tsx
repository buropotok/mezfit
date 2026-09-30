import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider, List, ListItem, Radio } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { MezfitDialog, MezfitDialogButton } from './index';

function renderDialog(dialog: ReactNode) {
  return renderToStaticMarkup(
    <KonstaProvider theme="ios" dark>
      {dialog}
    </KonstaProvider>,
  );
}

describe('MezfitDialog scenarios', () => {
  it('supports the four canonical Konsta dialog compositions', () => {
    const contentHtml = renderDialog(
      <MezfitDialog
        opened
        title="Content"
        content="Body"
        buttons={(
          <>
            <MezfitDialogButton>Cancel</MezfitDialogButton>
            <MezfitDialogButton strong>Continue</MezfitDialogButton>
          </>
        )}
      />,
    );
    const infoHtml = renderDialog(
      <MezfitDialog
        opened
        title="Info"
        content="Saved"
        buttons={<MezfitDialogButton strong>OK</MezfitDialogButton>}
      />,
    );
    const confirmHtml = renderDialog(
      <MezfitDialog
        opened
        title="Confirm"
        content="Continue?"
        buttons={(
          <>
            <MezfitDialogButton>No</MezfitDialogButton>
            <MezfitDialogButton strong>Yes</MezfitDialogButton>
          </>
        )}
      />,
    );
    const listHtml = renderDialog(
      <MezfitDialog
        opened
        title="List"
        content={(
          <List nested>
            <ListItem
              label
              title="Strength"
              after={<Radio component="div" checked onChange={() => undefined} />}
            />
          </List>
        )}
        buttons={<MezfitDialogButton strong>Confirm</MezfitDialogButton>}
      />,
    );

    expect(contentHtml).toContain('Content');
    expect(contentHtml).toContain('Continue');
    expect(infoHtml).toContain('Saved');
    expect(infoHtml).toContain('OK');
    expect(confirmHtml).toContain('Continue?');
    expect(confirmHtml).toContain('Yes');
    expect(listHtml).toContain('Strength');
    expect(listHtml).toContain('Confirm');
  });

  it('keeps the Delete button mechanics and changes only its label color', () => {
    const regularButtonHtml = renderDialog(
      <MezfitDialogButton strong>Delete</MezfitDialogButton>,
    );
    const dangerButtonHtml = renderDialog(
      <MezfitDialogButton strong tone="danger">Delete</MezfitDialogButton>,
    );
    const regularButtonTag = regularButtonHtml.match(/<button[^>]*>/)?.[0];
    const dangerButtonTag = dangerButtonHtml.match(/<button[^>]*>/)?.[0];

    expect(dangerButtonTag).toBe(regularButtonTag);
    expect(dangerButtonHtml).toContain(
      '<span style="color:var(--ui-color-danger, #ff6b6b)">Delete</span>',
    );
  });
});
