# 2. Size up


Pick the route yourself; never ask the user to pick one by name. Ask them to
confirm it ([question UI](shared/questions.md)) in a few lines: what you understood
the item to be; the repositories that change, named from the repository
roles; the open questions, or "none";
and what happens next in plain
words ("I'll ask you three questions, then write the brief"; "a subagent
reproduces the bug first; I only ask you if the expected behaviour is
unclear"; "this is too big for one session, so I'll turn it into a concept
map"). Shaping ends at Ready, with the user starting each build from the board.

Add the kind label (`bug`, `feature`, `improvement`, `concept`), first running
[label setup](shared/issue-tracker/label-setup.md#label-setup) in the issue's repo if it lacks the
label. On Azure DevOps the kind is a tag, added with `retag`
([Tags](shared/issue-tracker/azure-devops.md#tags)), and needs no setup. Anything the user adds or corrects is another open question. Then:

- **Bug**: first a **Diagnose subagent** with [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) returns the
  cause, the evidence and a failing test to write; its open questions join the
  list.
- **Open questions**: settle every one here by [Grilling with docs](grilling-with-docs.md), for bugs
  and features alike. A question of how something looks or feels gets a
  **Prototype** child task with [prototype](skills/prototype/SKILL.md), started per
  [Orchestration](shared/orchestration.md): two or three variants differing only on
  that question; a logic or state question gets an HTML page. It keeps its
  screenshots in its own context and returns each variant's start command (or
  HTML path), the worktree path, the branch, a preferred port and a short
  description. Show the variants as below, ask for the user's pick, and record it
  and the branch on the issue.

  **Showing prototypes.** This thread, or the thread of a `decision-prototype`
  sub-issue, shows every variant inside T3 itself, since the preview and Device
  panel belong to the thread that opens them. The user never receives a file
  path, URL or run command, and nothing opens outside T3. This overrides the
  [prototype](skills/prototype/SKILL.md) skill where it tells the agent to hand the user a file, URL or
  command: `LOGIC.md` "3. Build the shareable HTML file", "4. Hand it over"
  and "Anti-patterns", `UI.md` "5. Hand it over" and `SKILL.md` "Rules that
  apply to both".
  - Run the variants from the child task's worktree. Start each server on a
    port where `lsof -ti tcp:<port> -sTCP:LISTEN` prints nothing, bound to
    `127.0.0.1`, and note the PID that holds the port, not a launcher's.
  - Web and HTML: open the URL with `preview_open` (absolute http(s) URL, never
    `file://`). Serve a static HTML file's folder with
    `python3 -m http.server --bind 127.0.0.1 --directory <dir> <port>`.
  - Native iOS or Android: run the build and install scripts named in the
    target repo's `t3.json` and `AGENTS.md`, one variant at a time, then
    `device_open` (`device_list` finds the device id).
  - Say in chat which variant is showing. For another round, send the request
    to a Prototype child task.
  - When the user picks, or the thread ends without a pick, stop exactly the
    noted PIDs. An app left installed on the simulator stays.
  - If `preview_open` or `device_open` is unavailable or fails, stop, tell
    the user why and ask how to go on per [Questions](shared/questions.md). Never fall
    back to anything outside T3.
- **Another repository changes** (its role says it serves or uses what this
  item changes): that work becomes a build there, a
  sub-issue of this issue that blocks it (reuse an open issue that covers it),
  with its own brief and gate. On Azure DevOps it's a child Task tagged
  `repo-<that repository>` that this item waits for
  ([Work in another repository](shared/issue-tracker/azure-devops.md#children-and-blockers)).
  This issue's build starts once that one closes
  (**5. Start the build**). This issue is a build only if its own repository
  changes.
- **No open questions**: write the brief.
- **Too big or unclear for one session**: [Concepts](concepts.md).
  Repository count never makes an issue a concept.

