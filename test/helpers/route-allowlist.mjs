// Exact product names and technical identifiers observed in the official UI.
// Sentences and unknown human-facing labels always remain audit failures.
const brands = new Set(['Paperclip', 'Codex', 'Claude Code', 'Cursor', 'Cursor Cloud', 'Gemini CLI', 'Grok Build', 'Hermes Gateway', 'Hermes', 'HTTP', 'Kimi Code', 'OpenClaw Gateway', 'OpenCode', 'Pi', 'Smoke Lab', 'JSON', 'Markdown', 'API', 'CLI', 'MCP', 'URL', 'USD', 'UTC', 'GitHub', 'OpenAI', 'Anthropic', 'Google', 'OAuth', 'ACP', 'ACPX', 'Docker', 'Node.js']);
const ids = new Set(['acpx_local', 'claude_local', 'codex_local', 'cursor', 'cursor_cloud', 'gemini_local', 'grok_local', 'hermes_gateway', 'hermes_local', 'http', 'kimi_local', 'openclaw_gateway', 'opencode_local', 'pi_local']);
const files = new Set(['AGENTS.md', '.paperclip.yaml', 'COMPANY.md', 'README.md', 'org-chart.png']);
const searches = new Set(['status:todo', 'status:blocked', 'assignee:me', 'is:open', 'is:closed', 'project:"Paperclip App"']);
const integrations = new Set(['Zapier', 'Slack', 'Notion', 'Linear', 'Google Sheets', 'Context7',
  // Provider names exposed by the official September connector gallery.
  'Airtable', 'Asana', 'Box', 'ClickHouse', 'Cloudflare', 'Cloudinary', 'Gmail',
  'Google Calendar', 'Google Chat', 'Google Docs', 'Google Drive', 'Google People',
  'Google Slides', 'Google Workspace Search', 'Google Workspace', 'Grok', 'Hugging Face',
  'Jira', 'Mem0', 'Miro', 'Mixpanel', 'Netlify', 'OpenRouter', 'PagerDuty', 'PostHog',
  'Postman', 'Resend', 'Sentry', 'Shopify', 'Stripe', 'Supabase', 'Todoist', 'Webflow', 'Wix',
  'AgentMail', 'Composio', 'Microsoft Teams', 'Telegram', 'Discord', 'Photon', 'Vercel Connect']);
const upstreamSkills = new Set(['paperclip', 'paperclip-board', 'paperclip-converting-plans-to-tasks', 'paperclip-create-agent', 'para-memory-files', 'paperclipai/paperclip/paperclip', 'paperclipai', 'agentmail']);
const upstreamContentNames = new Set(['Reflection Coach', 'Summarizer', 'Refresh stale summary slots',
  'Review recent agent trajectories for coaching proposals']);

// Icon picker entries. The `title` is the design-system icon name, not a
// caption: translating it would break the mapping the picker shows.
const iconNames = new Set(['atom', 'bot', 'box', 'boxes', 'brain', 'briefcase', 'bug', 'circuit-board', 'cog',
  'compass', 'cpu', 'crown', 'database', 'eye', 'file-code', 'fingerprint', 'flame', 'gem', 'git-branch', 'globe',
  'hammer', 'heart', 'hexagon', 'lightbulb', 'layers', 'lock', 'message-square', 'microscope', 'pentagon', 'puzzle',
  'radar', 'rocket', 'shield', 'sparkles', 'swords', 'telescope', 'terminal', 'wand', 'wrench', 'zap']);

// Model catalogue entries: vendor identifiers and their display names.
const modelIds = /^(?:gpt-[\w.-]+|o\d(?:-\w+)?|claude-[\w.-]+|codex-[\w.-]+)$/;
const modelNames = new Set(['Claude Fable 5', 'Claude Haiku 4.5', 'Claude Mythos 5', 'Claude Opus 4.6',
  'Claude Opus 4.7', 'Claude Opus 4.8', 'Claude Opus 5', 'Claude Sonnet 4.5', 'Claude Sonnet 4.6', 'Claude Sonnet 5',
  'Codex Mini']);
// Reasoning-effort value of the Codex adapter, sent verbatim to the provider.
const modelParams = new Set(['xhigh']);

// Syntax-highlighting languages of the code viewer: each entry is the language
// identifier the editor expects, so it stays in its canonical spelling.
const languages = new Set(['Bash', 'CSS', 'Go', 'HTML', 'JavaScript', 'JavaScript (JSX)', 'Python', 'Rust', 'SQL',
  'Shell', 'Text', 'TypeScript', 'TypeScript (TSX)', 'YAML']);

// Established latin role abbreviations used as-is in Russian job titles.
const roleAbbreviations = new Set(['CEO', 'CTO', 'CMO', 'CFO', 'PM', 'QA', 'DevOps']);

// Third-party secret stores, shown by product name.
const secretStores = new Set(['AWS Secrets Manager', 'GCP Secret Manager', 'HashiCorp Vault']);

// Column keys of the task list, rendered as a machine field list.
const fieldKeyLists = new Set(['status, id, updated']);

// Latin abbreviations that stay latin in Russian operator text.
const abbreviations = new Set(['ID']);

export function classifyEnglish(candidate, { companyPrefixes = [], userValues = [] } = {}) {
  const value = candidate.value;
  if (/[\u0400-\u04ff]/.test(value)) {
    // A translated sentence may contain a brand or a filename, but arbitrary
    // English fragments in the same sentence must still fail the audit.
    let remainder = value
      .replace(/[A-Za-z]:\\[^\r\n]+/g, '')
      .replace(/\/(?:[^\s/]+\/)+[^\s]*/g, '');
    const allowed = [...brands, ...ids, ...files, ...searches, ...integrations, ...upstreamSkills, ...upstreamContentNames, ...userValues,
      ...modelNames, ...secretStores,
      'Enter', 'Chrome', 'Claude Desktop', 'Paperclip Labs', 'CSV', 'README', 'markdown', 'gzip', 'zip',
      'EE', 'KEY', 'GH_TOKEN', 'PAPERCLIP_*', '--verbose', '--foo=bar', 'pnpm dev:once', 'ASD-STE100', 'Summarizer', 'production', 'PARA',
      // Latin fragments that stay literal inside an otherwise translated
      // sentence: an identifier label, the package manager name and the
      // adapter contract symbol.
      'ID', 'npm', 'createAdapter', 'default', 'SSH', 'Rust', 'Runner', 'app-server', 'PAP-1009',
      'Drive', 'Calendar', 'Chat', 'Authorization',
      'Cmd/Ctrl', 'project', 'workspaces-overview', 'project-workspace', 'reflection-coach', 'summarize-status'];
    for (const token of allowed.sort((a, b) => b.length - a.length)) remainder = remainder.split(token).join('');
    for (const prefix of companyPrefixes) remainder = remainder.replace(new RegExp(`\\b${prefix}(?:-(?:D-)?\\d+)?\\b`, 'g'), '');
    // Hex colour codes are values, not words.
    remainder = remainder.replace(/#[0-9a-fA-F]{3,8}\b/g, '');
    return /[A-Za-z]{2}/.test(remainder) ? null : 'translated-text-with-known-name';
  }
  if (brands.has(value)) return 'product-or-format-name';
  if (integrations.has(value)) return 'integration-product-name';
  if (upstreamSkills.has(value)) return 'upstream-skill-identifier';
  if (upstreamContentNames.has(value)) return 'upstream-seeded-content';
  if ([...upstreamContentNames].some((name) => value === `- ${name}`)) return 'upstream-seeded-content';
  if (value === 'Enter') return 'keyboard-key-name';
  if (ids.has(value)) return 'adapter-identifier';
  if (files.has(value)) return 'filename';
  if (value === 'rev') return 'revision-label';
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(value)) return 'technical-slug';
  if (/^[A-Za-z]:\\/.test(value) || /^\/(?:[^/]+\/)+/.test(value)) return 'filesystem-path';
  if (searches.has(value)) return 'search-syntax';
  if (abbreviations.has(value)) return 'latin-abbreviation-kept-in-russian';
  if (iconNames.has(value)) return 'icon-identifier';
  if (modelIds.test(value)) return 'model-identifier';
  if (modelNames.has(value)) return 'model-display-name';
  if (modelParams.has(value)) return 'model-parameter-value';
  if (languages.has(value)) return 'syntax-language-identifier';
  if (roleAbbreviations.has(value)) return 'role-abbreviation';
  if (secretStores.has(value)) return 'secret-store-product-name';
  if (fieldKeyLists.has(value)) return 'machine-field-key-list';
  // "Paperclip v" is the brand followed by the version in a sibling node.
  if (value === 'Paperclip v') return 'product-name-and-version';
  if (candidate.attribute === 'placeholder' && ['claude', 'codex', '/absolute/path/to/AGENTS.md', 'https://github.com/owner/repo/tree/main/company', 'npx -y @acme/mcp-tool', '@paperclipai/plugin-example', 'my-paperclip-adapter'].includes(value)) return 'command-or-path-example';
  if (candidate.attribute === 'placeholder' && value === '{\n  "mcpServers": {\n    "github": {\n      "command": "npx -y @modelcontextprotocol/server-github",\n      "env": { "GITHUB_TOKEN": "ghp_..." }\n    }\n  }\n}') return 'literal-mcp-configuration-example';
  if (/^local@paperclip\.local$/.test(value)) return 'built-in-local-account';
  if (value === 'BO' && /rounded-full/.test(candidate.className || '')) return 'board-avatar-initials';
  if (/^[A-Z]{2}$/.test(value) && /rounded-full|avatar/.test(candidate.className || '')) return 'avatar-initials';
  if (companyPrefixes.includes(value) || companyPrefixes.some((prefix) => new RegExp(`^${prefix}-(?:D-)?\\d+$`).test(value))) return 'company-or-issue-identifier';
  if (userValues.includes(value)) return 'seeded-user-content';
  return null;
}
