import { Switch as NinnaSwitch, type SwitchProps } from '@ninna-ui/forms';
import { forwardRef } from 'react';

import { tabbable } from '../foundations/KeyboardFocus';

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>((props, ref) => (
    <NinnaSwitch ref={ref} {...tabbable} size="sm" aria-busy={props.loading || undefined} {...props} />
));

Switch.displayName = 'Switch';
