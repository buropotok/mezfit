import type { CSSProperties, HTMLAttributes } from 'react';
import type { UiIconPair, UiIconSource } from './iconPair';
import { getUiIconAsset, type UiIconName, type UiIconVariant } from './icons/registry';

export type IconProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  name: UiIconName;
  variant?: UiIconVariant;
};

export function Icon({ name, variant = 'outline', className = '', style, ...props }: IconProps) {
  const asset = getUiIconAsset(name, variant);
  const iconStyle = {
    display: 'block',
    width: '100%',
    height: '100%',
    backgroundColor: 'currentColor',
    WebkitMaskImage: `url("${asset}")`,
    maskImage: `url("${asset}")`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    ...style,
  } as CSSProperties;

  return <span className={`ui-icon ${className}`.trim()} aria-hidden="true" style={iconStyle} {...props} />;
}

export function resolveUiIconPair(icon: UiIconSource): UiIconPair {
  if (typeof icon !== 'string') return icon;
  return {
    outline: <Icon name={icon} variant="outline" />,
    filled: <Icon name={icon} variant="filled" />,
  };
}

export type { UiIconName, UiIconVariant };
