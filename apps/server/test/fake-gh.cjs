#!/usr/bin/env node
// Test-only GitHub transport. Never contacts GitHub.
const fs = require('node:fs');
const args = process.argv.slice(2);
const options = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', JSON.stringify(args) + '\n');
const output = (value) => process.stdout.write(JSON.stringify(value));
const OPTIONS = [{ id: 'LIST_1', name: 'List' }, { id: 'QUEUED_1', name: 'Queued' }, { id: 'IN_PROGRESS_1', name: 'In progress' }];
const main = async () => {
  if (args[0] === '--version') return void process.stdout.write(`gh version ${options.ghVersion ?? '2.96.0'} (2026-09-01)\n`);
  if (args[0] === 'auth' && args[1] === 'status') {
    if (options.ghAuth === 'logged-out') process.stderr.write('You are not logged into any GitHub hosts. To log in, run: gh auth login\n');
    else if (options.ghAuth === 'failed') process.stderr.write('error connecting to api.github.com\n');
    else {
      // ghScopes null prints no scopes line, as for GH_TOKEN.
      const scopes = options.ghScopes === undefined ? "'project', 'repo'" : options.ghScopes;
      return void process.stdout.write(`github.com\n  ✓ Logged in to github.com account maddec01\n${scopes === null ? '' : `  - Token scopes: ${scopes}\n`}`);
    }
    process.exitCode = 1;
    return;
  }
  // A repository's .lar-factory.json from its default branch: options.repoConfigs holds each one's, by owner/name,
  // null for none (a 404), false for a read that fails; any other repository reads the lar Project.
  const configPath = args[0] === 'api' && !args.includes('PUT') && /^repos\/([\w.-]+\/[\w.-]+)\/contents\/\.lar-factory\.json$/.exec(args[1]);
  if (configPath) {
    const repo = configPath[1];
    const config = options.repoConfigs && repo in options.repoConfigs ? options.repoConfigs[repo]
      : { version: 1, role: `${repo}'s role`, itemSource: { kind: 'github-project', owner: 'maddec01', number: 1 } };
    if (config === false) {
      process.stderr.write('HTTP 502: Bad Gateway\n');
      process.exitCode = 1;
      return;
    }
    if (config === null) {
      process.stderr.write('gh: Not Found (HTTP 404)\n');
      process.exitCode = 1;
      return;
    }
    return void process.stdout.write(typeof config === 'string' ? config : JSON.stringify(config));
  }
  // Whether the login can push to a repository: options.canPush, true unless it says false.
  if (args[0] === 'api' && /^repos\/[\w.-]+\/[\w.-]+$/.test(args[1]) && args.includes('.permissions.push')) {
    return void process.stdout.write(`${options.canPush !== false}\n`);
  }
  // Onboarding's PR: the default branch is main at commit abc123, and options.fail names the call that fails. An
  // opened PR goes in options.prs, by URL, with its state, which a test changes to MERGED to merge it; gh pr close and
  // gh pr reopen change it too. options.branches holds the lar-factory/ branches that exist, each with its open PR's
  // URL or null.
  const fail = (call, text) => {
    if (options.fail !== call) return false;
    process.stderr.write(text);
    process.exitCode = 1;
    return true;
  };
  if (args[0] === 'api' && /^repos\/[\w.-]+\/[\w.-]+$/.test(args[1]) && args.includes('.default_branch')) return void process.stdout.write('main\n');
  if (args[0] === 'api' && /\/git\/ref\/heads\/main$/.test(args[1])) return void process.stdout.write('abc123\n');
  // The default branch's files at abc123: options.files, or none.
  if (args[0] === 'api' && /\/git\/trees\/abc123\?recursive=1$/.test(args[1])) {
    return void (fail('tree', 'HTTP 502: Bad Gateway\n') || output({ truncated: false, tree: (options.files ?? []).map((path) => ({ path, type: 'blob' })) }));
  }
  const ref = args[0] === 'api' && /\/git\/ref\/heads\/(lar-factory\/.+)$/.exec(args[1])?.[1];
  if (ref) {
    if (options.branches && ref in options.branches) return void process.stdout.write('def456\n');
    process.stderr.write('gh: Not Found (HTTP 404)\n');
    process.exitCode = 1;
    return;
  }
  if (args[0] === 'pr' && args[1] === 'list' && args.includes('--head')) {
    return void process.stdout.write(`${options.branches?.[args[args.indexOf('--head') + 1]] ?? ''}\n`);
  }
  if (args[0] === 'pr' && (args[1] === 'close' || args[1] === 'reopen')) {
    if (fail(`pr-${args[1]}`, 'HTTP 403: Resource not accessible by integration\n')) return;
    options.prs = { ...options.prs, [args[2]]: args[1] === 'close' ? 'CLOSED' : 'OPEN' };
    return void fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
  }
  if (args[0] === 'api' && /\/git\/refs$/.test(args[1])) return void (fail('branch', 'gh: Reference already exists (HTTP 422)\n') || output({}));
  if (args[0] === 'api' && args[1].endsWith('/contents/.lar-factory.json') && args.includes('PUT')) return void (fail('file', 'HTTP 409: Conflict\n') || output({}));
  if (args[0] === 'pr' && args[1] === 'create') {
    if (fail('pr-create', 'pull request create failed: GraphQL: No commits between main and lar-factory/onboarding\n')) return;
    const url = `https://github.com/${args[args.indexOf('-R') + 1]}/pull/77`;
    options.prs = { ...options.prs, [url]: 'OPEN' };
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return void process.stdout.write(`${url}\n`);
  }
  if (args[0] === 'pr' && args[1] === 'view') return void process.stdout.write(`${options.prs?.[args[2]] ?? 'OPEN'}\n`);
  if (args[1] === 'graphql') {
    if (options.fail === 'read') {
      process.stderr.write('HTTP 502: Bad Gateway');
      process.exitCode = 1;
      return;
    }
    if (args.some((a) => a.includes('projectsV2(first:'))) return output({ data: { user: { projectsV2: { nodes: [{ number: 1, title: 'lar' }] } } } });
    if (args.some((a) => a.includes('search(type: ISSUE'))) {
      const label = ['build', 'blocked', 'active'].find((l) => args.some((a) => a.includes(`label:${l} `)));
      const nodes = { build: options.builds, blocked: options.blocked, active: options.active }[label];
      return output({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nodes ?? [] } } });
    }
    // A repository's issues: options.repoIssues holds each repository's, by owner/name, in either state.
    if (args.some((a) => a.includes('repository(owner:'))) {
      const value = (key) => args.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);
      const states = args.filter((a) => a.startsWith('states[]=')).map((a) => a.slice('states[]='.length));
      const since = value('since');
      const nodes = (options.repoIssues?.[`${value('owner')}/${value('name')}`] ?? [])
        .filter((issue) => states.includes(issue.state) && (!since || issue.updatedAt >= since))
        .map((issue) => ({ ...issue, body: undefined }));
      return output({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } });
    }
    // Dossier bodies by node id; the project read below leaves bodies out, as the real query does.
    if (args.some((a) => a.includes('nodes(ids:'))) {
      const ids = args.filter((a) => a.startsWith('ids[]=')).map((a) => a.slice('ids[]='.length));
      const contents = [...(options.items ?? []).map((i) => i.content), ...Object.values(options.repoIssues ?? {}).flat()];
      const nodes = ids.map((id) => contents.find((c) => c?.id === id)).map((c) => c && { id: c.id, body: c.body ?? '' });
      return output({ data: { nodes } });
    }
    if (options.readDelay) {
      // Two project reads at once log an overlap, so tests can check the board never runs them together.
      const lock = process.env.FAKE_GH_STATE + '.reading';
      try { fs.writeFileSync(lock, '', { flag: 'wx' }); } catch { fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', '["overlap"]\n'); }
      await new Promise((r) => setTimeout(r, options.readDelay));
      fs.rmSync(lock, { force: true });
    }
    return output({ data: { user: { projectV2: { title: 'lar',
      items: { pageInfo: { hasNextPage: false, endCursor: null },
        nodes: (options.items ?? []).map(({ content, ...item }) => ({ ...item, content: content && { ...content, body: undefined } })) } } } } });
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
  if (args[0] === 'issue' && args[1] === 'edit') {
    if (options.fail === 'label') {
      process.stderr.write('HTTP 403: Resource not accessible by integration');
      process.exitCode = 1;
      return;
    }
    // Later reads see the labels added and removed, like GitHub, on the Project's items and the repositories' issues.
    const contents = [...(options.items ?? []).map((i) => i.content), ...(options.repoIssues?.[args[4]] ?? [])];
    const content = contents.find((c) => c?.number === Number(args[2]) && c.repository?.nameWithOwner === args[4]);
    const values = (flag) => args.filter((_, i) => args[i - 1] === flag);
    if (content) {
      const kept = content.labels.nodes.filter((l) => !values('--remove-label').includes(l.name));
      content.labels.nodes = [...kept, ...values('--add-label').filter((name) => !kept.some((l) => l.name === name)).map((name) => ({ name }))];
    }
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return;
  }
  // A label check: options.repoLabels holds the labels each repository has, by owner/name; any other is missing.
  const labelPath = args[0] === 'api' && /^repos\/([\w.-]+\/[\w.-]+)\/labels\/([^/]+)$/.exec(args[1]);
  if (labelPath) {
    if (!(options.repoLabels?.[labelPath[1]] ?? []).includes(labelPath[2])) {
      process.stderr.write('HTTP 404: Not Found');
      process.exitCode = 1;
      return;
    }
    return output({ name: labelPath[2] });
  }
  if (args[0] === 'label' && args[1] === 'create') {
    if (options.fail === 'label-create') {
      process.stderr.write('HTTP 403: Must have admin rights to Repository.');
      process.exitCode = 1;
      return;
    }
    const repo = args[args.indexOf('-R') + 1];
    options.repoLabels = { ...options.repoLabels, [repo]: [...(options.repoLabels?.[repo] ?? []), args[2]] };
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return;
  }
  // An issue read: options.issues holds the labels of issues off the project.
  if (args[0] === 'api' && /^repos\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(args[1])) {
    const issue = options.issues?.[args[1].slice('repos/'.length)];
    if (!issue) {
      process.stderr.write('HTTP 404: Not Found');
      process.exitCode = 1;
      return;
    }
    return output(issue);
  }
  if (options.writeDelay && ['item-edit', 'delete', 'item-delete'].includes(args[1])) await new Promise((r) => setTimeout(r, options.writeDelay));
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
    return output({ number: 900001, node_id: 'I_900001', html_url: `https://github.com/${repo}/issues/900001`, updated_at: '2026-10-21T10:00:00Z' });
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
