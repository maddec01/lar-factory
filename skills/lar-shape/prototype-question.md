Ported from mattpocock/skills (skills/engineering/prototype); see UPSTREAM.md.

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [prototype-logic.md](prototype-logic.md). Build a single shareable HTML file (free-play buttons plus tabbed guided walkthroughs) that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [prototype-ui.md](prototype-ui.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious, but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **Trivial to run.** A UI prototype starts from one command in the project's task runner: `pnpm <name>`, `python <path>`, `bun <path>`, etc. A logic demo is a single HTML file shown inside T3. Either way, no thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** Fold any validated decision into the real code, then capture the prototype itself as a **primary source**: commit it to a `prototype/<slug>` branch, out of main, and leave a context pointer to that branch in the work record's brief or decision answer. Capture the answer too (the verdict and the question it settled) in the work record or a commit. The main branch keeps only the validated decision.

## Show the variants inside T3

The Prototype child returns each variant's start command or HTML path, worktree path, branch, preferred port and short description. Keep screenshots in the child's context. The shaping or decision thread shows every variant inside T3; never hand the user a path, URL or command or open anything outside T3.

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
