// The optional ticket fields Add item and Create ticket submit, limited to the fields their form shows.

import { type TicketOptions } from '@lar-factory/shared';

/** Both forms submit exactly the optional fields currently visible. */
export function ticketOptions(form: HTMLFormElement): TicketOptions {
    const values = new FormData(form);

    return {
        ...(form.querySelector('#item-labels') ? { labels: values.getAll('labels').map(String) } : {}),
        ...(values.has('newLabels') ? { newLabels: values.getAll('newLabels').map(String) } : {}),
        ...Object.fromEntries(
            ['type', 'assignee', 'milestone', 'iteration']
                .filter((name) => values.has(name))
                .map((name) => {
                    const entry = values.get(name);

                    return [name, typeof entry === 'string' ? entry : ''];
                }),
        ),
    };
}
