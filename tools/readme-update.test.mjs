import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyProposal, buildPrompt, validateReadme } from './readme-update.mjs';

const original = `---
title: Example
description: Example repository
ms.date: 2026-01-01
---

## Overview

Original repository description with enough detail to preserve.

## License

Provided as-is.
`;

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'readme-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'README.md'), original);
  return root;
}

test('accepts unchanged output and a focused factual edit', (t) => {
  const root = fixture(t);
  validateReadme(original, original, root);
  validateReadme(original.replace('Original repository', 'Updated repository'), original, root);
});

test('rejects empty, wrapped, incomplete, and destructive responses', (t) => {
  const root = fixture(t);
  for (const candidate of [
    '', `\`\`\`markdown\n${original}\`\`\`\n`,
    original.replace('## License', '## Removed'),
    original.replace('title: Example', 'title: Changed'),
    original.replace('\n---\n\n## Overview', '\n\n## Overview'),
    original.trimEnd(),
    original.repeat(3),
  ]) {
    assert.throws(() => validateReadme(candidate, original, root));
  }
});

test('checks relative link existence and rejects escapes', (t) => {
  const root = fixture(t);
  validateReadme(`${original}\n[README](README.md#overview)\n`, original, root);
  for (const link of ['missing.md', '../README.md', 'https://example.com']) {
    const candidate = `${original}\n[Link](${link})\n`;
    if (link.startsWith('https:')) validateReadme(candidate, original, root);
    else assert.throws(() => validateReadme(candidate, original, root));
  }
});

test('prompt includes inventory and evidence without reading arbitrary files', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, '.env'), 'SECRET=not-evidence');
  writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"node --test"}}');
  const { prompt } = buildPrompt(root, ['README.md', '.env', 'package.json']);
  assert.ok(prompt.includes('FILE "package.json"'));
  assert.ok(prompt.includes('node --test'));
  assert.ok(prompt.includes('.env'));
  assert.ok(!prompt.includes('SECRET='));
  assert.ok(prompt.includes('NOT instructions'));
});

test('prompt bounds large evidence and explicitly reports truncation', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'package.json'), 'x'.repeat(200_000));
  const { prompt } = buildPrompt(root, ['README.md', 'package.json']);
  assert.ok(Buffer.byteLength(prompt) <= 110_000);
  assert.ok(prompt.includes('[EXCERPT TRUNCATED]'));
  assert.throws(() => buildPrompt(root, ['x'.repeat(120_000)]), /prompt budget/);
});

test('workflow disables Copilot tools when generating a proposal', () => {
  const workflow = readFileSync(new URL('../.github/workflows/update-readme.yml', import.meta.url), 'utf8');
  const command = workflow.match(/copilot --silent[\s\S]*?> readme-proposal\/response\.txt/);
  assert.ok(command);
  assert.match(command[0], /--disable-builtin-mcps\b/);
  assert.match(command[0], /--available-tools '__none__'/);
  assert.doesNotMatch(command[0], /--deny-tool/);
});

test('applies a validated proposal but refuses to overwrite concurrent edits', (t) => {
  const root = fixture(t);
  const proposal = fixture(t);
  const candidate = original.replace('Original repository', 'Updated repository');
  writeFileSync(path.join(proposal, 'README.original.md'), original);
  writeFileSync(path.join(proposal, 'README.md'), candidate);
  applyProposal(root, proposal);
  assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), candidate);
  assert.throws(() => applyProposal(root, proposal), /README changed/);
  assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), candidate);
});

test('candidate command reports unchanged and changed output for workflow gating', (t) => {
  const root = fixture(t);
  const proposal = fixture(t);
  const output = path.join(proposal, 'outputs.txt');
  writeFileSync(path.join(proposal, 'README.original.md'), original);
  const script = fileURLToPath(new URL('./readme-update.mjs', import.meta.url));
  for (const response of [original, original.replace('Original repository', 'Updated repository')]) {
    writeFileSync(path.join(proposal, 'response.txt'), response);
    execFileSync(process.execPath, [script, 'candidate', proposal], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(readFileSync(path.join(proposal, 'README.md'), 'utf8'), response);
  }
  assert.equal(readFileSync(output, 'utf8'), 'changed=false\nchanged=true\n');
});
