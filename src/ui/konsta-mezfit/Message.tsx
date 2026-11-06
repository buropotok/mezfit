// Approved COMM-05 adapter for Konsta 5.4.0. Preserve its renderer/classes;
// expose the bubble boundary rather than inspecting Konsta DOM from features.
import type { ComponentProps, ElementType, MouseEventHandler, ReactNode, Ref } from 'react';
import { Message as KonstaMessage, useTheme } from 'konsta/react';
import { MessageClasses } from 'konsta/shared/classes';
import { MessageColors } from 'konsta/shared/colors';
import { cls } from 'konsta/shared/utils';

// The upstream renderer accepts React content here; its 5.4 typings still say string.
export type MezfitMessageProps = Omit<ComponentProps<typeof KonstaMessage>, 'name' | 'textHeader' | 'textFooter'> & {
  name?: ReactNode;
  textHeader?: ReactNode;
  textFooter?: ReactNode;
  bubbleRef?: Ref<HTMLDivElement>;
  onBubbleClick?: MouseEventHandler<HTMLDivElement>;
  bubbleSource?: ReactNode;
};

export function MezfitMessage(props: MezfitMessageProps) {
  const { component = 'div', className, colors: colorsProp, ref, id, text, name,
    type = 'sent', header, footer, textHeader, textFooter, avatar,
    children, bubbleRef, onBubbleClick, bubbleSource, ...rest } = props;
  const theme = useTheme();
  const c = MessageClasses({ ...props, type }, MessageColors(colorsProp, (classes: string) => classes), className);
  const classes = (part: { common?: string; ios?: string; material?: string }) => cls(part.common, part[theme]);
  const Component = component as ElementType;
  return <Component {...rest} id={id} ref={ref}
    className={cls(classes(c.message), classes(type === 'sent' ? c.messageSent : c.messageReceived))}>
    {avatar && <div className={classes(c.messageAvatar)}>{avatar}</div>}
    <div className={classes(c.messageContent)}>
      {name && <div className={classes(c.messageName)}>{name}</div>}
      {header && <div className={classes(c.messageHeader)}>{header}</div>}
      <div className={classes(c.messageBubble)} ref={bubbleRef} onClick={onBubbleClick}>
        {textHeader && <div className={classes(c.messageTextHeader)}>{textHeader}</div>}
        {text && <div className={classes(c.messageText)}>{text}</div>}
        {textFooter && <div className={classes(c.messageTextFooter)}>{textFooter}</div>}
        {bubbleSource}
      </div>
      {footer && <div className={classes(c.messageFooter)}>{footer}</div>}
    </div>
  </Component>;
}
