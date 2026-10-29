import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item } from '@lar-factory/shared';
import { createItemDetails } from './item-details.ts';

const workItem = { id: 'azure:contoso/5', content: 'ticket', repo: 'contoso/Fabrikam%20Fiber/lar-api', number: 5 } as Item;

test('an Azure DevOps save without the field and revision its details gave is refused before az runs', async () => {
  const { saveDescription } = createItemDetails(null);
  const refused = { status: 400, error: 'Send the field and revision the work item\'s details gave.' };
  assert.deepEqual(await saveDescription(workItem, { body: 'x' }), refused);
  assert.deepEqual(await saveDescription(workItem, { body: 'x', bodyField: 'System.Description' }), refused);
  assert.deepEqual(await saveDescription(workItem, { body: 'x', revision: 3 }), refused);
});

test('sample mode saves no description', async () => {
  assert.deepEqual(await createItemDetails('unused.json').saveDescription(workItem, { body: 'x' }), { status: 403, error: 'Saving descriptions is disabled in sample mode.' });
});
