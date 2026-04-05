#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const FRESHNESS_CONFIG_PATH = path.join(repoRoot, 'docs', 'freshness.json');
const MCP_SETUP_PATH = path.join(repoRoot, 'docs', 'MCP_SETUP.md');
const REPO_CONTRACT_PATH = path.join(repoRoot, 'docs', 'agent', 'REPO_CONTRACT.md');
const MCP_TOOL_SOURCE_DIR = path.join(repoRoot, 'src', 'mcp', 'tools');
const OLD_REPO_PATTERNS = [
  /github\.com\/AndrewNordstrom\/bluesky-community-feed/,
  /\bAndrewNordstrom\/bluesky-community-feed\b/,
];
const REPO_GUARD_SCAN_PATHS = [
  'README.md',
  'SUPPORT.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'docs',
  '.github/ISSUE_TEMPLATE/config.yml',
];
const REPO_GUARD_EXCLUDES = new Set([
  'docs/dev-journal.md',
  'docs/SECURITY_AUDIT.md',
]);
const REPO_GUARD_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.html',
  '.yml',
  '.yaml',
]);

const LINK_REGEX = /!?\[[^\]]*]\(([^)]+)\)/g;
const NPM_RUN_REGEX = /\bnpm run ([a-zA-Z0-9:_-]+)\b/g;

const DEPRECATED_PATTERNS = [
  { regex: /\b(epoch:status|votes:summary|feed:stats|topics:list|export:votes|scoring:trigger)\b/, message: 'Legacy colon-style CLI syntax found' },
  { regex: /\bdocker-compose(?:\s+[a-zA-Z]|$)/, message: 'Use "docker compose" (space) instead of "docker-compose"' },
];

const DEFAULT_SCAN_PATHS = [
  'README.md',
  'CONTRIBUTING.md',
  'RELEASING.md',
  'ROADMAP.md',
  'SUPPORT.md',
  'docs',
  '.github/PULL_REQUEST_TEMPLATE.md',
];

const EXPECTED_REPO_CONTRACT_HEADINGS = [
  '## 1. What This Repo Is',
  '## 2. Why It Exists',
  '## 3. System Shape',
  '## 4. Key Files and Directories',
  '## 5. Build / Test / Run Commands',
  '## 6. Deploy and Rollback Notes',
  '## 7. Linked Deeper Docs',
  '## 8. Known Gotchas',
  '## 9. Where to Get Live State',
];

const ALLOWED_DOC_COMPLIANCE_STATUS = new Set(['Exists', 'Missing']);

function walkMarkdownFiles(rootDir) {
  const files = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function walkTextFiles(rootDir, extensions) {
  const files = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        queue.push(fullPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function collectMarkdownFiles(scanPaths) {
  const out = new Set();
  for (const relPath of scanPaths) {
    const absPath = path.join(repoRoot, relPath);
    if (!existsSync(absPath)) continue;
    const stats = statSync(absPath);
    if (stats.isDirectory()) {
      for (const file of walkMarkdownFiles(absPath)) {
        out.add(file);
      }
      continue;
    }
    if (stats.isFile() && absPath.endsWith('.md')) {
      out.add(absPath);
    }
  }
  return Array.from(out);
}

function collectTextFiles(scanPaths, extensions) {
  const out = new Set();
  for (const relPath of scanPaths) {
    const absPath = path.join(repoRoot, relPath);
    if (!existsSync(absPath)) continue;
    const stats = statSync(absPath);
    if (stats.isDirectory()) {
      for (const file of walkTextFiles(absPath, extensions)) {
        out.add(file);
      }
      continue;
    }
    if (stats.isFile() && extensions.has(path.extname(absPath).toLowerCase())) {
      out.add(absPath);
    }
  }
  return Array.from(out);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function splitLinkTarget(target) {
  const clean = target.trim().replace(/^<|>$/g, '');
  const hashIndex = clean.indexOf('#');
  if (hashIndex === -1) return { pathPart: clean, anchor: '' };
  return { pathPart: clean.slice(0, hashIndex), anchor: clean.slice(hashIndex + 1) };
}

function isExternalLink(target) {
  return (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('tel:') ||
    target.startsWith('#')
  );
}

function resolveLink(baseFile, targetPath) {
  if (targetPath.startsWith('/')) {
    return path.join(repoRoot, targetPath.slice(1));
  }
  return path.resolve(path.dirname(baseFile), targetPath);
}

function getWorkflowCheckNames(ciPath) {
  const content = readFileSync(ciPath, 'utf8');
  const matches = [...content.matchAll(/^\s{2}([a-z0-9-]+):\s*$/gm)];
  return matches.map(m => m[1]);
}

function validateFreshness(config, problems) {
  const now = new Date();
  const maxAgeDays = Number(config.maxAgeDays);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    problems.push('docs/freshness.json: maxAgeDays must be a positive number');
    return;
  }

  for (const doc of config.documents ?? []) {
    const docPath = path.join(repoRoot, doc.path ?? '');
    if (!doc.path || typeof doc.path !== 'string') {
      problems.push('docs/freshness.json: each document requires a string path');
      continue;
    }
    if (!existsSync(docPath)) {
      problems.push(`freshness: missing document "${doc.path}"`);
      continue;
    }
    const reviewedAt = new Date(doc.lastReviewed);
    if (!doc.lastReviewed || Number.isNaN(reviewedAt.getTime())) {
      problems.push(`freshness: ${doc.path} has invalid lastReviewed date "${doc.lastReviewed}"`);
      continue;
    }
    const ageMs = now.getTime() - reviewedAt.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    if (ageDays > maxAgeDays) {
      problems.push(
        `freshness: ${doc.path} is ${ageDays} days old (> ${maxAgeDays}); update docs/freshness.json lastReviewed`
      );
    }
  }
}

function validateMarkdownLinks(markdownFiles, problems) {
  for (const file of markdownFiles) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(LINK_REGEX)) {
      const rawTarget = match[1]?.trim() ?? '';
      if (!rawTarget || isExternalLink(rawTarget)) continue;

      const withoutTitle = rawTarget.split(/\s+"/)[0];
      const { pathPart } = splitLinkTarget(withoutTitle);
      if (!pathPart) continue;

      const resolved = resolveLink(file, decodeURIComponent(pathPart));
      if (!existsSync(resolved)) {
        problems.push(
          `broken link: ${relative(file)} -> ${rawTarget}`
        );
      }
    }
  }
}

function validateNpmRunCommands(markdownFiles, problems) {
  const rootScripts = new Set(Object.keys(readJson(path.join(repoRoot, 'package.json')).scripts ?? {}));
  const webScripts = new Set(Object.keys(readJson(path.join(repoRoot, 'web', 'package.json')).scripts ?? {}));
  const cliScripts = new Set(Object.keys(readJson(path.join(repoRoot, 'cli', 'package.json')).scripts ?? {}));

  for (const file of markdownFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      for (const match of line.matchAll(NPM_RUN_REGEX)) {
        const scriptName = match[1];
        const isWebContext = /cd\s+web\b/.test(line);
        const isCliContext = /cd\s+cli\b/.test(line);
        const valid = isWebContext
          ? webScripts.has(scriptName)
          : isCliContext
            ? cliScripts.has(scriptName)
            : rootScripts.has(scriptName);

        if (!valid) {
          const scope = isWebContext ? 'web/package.json' : isCliContext ? 'cli/package.json' : 'package.json';
          problems.push(
            `invalid npm script: ${relative(file)}:${idx + 1} -> "${scriptName}" not found in ${scope}`
          );
        }
      }
    });
  }
}

function validateDeprecatedPatterns(markdownFiles, ignoreSet, problems) {
  for (const file of markdownFiles) {
    const rel = relative(file);
    if (ignoreSet.has(rel)) continue;
    const content = readFileSync(file, 'utf8');
    for (const { regex, message } of DEPRECATED_PATTERNS) {
      if (regex.test(content)) {
        problems.push(`${message}: ${rel}`);
      }
    }
  }
}

function validateMcpToolCount(problems) {
  const mcpSetup = readFileSync(MCP_SETUP_PATH, 'utf8');
  const headingMatch = mcpSetup.match(/##\s+Tools\s+\((\d+)\s+total\)/);
  if (!headingMatch) {
    problems.push('docs/MCP_SETUP.md missing "## Tools (N total)" heading');
    return;
  }

  const documentedCount = Number(headingMatch[1]);
  const toolFiles = readdirSync(MCP_TOOL_SOURCE_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'index.ts' && f !== 'format.ts')
    .map(f => path.join(MCP_TOOL_SOURCE_DIR, f));

  let actualCount = 0;
  for (const file of toolFiles) {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(/server\.registerTool\(/g);
    actualCount += matches ? matches.length : 0;
  }

  if (documentedCount !== actualCount) {
    problems.push(
      `MCP tool count mismatch: docs/MCP_SETUP.md says ${documentedCount}, source registers ${actualCount}`
    );
  }
}

function validateCiHasDocsVerify(ciPath, problems) {
  if (!existsSync(ciPath)) {
    problems.push('.github/workflows/ci.yml not found');
    return;
  }
  const checkNames = getWorkflowCheckNames(ciPath);
  if (!checkNames.includes('docs-verify')) {
    problems.push('CI is missing required docs-verify job in .github/workflows/ci.yml');
  }
}

function validateLegacyRepoReferences(files, problems) {
  for (const file of files) {
    const rel = relative(file);
    if (REPO_GUARD_EXCLUDES.has(rel)) continue;
    const content = readFileSync(file, 'utf8');
    const hasLegacyReference = OLD_REPO_PATTERNS.some(pattern => pattern.test(content));
    if (hasLegacyReference) {
      problems.push(`legacy repo URL reference found: ${rel}`);
    }
  }
}

function parseMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }

  return trimmed
    .slice(1, -1)
    .split('|')
    .map(cell => cell.trim());
}

function stripInlineCode(value) {
  return value.replace(/^`+|`+$/g, '').trim();
}

function validateRepoContract(problems) {
  if (!existsSync(REPO_CONTRACT_PATH)) {
    problems.push('docs/agent/REPO_CONTRACT.md not found');
    return;
  }

  const content = readFileSync(REPO_CONTRACT_PATH, 'utf8');
  const headings = content.match(/^##\s+.+$/gm) ?? [];

  if (headings.length !== EXPECTED_REPO_CONTRACT_HEADINGS.length) {
    problems.push(
      `repo contract heading count mismatch: expected ${EXPECTED_REPO_CONTRACT_HEADINGS.length}, found ${headings.length}`
    );
  }

  EXPECTED_REPO_CONTRACT_HEADINGS.forEach((heading, index) => {
    if (headings[index] !== heading) {
      problems.push(
        `repo contract heading mismatch at section ${index + 1}: expected "${heading}", found "${headings[index] ?? 'missing'}"`
      );
    }
  });

  const trackerMatch = content.match(
    /^###\s+Doc Compliance Tracker.*$(?:\n+|\r\n+)([\s\S]*?)(?=^##\s|\Z)/m,
  );

  if (!trackerMatch) {
    problems.push('repo contract missing "### Doc Compliance Tracker" subsection');
    return;
  }

  const trackerLines = trackerMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.startsWith('|'));

  if (trackerLines.length < 3) {
    problems.push('repo contract doc compliance tracker table is missing rows');
    return;
  }

  const headerCells = parseMarkdownTableRow(trackerLines[0]);
  const separatorCells = parseMarkdownTableRow(trackerLines[1]);

  if (!headerCells || !separatorCells) {
    problems.push('repo contract doc compliance tracker table is malformed');
    return;
  }

  const expectedHeaders = ['Required Doc', 'Canonical Path', 'Status', 'Notes'];
  expectedHeaders.forEach((expectedHeader, index) => {
    if (headerCells[index] !== expectedHeader) {
      problems.push(
        `repo contract doc compliance header mismatch at column ${index + 1}: expected "${expectedHeader}", found "${headerCells[index] ?? 'missing'}"`
      );
    }
  });

  trackerLines.slice(2).forEach((line, index) => {
    const row = parseMarkdownTableRow(line);
    if (!row || row.length < 4) {
      problems.push(`repo contract doc compliance row ${index + 1} is malformed`);
      return;
    }

    const canonicalPath = stripInlineCode(row[1]);
    const status = row[2];

    if (!ALLOWED_DOC_COMPLIANCE_STATUS.has(status)) {
      problems.push(
        `repo contract doc compliance row ${index + 1} has invalid status "${status}"; expected Exists or Missing`
      );
    }

    if (!canonicalPath) {
      problems.push(`repo contract doc compliance row ${index + 1} is missing canonical path`);
      return;
    }

    if (status === 'Exists' && !existsSync(path.join(repoRoot, canonicalPath))) {
      problems.push(
        `repo contract doc compliance row ${index + 1} marks "${canonicalPath}" as Exists, but the file is missing`
      );
    }
  });
}

function main() {
  const problems = [];

  if (!existsSync(FRESHNESS_CONFIG_PATH)) {
    console.error('docs/freshness.json not found');
    process.exit(1);
  }

  const config = readJson(FRESHNESS_CONFIG_PATH);
  const scanPaths = Array.isArray(config.scanPaths) && config.scanPaths.length > 0
    ? config.scanPaths
    : DEFAULT_SCAN_PATHS;
  const markdownFiles = collectMarkdownFiles(scanPaths);
  const repoGuardFiles = collectTextFiles(REPO_GUARD_SCAN_PATHS, REPO_GUARD_EXTENSIONS);
  const ignoreSet = new Set((config.ignoreFilesForLint ?? []).map(p => String(p)));

  validateFreshness(config, problems);
  validateMarkdownLinks(markdownFiles, problems);
  validateNpmRunCommands(markdownFiles, problems);
  validateDeprecatedPatterns(markdownFiles, ignoreSet, problems);
  validateMcpToolCount(problems);
  validateCiHasDocsVerify(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), problems);
  validateLegacyRepoReferences(repoGuardFiles, problems);
  validateRepoContract(problems);

  if (problems.length > 0) {
    console.error('Docs verification failed:');
    for (const p of problems) {
      console.error(`- ${p}`);
    }
    process.exit(1);
  }

  const freshnessDocs = Array.isArray(config.documents) ? config.documents.length : 0;
  const markdownCount = markdownFiles.length;
  console.log(`Docs verification passed (${freshnessDocs} tracked docs, ${markdownCount} markdown files scanned).`);
}

main();
