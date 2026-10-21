# Mux factory plan

Written 2026-10-20. Nothing in this plan has been applied yet. Start once the
open PRs (mux-server #126, mux-apple #89) are merged, so the new rules start
on a clean `main`.

Owner tags: **Claude** means an agent does it. **You** means only you can do it.
**Claude, you approve** means an agent prepares it and applies it after you say go.

## What we agreed

- Every commit from a PR lands on `main` by rebase merge, in a linear history.
  Every commit and every PR title follows conventional commits; PR titles
  become the release notes. (Changed 2026-10-21 from merge commits.)
- Nobody pushes to `main`, including you and agents. Agents push as your
  GitHub account, so a bypass for you is a bypass for them.
- You cut releases by hand. Release notes come from PR titles.
- GitHub Issues hold the work, one repo per platform. One GitHub Project
  ("Mux") spans every repo and is the board.
- Nothing starts until you move it to Queued. You start queued items with
  `/mux-work <issue>` in a new T3 thread. Automatic pickup with a limit comes later.
- The `mux-work` skill sizes an item up and picks one of three routes: clear,
  needs decisions, or foggy. Foggy work becomes a parent issue whose body is
  the map, with decision and build sub-issues linked by blocked-by.
- Builds pass four reviewers (code, security, UX, UI), then an approver opens
  the PR and sends it to Verify or Ready to merge. You merge every PR.
- `mux-factory` is one public repo that holds the skills, agents, and a local
  board app that refreshes itself. Skills install globally with `npx skills`.
- Copied Matt Pocock and Addy Osmani skills are owned by you. Upstream changes
  come in only when you pick them.

## Before starting (You)

1. Done 2026-10-20: `gh` has the `project` scope.
2. Done 2026-10-20: T3 Remote Control is connected.
3. Export your current notes list (the ideas, bugs and findings) to a text or
   Markdown file, or paste it into a thread. Claude turns it into issues in
   phase 3.

## Phase 1: GitHub rules, commits and releases

Order matters here. The conventional-commit check must exist on `main` before a
ruleset requires it, or nothing can merge.

### mux-server

Current state, read from the API: two rulesets on `main`. "Main verification"
requires a PR and four checks, but you have an "always" bypass, which is how
direct pushes still happen. "Main merge and push permissions" limits who can
update `main`. Merge commits are titled "Merge pull request #n from …".

1. **Claude, you approve.** Repo settings: rebase merge only (turn off merge
   commits and squash). Keep "delete branch on merge" on.
2. **Claude.** PR `ci: check conventional commits`:
   - a workflow on the Unraid runner that checks the PR title and every commit
     in the PR against the conventional format, and rejects merge commits made
     inside the branch (branches are updated by rebase, not by merging `main`);
   - `AGENTS.md`: the commit format, the list of scopes (crate and area names
     such as `api`, `auth`, `web`, `video`, `ci`), "update your branch by
     rebase", and "agents may push branches and open PRs, never `main`" in
     place of "never commit or push";
   - `docs/agents/issue-tracker.md` and `triage-labels.md`: replace the triage
     labels with the Project's Status column and the new labels (phase 3).
3. **You.** Merge that PR.
4. **Claude, you approve.** Update the "Main verification" ruleset: allow only
   the merge method `rebase`, add the conventional-commit check to the required
   checks, and remove your bypass.
5. **Claude.** PR `ci: add manual release workflow`:
   - "Prepare release" (you run it, entering a version such as `0.2.0`) opens a
     PR `chore(release): v0.2.0` that bumps the version in `Cargo.toml` and
     `web/package.json`, with a preview of the release notes in its body;
   - when that PR merges, "Publish release" tags `v0.2.0`, creates the GitHub
     release with notes generated from the PR titles since the last tag, and
     re-tags the verified CI image for that commit as `:0.2.0` and `:latest`,
     reusing the existing verified-container script instead of rebuilding;
   - `.github/release.yml` groups the notes into Features, Fixes and Other,
     using labels a small workflow adds from each PR title's type;
   - the Unraid template (`packaging/unraid/mux-server.xml`) switches from
     `:edge` to `:latest`.
6. **You.** Merge it, then run "Prepare release" with `0.1.0` and merge the
   release PR. That creates the first tag, so later notes only cover new work.
7. **You.** On Unraid, change the installed container's repository tag from
   `:edge` to `:latest` (the template change only affects new installs).

### mux-apple

There is no CI and no protection on `main` today.

8. **Claude, you approve.** The same repo settings as step 1, and turn on
   "delete branch on merge".
9. **Claude.** PR `ci: check conventional commits` with the same check as step
   2, running on a GitHub-hosted Ubuntu runner (a few seconds per PR, no Mac
   runner), plus the same `AGENTS.md` and `docs/agents/` updates.
10. **You.** Merge it.
11. **Claude, you approve.** Create a ruleset on `main`: require a PR, require
    the conventional-commit check, allow only rebase merge, block force
    pushes, no bypass.

No releases for mux-apple until TestFlight is set up.

## Phase 2: the mux-factory repo and skills

12. **Claude, you approve.** Create `maddec01/mux-factory` as a **public** repo
    with issues turned on, so other people can report problems, and clone it to
    `~/Developer/Mux/mux-factory`. Same settings and ruleset as mux-apple. Add:
    - an MIT licence, and `THIRD_PARTY_NOTICES.md` with the MIT notices of
      `mattpocock/skills` and `addyosmani/agent-skills` (both checked: MIT);
    - issue templates for bug reports and feature requests;
    - a README that covers:
      - what the factory is and how an item moves through it, from List to
        Done;
      - installing: `npx skills add maddec01/mux-factory -g -s <names>`, and
        which skills are copies (with their upstream source) and which are
        Mux's own (`mux-work`, `skill-sync`);
      - updating: copies only change when a `skill-sync` PR merges, then
        `npx skills update -g` pulls the change;
      - avoiding conflicts: one source per skill name. Add Matt's or Addy's
        other skills by name only (`-s <name>`), never all at once, because
        that would switch the copies back to upstream;
      - Mux-specific rules live in `mux-work` and each repo's `AGENTS.md`,
        never in the copies;
      - running the board, and the credits and licences of the copied skills;
    - this plan, moved in as `docs/plan.md`.

    Nothing secret goes in the repo. The board reads your private repos through
    your local `gh` login, and `config` only names the repos.

    ```
    mux-factory/
      skills/
        grilling/, tdd/, ...  copies of Matt's and Addy's skills, original names
        mux-work/             the Mux work skill
          agents/             builder, reviewers (code, security, UX, UI), approver
        skill-sync/
      board/                  the local board app, its template, its saved-copy test
      config                  Mux repos and platforms, board refresh interval, limits
      UPSTREAM.md             source repo and commit for every copied skill
      THIRD_PARTY_NOTICES.md
      AGENTS.md
      README.md
    ```

    The build agents live inside `mux-work` as prompt files, because
    `npx skills` installs skills but not `.claude/agents` files. This way they
    install along with the skill.

13. **Claude.** Copy in the skills the factory uses, unchanged and with their
    original names, and record each upstream commit in `UPSTREAM.md`:
    - from Matt: `grilling`, `domain-modeling`, `prototype`, `research`,
      `diagnosing-bugs`, `tdd`, `code-review`, `codebase-design`,
      `writing-for-agents`, `pr`, `retro`, `handoff`;
    - from Addy: `code-review-and-quality`, `security-and-hardening`,
      `doubt-driven-development`, `frontend-ui-engineering`,
      `browser-testing-with-devtools`;
    - `developer-profile` stays in its own repo, as it is today.
14. **Claude.** Test the install with one skill before switching the rest:
    - run `npx skills add maddec01/mux-factory -g -s grilling`;
    - check that `~/.agents/.skill-lock.json` now lists `maddec01/mux-factory`
      as the source of `grilling`;
    - run `npx skills update -g` and check that Matt's version doesn't come
      back.

    If the CLI behaves differently, stop here and rethink before step 15.
15. **Claude, you approve.** Install the rest the same way, globally from your
    repo: the other copies from step 13, `mux-work`, and `skill-sync`.
    - The `skills` CLI keeps one source per skill name, so the copies now
      update from your repo, which only changes when you merge something.
      Their files match what's installed today, so your other projects behave
      the same.
    - `mux-work` has its own prefixed name, so it can never collide with
      anything.
    - Every other Matt skill (`wayfinder`, `to-spec`, `to-tickets`,
      `implement-spec`, `triage`, `grill-me` and the rest) stays installed from
      Matt for your other projects, and keeps updating from Matt. All of them
      have `disable-model-invocation: true`, so an agent never starts one by
      itself.
    - The rule from now on: add Matt skills by name only
      (`npx skills add mattpocock/skills -g -s <name>`), never all at once.
      Adding all of them would likely switch your copies back to Matt's.
16. **Claude.** Keep Mux-specific rules out of the copied skills, so the copies
    stay safe to use in every project. Conventional PR titles and branch
    cleanup (review fixes as `--fixup` commits folded in with
    `git rebase --autosquash`) go in each Mux repo's `AGENTS.md` and in the
    builder prompt inside `mux-work`, not in `pr`.
17. **Claude.** Write `skill-sync`. It compares each copied skill with the
    latest upstream version against the commit in `UPSTREAM.md` and lists the
    changes. You pick which ones to take. It merges them through a PR in
    `mux-factory` and updates `UPSTREAM.md`, then you run
    `npx skills update -g`.
18. **Claude.** Write the `mux-work` skill:
    - read the issue, the code and related docs, then propose a route (clear,
      needs decisions, foggy) in two or three lines for you to confirm;
    - clear and needs-decisions routes: grill in the same thread, build
      prototypes in a subagent so the thread stays small, and write the brief
      into the issue body (what, how to tell it is done, confirmed assumptions);
    - foggy route: the issue becomes the parent and its body the map
      (destination, decisions so far, fog, out of scope, and a Mermaid diagram
      redrawn from the sub-issues). It creates only the decision sub-issues it
      can phrase now, and starts research in the background with findings on a
      `research/<name>` branch. Build sub-issues appear as decisions close;
    - the gate: no unconfirmed assumptions, and a fresh-context check using
      `doubt-driven-development` before anything moves to Ready;
    - move the issue's Status at every step, and hand off to a fresh thread if
      the context passes about 150k tokens.
19. **Claude.** Write the build agent prompts in `mux-work/agents`:
    - builder: its own worktree, `tdd`, `developer-profile`, conventional
      commits, exploration notes for big builds;
    - reviewers in parallel: code (`code-review-and-quality` plus Matt's
      `code-review`), security (`security-and-hardening`), UX, and UI (T3
      browser preview for web, simulator through mux-apple's run scripts for
      Apple). At most two rework rounds;
    - approver: opens the PR, then sends it to Verify with test steps when the
      change is visible, something couldn't be checked by an agent, or it
      touches auth, migrations or deployment. Otherwise Ready to merge;
    - `retro` runs before the build thread closes.

## Phase 3: the board

20. **Claude.** Create the "Mux" Project (needs step 1 of "Before starting"):
    - Status column: List, Queued, Shaping, Needs you, Ready, In progress,
      Review, Verify, Ready to merge, Done;
    - views: Board, one per platform (filtered by repository), Concepts
      (parent issues with sub-issue progress, grouped by parent);
    - built-in workflows: auto-add issues from mux-server and mux-apple, and
      move to Done when an issue closes or its PR merges. GitHub limits how many
      auto-add workflows a free account gets; if it's one, `mux-work` adds
      items itself.
21. **Claude.** Create the same labels in every repo: `bug`, `feature`,
    `improvement`, `concept`, `decision: grill`, `decision: prototype`,
    `decision: research`, `decision: task`, `build`.
22. **Claude.** Turn your exported notes into issues in the right repos, all in
    List. Anything that doesn't fit one repo becomes a draft item in the
    Project. **You** check the result.
23. **Claude, then You.** Prototype three board layouts filled with your real
    issues. You pick one.
24. **Claude.** Build the board app in `mux-factory/board` (TypeScript, like
    `mux-server/web`):
    - a local server that reads the Project through `gh` every 30 to 60
      seconds and caches it;
    - the fixed template from step 23, using T3's theme colours, with sections
      Needs you, In flight, Concepts, Queued, and List counts per platform;
    - the page refreshes itself, and it can be opened in T3's browser preview;
    - a test that renders a sample file and compares it with a saved copy;
    - a launch agent so it starts when you log in.

## Phase 4: trial runs

25. **You, with Claude.** Run one small bug through `/mux-work`.
26. **You, with Claude.** Run one visual feature with prototypes.
27. **You, with Claude.** Run the Mux cloud concept (website sign-in and relay)
    as the first foggy item, using `docs/mux-hosted-services-todo.md` and
    `docs/mux-server-remote-access-plan.md` as input.
28. **You, with Claude.** After each run, `retro` suggests fixes to the skills.
    You pick which to apply.

## Later, when you want it

- Buttons on the board ("Queue", "Start"). First check how something outside
  T3 can start a thread, and whether a `t3-thread://` link opens T3 from a
  browser.
- A scheduled T3 task that starts the next Queued item while fewer than 2 items
  are in Shaping, In progress or Review, and pauses while Needs you holds more
  than 3. Both limits live in `mux-factory/config`. Not now: for now you start
  every item yourself.
- Releases and builds for mux-apple once TestFlight and the developer account
  are ready.

## Decided

- GitHub release notes are enough. No `CHANGELOG.md` file.
- No automatic pickup for now. When it comes, the limit is 2 items in flight.
- Matt skills the factory doesn't use stay installed globally for your other
  projects (step 15).
- `mux-factory` is public, with issues open for other people's reports.
- Copied skills keep their original names and install from your repo.
  Mux-specific skills use a `mux-` prefix.
