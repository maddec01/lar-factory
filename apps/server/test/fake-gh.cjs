#!/usr/bin/env node
// Test-only GitHub transport. Never contacts GitHub.
const fs = require('node:fs');
const { dirname } = require('node:path');
const args = process.argv.slice(2);
const options = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
options.delayedRepos ??= (options.repositories ?? ['maddec01/lar-server', 'maddec01/lar-apple', 'maddec01/lar-factory']).filter((repo) => !(repo in (options.repoIssues ?? {})));
for (const { content } of options.items ?? []) {
  if (!content || content.__typename !== 'Issue') continue;
  const repo = content.repository.nameWithOwner;
  options.repoIssues ??= {};
  if (!options.repoIssues[repo]) options.repoIssues[repo] = [];
  if (!options.repoIssues[repo].some((issue) => issue.id === content.id)) options.repoIssues[repo].push(content);
}
delete options.items;
const output = (value) => process.stdout.write(JSON.stringify(value));
/** An issue as the board query reads it: no body, and its linked PRs by id without body or merge time. */
const read = (content) => ({ ...content, body: undefined, ...(content.closedByPullRequestsReferences && { closedByPullRequestsReferences: {
  nodes: content.closedByPullRequestsReferences.nodes.map(({ body, mergedAt, ...pr }) => ({ ...pr, id: pr.id ?? pr.url })) } }) });
/** A closed issue as the light queries read it: its close, its labels, and its parent's id and labels. */
const lightIssue = (issue) => {
  const parent = issue.parent && (options.repoIssues?.[issue.parent.repository.nameWithOwner] ?? []).find((p) => p.number === issue.parent.number);
  return { id: issue.id, closedAt: issue.closedAt ?? null, stateReason: issue.stateReason ?? null, labels: issue.labels,
    parent: issue.parent ? { id: parent?.id ?? `I_${issue.parent.number}`, labels: parent?.labels ?? { nodes: [] } } : null };
};
// GitHub's rate_limit costs no quota, so it stays out of the calls the tests count. options.remaining sets what is left.
if (args[0] === 'api' && args[1] === 'rate_limit') {
  const remaining = options.remaining ?? 5000;
  output({ resources: { core: { limit: 5000, remaining, reset: 1 }, graphql: { limit: 5000, remaining, reset: 1 } } });
  process.exit(0);
}
// A change check while nothing changed is a 304, which costs no quota either, so only an answer that changed is a call.
// options.changes sets the issues it lists.
if (args[0] === 'api' && args[1] === '-i') {
  if (!options.changes) {
    process.stderr.write('gh: HTTP 304\n');
    process.exit(1);
  }
  fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', JSON.stringify(args) + '\n');
  process.stdout.write(`HTTP/2.0 200 OK\r\nEtag: W/"${options.changes.length}"\r\n\r\n${JSON.stringify(options.changes)}`);
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', JSON.stringify(args) + '\n');
const WORKFLOW_LABELS = ['bug', 'feature', 'improvement', 'concept', 'decision-grill', 'decision-prototype', 'decision-research', 'decision-task',
  'build', 'active', 'blocked'];
const main = async () => {
  if (args[0] === '--version') return void process.stdout.write(`gh version ${options.ghVersion ?? '2.96.0'} (2026-09-01)\n`);
  if (args[0] === 'auth' && args[1] === 'status') {
    // options.authHold names a file the check waits for, as a slow gh.
    while (options.authHold && !fs.existsSync(options.authHold)) await new Promise((r) => setTimeout(r, 50));
    if (options.ghAuth === 'logged-out') process.stderr.write('You are not logged into any GitHub hosts. To log in, run: gh auth login\n');
    else if (options.ghAuth === 'failed') process.stderr.write('error connecting to api.github.com\n');
    else return void process.stdout.write('github.com\n  ✓ Logged in to github.com account maddec01\n');
    process.exitCode = 1;
    return;
  }
  // A repository's .lar-factory.json from its default branch: options.repoConfigs holds each one's, by owner/name,
  // null for none (a 404), false for a read that fails; any other repository reads its issues.
  const configPath = args[0] === 'api' && !args.includes('PUT') && /^repos\/([\w.-]+\/[\w.-]+)\/contents\/\.lar-factory\.json$/.exec(args[1]);
  if (configPath) {
    const repo = configPath[1];
    const config = options.repoConfigs && repo in options.repoConfigs ? options.repoConfigs[repo]
      : { version: 1, role: `${repo}'s role`, itemSource: { kind: 'issues' } };
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
  // What the login may do in a repository: push and triage unless options.canPush says false, with issues turned on.
  if (args[0] === 'api' && /^repos\/[\w.-]+\/[\w.-]+$/.test(args[1]) && args.some((a) => a.includes('.permissions.push'))) {
    return void output({ push: options.canPush !== false, triage: options.canPush !== false, issues: true });
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
    return void (fail('tree', 'HTTP 502: Bad Gateway\n') || output({ sha: 'tree0', truncated: false,
      tree: (options.files ?? []).map((path) => ({ path, mode: '100644', type: 'blob', sha: `blob-${path}` })) }));
  }
  if (args[0] === 'api' && /\/git\/blobs\/blob-/.test(args[1])) return void process.stdout.write(`# ${args[1].split('/git/blobs/blob-')[1]}\n`);
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
  // Onboarding's PR commit: its tree, then the commit, each answered with its SHA.
  if (args[0] === 'api' && /\/git\/trees$/.test(args[1])) return void process.stdout.write('tree1\n');
  if (args[0] === 'api' && /\/git\/commits$/.test(args[1])) return void process.stdout.write('commit1\n');
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
    // A search for a repository's issues closed in a close-date range, `closed:<from>..<to>` or `closed:>=<from>`, read
    // light; options.unindexed names the issues the search index doesn't list yet.
    const q = args.find((a) => a.startsWith('q='))?.slice(2) ?? '';
    if (args.some((a) => a.includes('search(type: ISSUE')) && q.includes('is:closed')) {
      const [from, to] = /closed:(?:>=)?(\S+?)(?:\.\.(\S+))?(?:\s|$)/.exec(q).slice(1);
      const nodes = (options.repoIssues?.[/repo:(\S+)/.exec(q)[1]] ?? []).filter((issue) => issue.state === 'CLOSED' && issue.closedAt
        && Date.parse(issue.closedAt) >= Date.parse(from) && (!to || Date.parse(issue.closedAt) <= Date.parse(to)) && !options.unindexed?.includes(issue.id))
        .map(lightIssue);
      return output({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
    }
    if (args.some((a) => a.includes('search(type: ISSUE'))) {
      const label = ['build', 'blocked', 'active'].find((l) => args.some((a) => a.includes(`label:${l} `)));
      const nodes = { build: options.builds, blocked: options.blocked, active: options.active }[label];
      return output({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nodes ?? [] } } });
    }
    // Linked PRs by node id, a PR's url when the test gave it no id, with only their body and merge time; the reads
    // below leave both out, as the real board query does.
    if (args.some((a) => a.includes('... on PullRequest { id body mergedAt }'))) {
      const ids = args.filter((a) => a.startsWith('ids[]=')).map((a) => a.slice('ids[]='.length));
      const prs = Object.values(options.repoIssues ?? {}).flat()
        .flatMap((c) => c?.closedByPullRequestsReferences?.nodes ?? []);
      const nodes = ids.map((id) => prs.find((pr) => (pr.id ?? pr.url) === id)).map((pr) => pr && { id: pr.id ?? pr.url, body: pr.body, mergedAt: pr.mergedAt ?? null });
      return output({ data: { nodes } });
    }
    // A repository's issues: options.repoIssues holds each repository's, by owner/name, in either state. The open page
    // reads them in full; the light page of closed ones, which reads no sub-issues, gets each one's close, labels, and
    // its parent's id and labels.
    if (args.some((a) => a.includes('repository(owner:'))) {
      const readingRepo = ['owner', 'name'].map((key) => args.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1)).join('/');
      // While the file options.readHold names exists, a read of open issues waits for its removal, between a held and
      // a released entry in the calls, so a test decides when the read ends instead of guessing how long it takes.
      if (options.readHold && fs.existsSync(options.readHold) && args.some((a) => a.includes('states: [OPEN]'))) {
        fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', '["held"]\n');
        await new Promise((resolve) => {
          const ready = () => {
            if (!fs.existsSync(options.readHold)) { watcher.close(); resolve(); }
          };
          const watcher = fs.watch(dirname(options.readHold), ready);
          ready();
        });
        fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', '["released"]\n');
      }
      if (options.readDelay && options.delayedRepos.includes(readingRepo) && args.some((a) => a.includes('states: [OPEN]'))) {
        const lock = process.env.FAKE_GH_STATE + '.reading-' + encodeURIComponent(readingRepo);
        try { fs.writeFileSync(lock, '', { flag: 'wx' }); } catch { fs.appendFileSync(process.env.FAKE_GH_STATE + '.calls', '["overlap"]\n'); }
        await new Promise((r) => setTimeout(r, options.readDelay));
        fs.rmSync(lock, { force: true });
      }
      const value = (key) => args.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);
      const light = !args.some((a) => a.includes('subIssues('));
      const state = light ? 'CLOSED' : 'OPEN';
      const since = value('since');
      const issues = options.repoIssues?.[`${value('owner')}/${value('name')}`] ?? [];
      const nodes = issues.filter((issue) => issue.state === state && (!since || issue.updatedAt >= since)).map((issue) => (light ? lightIssue(issue) : read(issue)));
      return output({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } });
    }
    // Repository issues by node id, read in full without their bodies; an id no issue has resolves to null.
    if (args.some((a) => a.includes('nodes(ids:') && a.includes('subIssues('))) {
      const ids = args.filter((a) => a.startsWith('ids[]=')).map((a) => a.slice('ids[]='.length));
      const issues = Object.values(options.repoIssues ?? {}).flat();
      return output({ data: { nodes: ids.map((id) => issues.find((issue) => issue.id === id)).map((issue) => (issue ? read(issue) : null)) } });
    }
    // One item's details by node id: options.details holds each item's node, by id; an item it doesn't name is not found.
    if (args.some((a) => a.includes('node(id:'))) {
      const id = args.find((a) => a.startsWith('id='))?.slice('id='.length);
      return output({ data: { node: options.details?.[id] ?? null } });
    }
    // Dossier bodies by node id; repository issue reads leave bodies out, as the real query does.
    if (args.some((a) => a.includes('nodes(ids:'))) {
      const ids = args.filter((a) => a.startsWith('ids[]=')).map((a) => a.slice('ids[]='.length));
      const contents = Object.values(options.repoIssues ?? {}).flat();
      const nodes = ids.map((id) => contents.find((c) => c?.id === id)).map((c) => c && { id: c.id, body: c.body ?? '' });
      return output({ data: { nodes } });
    }
    throw new Error('Unexpected fake GraphQL query');
  }
  // A work record's observation of its ticket: open with no one assigned.
  if (args[0] === 'issue' && args[1] === 'view' && args.includes('state,assignees')) return output({ state: 'OPEN', assignees: [] });
  // The ticket picker's search and a pick's read, of options.repoIssues: open issues whose title has every word, and one issue by number.
  if (args[0] === 'issue' && (args[1] === 'list' || args[1] === 'view')) {
    const issues = options.repoIssues?.[args[args.indexOf('-R') + 1]] ?? [];
    if (args[1] === 'view') {
      const issue = issues.find((i) => i.number === Number(args[2]));
      if (!issue) {
        process.stderr.write(`GraphQL: Could not resolve to an issue or pull request with the number of ${args[2]}.`);
        process.exitCode = 1;
        return;
      }
      return output({ number: issue.number, title: issue.title, url: issue.url, body: issue.body ?? '', labels: issue.labels?.nodes ?? [], state: issue.state });
    }
    const words = (args.includes('--search') ? args[args.indexOf('--search') + 1] : '').toLowerCase().split(/\s+/).filter(Boolean);
    return output(issues.filter((i) => i.state === 'OPEN' && words.every((w) => i.title.toLowerCase().includes(w)))
      .map((i) => ({ number: i.number, title: i.title, url: i.url })));
  }
  if (options.fail === 'abandon' && args[1] === 'close') {
    process.stderr.write('HTTP 403: Must have write access to Repository.');
    process.exitCode = 1;
    return;
  }
  // A description save writes the body file to the issue's details node, so a later details read answers it.
  if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--body-file')) {
    if (options.fail === 'body') {
      process.stderr.write('HTTP 403: Resource not accessible by integration');
      process.exitCode = 1;
      return;
    }
    const content = (options.repoIssues?.[args[4]] ?? []).find((c) => c?.number === Number(args[2]));
    const node = content && options.details?.[content.id];
    if (node) node.body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return;
  }
  if (args[0] === 'issue' && args[1] === 'edit') {
    if (options.writeDelay) await new Promise((r) => setTimeout(r, options.writeDelay));
    if (options.fail === 'label' || options.fail === 'status' && args.some((a) => a.startsWith('status-'))) {
      process.stderr.write('HTTP 403: Resource not accessible by integration');
      process.exitCode = 1;
      return;
    }
    // Later reads see the labels added and removed on the repositories' issues, like GitHub.
    const contents = (options.repoIssues?.[args[4]] ?? []);
    const content = contents.find((c) => c?.number === Number(args[2]) && c.repository?.nameWithOwner === args[4]);
    const values = (flag) => args.filter((_, i) => args[i - 1] === flag);
    if (content && !options.ignoreEdits) {
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
  // gh label list lists every workflow label for a repository options.repoLabels doesn't name, so onboarding can finish.
  if (args[0] === 'label' && args[1] === 'list') return output((options.repoLabels?.[args[args.indexOf('-R') + 1]] ?? WORKFLOW_LABELS).map((name) => ({ name })));
  // A label's name comes after --, for gh label create and gh label edit alike.
  const named = args[args.indexOf('--') + 1];
  if (args[0] === 'label' && args[1] === 'edit') {
    const repo = args[args.indexOf('--repo') + 1];
    const to = args.find((a) => a.startsWith('--name=')).slice('--name='.length);
    options.repoLabels = { ...options.repoLabels, [repo]: (options.repoLabels?.[repo] ?? []).map((name) => name === named ? to : name) };
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return;
  }
  if (args[0] === 'label' && args[1] === 'create') {
    if (options.fail === 'label-create') {
      process.stderr.write('HTTP 403: Must have admin rights to Repository.');
      process.exitCode = 1;
      return;
    }
    const repo = args[args.indexOf('-R') + 1];
    options.repoLabels = { ...options.repoLabels, [repo]: [...(options.repoLabels?.[repo] ?? []), named] };
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return;
  }
  // An issue read: options.issues can override its labels.
  if (args[0] === 'api' && /^repos\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(args[1])) {
    const [, owner, repo, , number] = args[1].split('/');
    const content = options.repoIssues?.[`${owner}/${repo}`]?.find((issue) => issue.number === Number(number));
    const issue = options.issues?.[args[1].slice('repos/'.length)] ?? (content && { labels: content.labels.nodes });
    if (!issue) {
      process.stderr.write('HTTP 404: Not Found');
      process.exitCode = 1;
      return;
    }
    return output(issue);
  }
  if (options.writeDelay && ['edit', 'close'].includes(args[1])) await new Promise((r) => setTimeout(r, options.writeDelay));
  // Deletes leave options.items alone, like a GitHub read that still lags behind.
  if (args[0] === 'issue' && args[1] === 'close') return;
  // A PR read: options.liveBodies holds bodies edited since the board's read.
  if (args[0] === 'api' && /^repos\/[\w.-]+\/[\w.-]+\/pulls\/\d+$/.test(args[1])) {
    if (options.prReadDelay) await new Promise((r) => setTimeout(r, options.prReadDelay));
    const url = `https://github.com/${args[1].slice('repos/'.length).replace('/pulls/', '/pull/')}`;
    const read = Object.values(options.repoIssues ?? {}).flat().flatMap((issue) => issue.closedByPullRequestsReferences?.nodes ?? []).find((pr) => pr.url === url);
    return output({ url, body: options.liveBodies?.[url] ?? read?.body ?? null });
  }
  if (args[0] === 'api' && args[2] === 'PATCH') {
    if (options.prEditHold) await new Promise((resolve) => {
      const ready = () => {
        if (fs.existsSync(options.prEditHold)) { watcher.close(); resolve(); }
      };
      const watcher = fs.watch(dirname(options.prEditHold), ready);
      ready();
    });
    if (options.fail === 'pr-edit') {
      process.stderr.write('HTTP 502: Bad Gateway');
      process.exitCode = 1;
      return;
    }
    // Later reads see the new body, like GitHub.
    const url = `https://github.com/${args[3].slice('repos/'.length).replace('/pulls/', '/pull/')}`;
    const body = args[args.indexOf('-f') + 1].slice('body='.length);
    for (const item of Object.values(options.repoIssues ?? {}).flat()) {
      for (const pr of item.closedByPullRequestsReferences?.nodes ?? []) if (pr.url === url) pr.body = body;
    }
    if (options.liveBodies?.[url] !== undefined) options.liveBodies[url] = body;
    fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(options));
    return output({});
  }
  if (args[0] === 'api') {
    const repo = args[3].slice('repos/'.length, -'/issues'.length);
    return output({ number: 900001, node_id: 'I_900001', html_url: `https://github.com/${repo}/issues/900001`, updated_at: '2026-10-21T10:00:00Z' });
  }
  throw new Error('Unexpected fake gh command');
};
main().catch((err) => { console.error(err); process.exitCode = 1; });
