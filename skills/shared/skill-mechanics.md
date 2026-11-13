Ported from mattpocock/skills (skills/productivity/writing-for-agents/SKILL-MECHANICS.md); see UPSTREAM.md.

# Skill mechanics

Apply [Write agent docs](write-agent-docs.md) to the body and pointers.

For autonomous or cross-skill invocation, omit `disable-model-invocation` and
write a model-facing description with each trigger branch. The description is
always-loaded context. Humans can still invoke the skill explicitly.

For manual-only invocation, set `disable-model-invocation: true`. Its description
is a human-facing one-line summary, without trigger lists. The human must
remember it; another skill cannot invoke it. Put reference shared by manual-only
skills in a plain file both can link.

Split out a model-invoked skill only for an independently useful trigger used
in actual prompts, or necessary cross-skill reach. Its extra description must
earn its permanent context cost. A manual router can help humans choose among
many manual skills by naming them and their conditions; it cannot invoke them.
