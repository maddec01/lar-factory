#!/usr/bin/env node
// Test-only GitHub transport. Never contacts GitHub.
const fs = require('node:fs');
const args = process.argv.slice(2);
const options = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', JSON.stringify(args) + '\n');
const output = (value) => process.stdout.write(JSON.stringify(value));
const OPTIONS = [{ id: 'LIST_1', name: 'List' }, { id: 'QUEUED_1', name: 'Queued' }];
const main = async () => {
  if (args[1] === 'graphql') {
    if (args.some((a) => a.includes('projectsV2(first:'))) return output({ data: { user: { projectsV2: { nodes: [{ number: 1, title: 'Mux' }] } } } });
    if (args.some((a) => a.includes('search(type: ISSUE'))) return output({ data: { search: { nodes: options.active ?? [] } } });
    if (options.readDelay) await new Promise((r) => setTimeout(r, options.readDelay));
    return output({ data: { user: { projectV2: { title: 'Mux', url: 'https://github.com/users/maddec01/projects/1',
      items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: options.items ?? [] } } } } });
  }
  if (args[1] === 'view') return output({ id: 'PVT_1' });
  if (args[1] === 'field-list') return output({ fields: [{ id: 'FIELD_1', name: 'Status', options: OPTIONS }] });
  if ((options.fail === 'membership' && args[1] === 'item-add') || (options.fail === 'status' && args[1] === 'item-edit')) {
    process.stderr.write('GitHub temporarily unavailable');
    process.exitCode = 1;
    return;
  }
  if (options.fail === 'delete' && (args[1] === 'delete' || args[1] === 'item-delete')) {
    process.stderr.write('HTTP 403: Must have admin rights to Repository.');
    process.exitCode = 1;
    return;
  }
  // Deletes leave options.items alone, like a GitHub read that still lags behind.
  if (args[0] === 'issue' && args[1] === 'delete') return;
  if (args[1] === 'item-delete') return output({});
  // A PR read: options.liveBodies holds bodies edited since the board's read.
  if (args[0] === 'api' && /^repos\/[\w.-]+\/[\w.-]+\/pulls\/\d+$/.test(args[1])) {
    const url = `https://github.com/${args[1].slice('repos/'.length).replace('/pulls/', '/pull/')}`;
    const read = (options.items ?? []).flatMap((item) => item.content?.closedByPullRequestsReferences?.nodes ?? []).find((pr) => pr.url === url);
    return output({ url, body: options.liveBodies?.[url] ?? read?.body ?? null });
  }
  if (args[0] === 'api' && args[2] === 'PATCH') {
    if (options.prEditDelay) await new Promise((r) => setTimeout(r, options.prEditDelay));
    if (options.fail === 'pr-edit') {
      process.stderr.write('HTTP 502: Bad Gateway');
      process.exitCode = 1;
      return;
    }
    // Later reads see the new body, like GitHub.
    const url = `https://github.com/${args[3].slice('repos/'.length).replace('/pulls/', '/pull/')}`;
    const body = args[args.indexOf('-f') + 1].slice('body='.length);
    for (const item of options.items ?? []) {
      for (const pr of item.content?.closedByPullRequestsReferences?.nodes ?? []) if (pr.url === url) pr.body = body;
    }
    if (options.liveBodies?.[url] !== undefined) options.liveBodies[url] = body;
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return output({});
  }
  if (args[0] === 'api') {
    if (options.createDelay) await new Promise((r) => setTimeout(r, options.createDelay));
    const repo = args[3].slice('repos/'.length, -'/issues'.length);
    return output({ number: 900001, html_url: `https://github.com/${repo}/issues/900001`, updated_at: '2026-10-21T10:00:00Z' });
  }
  if (args[1] === 'item-add') return output({ id: 'PVTI_900001' });
  if (args[1] === 'item-edit') {
    // Later reads report the edit, like GitHub, unless the test says they lag.
    const item = options.items?.find((i) => i.id === args[args.indexOf('--id') + 1]);
    if (item && !options.ignoreEdits) {
      item.status = { name: OPTIONS.find((o) => o.id === args[args.indexOf('--single-select-option-id') + 1]).name };
      fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    }
    return output({});
  }
  throw new Error('Unexpected fake gh command');
};
main().catch((err) => { console.error(err); process.exitCode = 1; });
