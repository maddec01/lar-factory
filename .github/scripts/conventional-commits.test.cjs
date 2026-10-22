const assert = require('node:assert/strict');
const { test } = require('node:test');
const { headerProblem, findProblems, commitMessageProblem } = require('./conventional-commits.cjs');

test('accepts conventional headers', () => {
    for (const header of ['feat: add rails', 'fix(video): keep depth', 'refactor(mux-db)!: drop table', 'ci: check commits']) {
        assert.equal(headerProblem(header), null, header);
    }
});

test('rejects other headers', () => {
    for (const header of ['Keep converted FLAC at depth', 'feature: x', 'fix(Video): x', 'fix:x', 'fix: ', `fix: ${'x'.repeat(100)}`]) {
        assert.notEqual(headerProblem(header), null, header);
    }
});

test('rejects merge, fixup and non-conventional commits and a bad title', () => {
    const problems = findProblems({
        title: 'Video reliability',
        commits: [
            { sha: 'a'.repeat(40), message: 'fix(video): retry titles\n\nbody', parents: 1 },
            { sha: 'b'.repeat(40), message: "Merge branch 'main' into x", parents: 2 },
            { sha: 'c'.repeat(40), message: 'fixup! fix(video): retry titles', parents: 1 },
            { sha: 'd'.repeat(40), message: 'Retry titles', parents: 1 },
        ],
    });
    assert.equal(problems.length, 4);
    assert.match(problems[0], /^PR title/);
    assert.match(problems[1], /^bbbbbbbb .*rebase/);
    assert.match(problems[2], /^cccccccc .*autosquash/);
    assert.match(problems[3], /^dddddddd /);
});

test('commit-msg hook accepts conventional and fixup messages, skipping comments', () => {
    for (const message of ['# Please enter\nfix(video): retry titles\n\nbody', 'fixup! fix(video): retry titles', 'amend! fix(video): x\n\nfix(video): y']) {
        assert.equal(commitMessageProblem(message), null, message);
    }
    assert.match(commitMessageProblem('Retry titles\n'), /^"Retry titles": /);
});
