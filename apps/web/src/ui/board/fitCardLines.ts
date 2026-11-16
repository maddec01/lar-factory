// How a board card (BoardCard) shares its fixed height between its title and the lines under it, so it shows as much as
// fits and never a part of a line: the title takes up to two lines and every line under it one, in order, while they
// fit; what room is left lets the title read whole, then each line under it wrap, in order. A line that has no room at
// all is left out rather than cut, and every line that can't show whole ends in an ellipsis.

/** How many lines `element` takes when it wraps freely, at `lineHeight` pixels a line. */
function naturalLines(element: HTMLElement, lineHeight: number): number {
    element.style.display = 'block';
    element.style.whiteSpace = 'normal';
    element.style.setProperty('-webkit-line-clamp', 'unset');
    element.style.overflow = 'visible';

    return Math.max(1, Math.round(element.scrollHeight / lineHeight));
}

/** Shows `element` on at most `lines` lines, ending in an ellipsis when it has more. */
function clamp(element: HTMLElement, lines: number) {
    element.style.display = '-webkit-box';
    element.style.setProperty('-webkit-box-orient', 'vertical');
    element.style.setProperty('-webkit-line-clamp', String(lines));
    element.style.whiteSpace = 'normal';
    element.style.overflow = 'hidden';
}

const px = (value: string) => Number.parseFloat(value) || 0;

/** Fits `card`'s title (`[data-title]`) and the lines under it (`[data-desk-more]`'s children) to its height. */
export function fitCardLines(card: HTMLElement) {
    const title = card.querySelector<HTMLElement>(':scope > [data-title]');
    const more = card.querySelector<HTMLElement>(':scope > [data-desk-more]');
    const foot = card.querySelector<HTMLElement>(':scope > [data-card-foot]');

    if (!title || !more || !foot) return;

    const cardStyle = getComputedStyle(card);
    const rowGap = px(cardStyle.rowGap);
    const lineGap = px(getComputedStyle(more).rowGap);
    const below = foot.nextElementSibling instanceof HTMLElement ? foot.nextElementSibling : null;
    // The room from the title's top to the foot's: the card's height less its padding, its foot, anything under the foot,
    // and the gaps around the lines under the title, which the grid keeps whether those lines show or not.
    const room =
        card.clientHeight -
        px(cardStyle.paddingBottom) -
        foot.offsetHeight -
        (below ? below.offsetHeight + rowGap : 0) -
        rowGap -
        title.offsetTop -
        rowGap;
    const titleLine = px(getComputedStyle(title).lineHeight) || 20;
    // A line with nothing to say (an empty dependency proof) takes no room; a thread's activity is one line of its own.
    const lines = [...more.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    const shown = lines.filter((line) => line.textContent?.trim());

    for (const line of lines) if (!shown.includes(line)) line.style.display = 'none';

    const heights = shown.map((line) => px(getComputedStyle(line).lineHeight) || 16);
    const wants = shown.map((line, i) =>
        line.hasAttribute('data-map-activity') ? 1 : naturalLines(line, heights[i]!),
    );
    const titleWants = naturalLines(title, titleLine);
    const given = shown.map(() => 0);
    let titleLines = Math.min(titleWants, 2);
    const used = () => {
        const count = given.filter(Boolean).length;

        return (
            titleLines * titleLine +
            given.reduce((sum, n, i) => sum + n * heights[i]!, 0) +
            Math.max(0, count - 1) * lineGap
        );
    };
    const fits = () => used() <= room + 0.5;

    // The title first, then one line for each line under it while they fit.
    while (!fits() && titleLines > 1) titleLines -= 1;

    for (let i = 0; i < shown.length; i++) {
        given[i] = 1;

        if (!fits()) {
            given[i] = 0;
            break;
        }
    }

    // What room is left lets the title read whole, then each line under it wrap.
    while (titleLines < titleWants) {
        titleLines += 1;

        if (!fits()) {
            titleLines -= 1;
            break;
        }
    }

    for (let i = 0; i < shown.length && given[i]; i++) {
        while (given[i]! < wants[i]!) {
            given[i]! += 1;

            if (!fits()) {
                given[i]! -= 1;
                break;
            }
        }
    }

    clamp(title, titleLines);
    shown.forEach((line, i) => {
        if (!given[i]) line.style.display = 'none';
        else if (line.hasAttribute('data-map-activity')) line.style.removeProperty('display');
        else clamp(line, given[i]!);
    });
}
