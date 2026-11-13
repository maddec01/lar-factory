Ported from mattpocock/skills (skills/engineering/prototype); see UPSTREAM.md.

# Prototype

Answer one question with throwaway code. Logic/state/data questions use
[Logic prototype](prototype-logic.md), a single HTML demo. Appearance/interaction
questions use [UI prototype](prototype-ui.md), two or three structural variants.
Resolve ambiguity from the prompt/code or ask; if the user is absent, choose the
closest branch and state the assumption at the top of the prototype.

Keep clearly named prototype code near its intended module/page, following
existing routing conventions. Make it run with one project-task command or an
HTML file. Use memory only, except persistence questions may use a clearly
marked disposable database/file. Add no tests, abstractions or error handling
beyond what makes it runnable. Show full relevant state after each action or
variant switch. Commit all artifacts on `prototype/<slug>`, leaving product
code unchanged. The owner records the pick in Confirmed/answer and the branch
in builder notes; later Build implements it properly.

Run no project-wide tests, typecheck, lint or unused-code check, even if project
change instructions ask for them. Build only what startup needs. Drive every
variant/walkthrough and the interaction being studied once. Fix failures or
report them. Follow orchestration's heavy-command rules.

The child returns worktree, branch, preferred port, each variant's command or
HTML path and short description, leaving no server running. Screenshots stay
in the child's context. The owner presents variants and asks for the pick.

## Show the variants inside T3

Show every variant inside T3, never just give the user a path/URL/command or open
an external viewer. Follow T3's current preview/device instructions.
Run from the child's worktree. For a needed server, choose a free port using
`lsof -ti tcp:<port> -sTCP:LISTEN`, bind `127.0.0.1` and record the listening PID.
Use `preview_open` for HTTP(S), never `file://`. If the preview tools require
serving HTML, serve only its folder with `python3 -m http.server --bind
127.0.0.1 --directory <dir> <port>`.

For iOS/Android, use project build/install scripts or infer them from manifests,
one variant at a time; use `device_list` and `device_open`. Name the visible
variant in chat. Delegate another Prototype task for a new round. On a pick or
thread end, stop only recorded owned PIDs; installed simulator apps may remain.
If preview/device tools fail or are unavailable, report why and ask through
[Questions](shared/questions.md), without falling back outside T3.
