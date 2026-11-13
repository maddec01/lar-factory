Ported from mattpocock/skills (skills/engineering/prototype); see UPSTREAM.md.

# Logic prototype

Answer one business-logic/state/data-shape question with a self-contained HTML
file a non-developer can operate. Appearance questions use
[UI prototype](prototype-ui.md). At the top, visibly state the model and question
in one paragraph so the user can check the premise.

Put the logic in a small pure module in one script block. Choose a reducer for
discrete events, explicit states/transitions for legal-action questions, pure
functions for transformations, or a class/module when ongoing state is essential.
Choose for the question, not UI wiring convenience. The page calls this module;
the module knows no DOM, document or button handlers. Keep it portable as a
reference for later Build, with its HTML on the prototype branch.

Inline HTML, CSS and JavaScript in one file, without a framework/bundler/server
application. Serving for T3 preview is allowed. Use domain-language labels and
plain explanations. Arrange:
1. Title and one-line explanation of the question.
2. Full relevant state as labeled fields, not raw JSON, refreshed after each
   action; highlight what changed when useful.
3. Always-available free-play buttons for every action, usable in any order.
4. Tabbed guided scenarios with plain descriptions and ordered action buttons.
   Each step performs its action and advances; starting resets to a known state.

Include the happy path, awkward edge cases and an illegal-action attempt. Keep
clean typography, generous spacing and one accent color, without animations or
gimmicks. Show walkthroughs/free play inside T3 per
[Show variants](prototype-question.md#show-the-variants-inside-t3); add requested
actions/scenarios. Use memory unless persistence is the question. Add no tests,
generalization or real database dependency.

The owner records the answer/scenarios and branch in the local shaping result.
Keep the entire demo/module on that branch; leave product code unchanged. Later
Build uses the model as a reference with project checks/review, never ships the
HTML shell directly.
