// Start build's question when skills have Drift: Replace and start, the dialog's Main action and its submit, has the
// board app overwrite them with its Release and then starts; Start anyway starts with them as they are. Cancel,
// Close or Escape starts nothing.

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { listed, type DriftChoice, type ModelChoice } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { kind } from '../buttons/button-kinds.tsx';

/** The build waiting for a choice: its item, the model choice it started with and the skills with Drift. */
interface Asked {
  itemId: string;
  choice: ModelChoice | undefined;
  skills: string[];
}

interface DriftChoiceState {
  open: boolean;
  asked: Asked | null;
  ask: (asked: Asked) => void;
  close: () => void;
}

/** It keeps the question while the dialog closes, so the text doesn't change under the closing animation. */
export const useDriftChoiceStore = create<DriftChoiceState>()((set) => ({
  open: false,
  asked: null,
  ask: (asked) => set({ open: true, asked }),
  close: () => set({ open: false }),
}));

/** `start` runs the build again with the User's choice. */
export function DriftChoiceDialog({ start }: { start: (itemId: string, choice: ModelChoice | undefined, drift: DriftChoice) => void }) {
  const { open, asked, close } = useDriftChoiceStore();
  if (!open || !asked) return null;
  const choose = (drift: DriftChoice) => {
    close();
    start(asked.itemId, asked.choice, drift);
  };
  const them = asked.skills.length > 1 ? 'them' : 'it';
  return (
    <Modal onClose={close}>
      <Modal.Content id="drift-choice" role="alertdialog" title="Some of lar's skills changed" description="Choose how the build starts."
        aria-describedby="drift-choice-detail" closeOnOverlayClick={false}>
        <Modal.Form onSubmit={(event) => { event.preventDefault(); choose('replace'); }}>
          <Modal.Body>
            <Text id="drift-choice-detail" tone="muted">
              {listed(asked.skills)} changed since Lar Factory installed {them}. Replace and start puts this Release's copy back first;
              Start anyway runs the build with {them} as {asked.skills.length > 1 ? 'they are' : 'it is'}.
            </Text>
          </Modal.Body>
          <Modal.Footer>
            <Button {...kind('other')} type="button" onClick={close}>Cancel</Button>
            <Button {...kind('other')} type="button" data-drift-choice="keep" onClick={() => choose('keep')}>Start anyway</Button>
            <ReplaceAndStart />
          </Modal.Footer>
        </Modal.Form>
      </Modal.Content>
    </Modal>
  );
}

/**
 * Replace and start, the default, which takes focus once the dialog has opened. The copied Modal focuses its first
 * tabbable element, the close button, as it opens, so this takes focus on the next task, after it.
 */
function ReplaceAndStart() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus());
    return () => clearTimeout(timer);
  }, []);
  return <Button {...kind('main')} ref={ref} type="submit" data-drift-choice="replace">Replace and start</Button>;
}
