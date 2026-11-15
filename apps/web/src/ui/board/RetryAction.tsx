// The board's one Try again (and its Recheck access): a link inside a sentence that says what failed, an Other button
// anywhere else.

import { Button, InlineLink } from '@lar-works/design-system';

import { buttonKind, type ButtonDensity } from './ButtonKinds';
import type { DataAttributes } from './DataAttributes';
import { useButtonKind } from './useButtonKind';

const words = {
    retry: ['Try again', 'Trying again…'],
    access: ['Recheck access', 'Rechecking access…'],
} as const;

/** "Try again" ("Trying again…" while it runs) after something couldn't be read or done, or "Recheck access" after the
 *  board found it can't write somewhere. `inline` inside a sentence or a dotted line, as the sentence's link;
 *  otherwise an Other button, at its surface's density unless `size` names one (an alert's action, an empty state, a
 *  settings row). */
export function RetryAction({
    onRetry,
    busy = false,
    inline = false,
    access = false,
    size,
    label,
    unavailable,
    disabled = false,
    ...data
}: {
    /** Called as the reader tries again. */
    onRetry: () => void;
    /** A try is in flight: it holds and reads "Trying again…". */
    busy?: boolean | undefined;
    /** Drawn as a link in the running text. */
    inline?: boolean;
    /** Asks for access again: "Recheck access". */
    access?: boolean;
    /** The surface's density, where it isn't set by a ButtonDensityProvider: `md` in settings rows and forms. */
    size?: ButtonDensity;
    /** The button's accessible name when its words alone wouldn't say what it tries, such as one that retries an
     *  install in every target. */
    label?: string;
    /** Why it can't be tried here, such as on a sample board: it holds, saying so on hover. */
    unavailable?: string | null | undefined;
    /** Held while something else around it runs. */
    disabled?: boolean | undefined;
} & DataAttributes) {
    const kind = useButtonKind();
    const [rest, running] = words[access ? 'access' : 'retry'];
    const text = busy ? running : rest;

    if (inline)
        return (
            <InlineLink onClick={onRetry} disabled={busy || disabled || !!unavailable}>
                {text}
            </InlineLink>
        );

    return (
        <Button
            {...(size ? buttonKind('other', { size }) : kind('other'))}
            {...data}
            aria-label={label}
            busy={busy}
            disabled={disabled || !!unavailable}
            title={unavailable ?? undefined}
            aria-description={unavailable ?? undefined}
            onClick={onRetry}
        >
            {text}
        </Button>
    );
}
