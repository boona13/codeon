// ============================================================================
// SKILLS v1 — project-scoped `.claude/skills/**/SKILL.md`
// Note: In Claude Code semantics, skills are discovered automatically; explicit invocation is via "/<skill-name>".
// ============================================================================
let availableSkills = []; // [{ id, name, description, instructions, skillFilePath }]
let pendingSkillIdBySession = {}; // { [sessionId]: skillId }
let availableSkillScriptsBySession = {}; // { [sessionId]: [{ name, relPath }] }

function shellQuote() {
  const fn = window.Codeon.utils.shellQuote;
  if (typeof fn !== 'function') {
    throw new Error('Codeon.utils.shellQuote not loaded (script order issue)');
  }
  return fn.apply(this, arguments);
}

function skillIdToProjectSkillDir(skillId) {
  const id = String(skillId || '').trim();
  if (!id) return '';
  if (id.startsWith('.claude/skills/')) return id.replace(/^\.claude\/skills\//, '');
  if (id.startsWith('user:')) return id.replace(/^user:/, '');
  return '';
}

function isUserSkillId(skillId) {
  return String(skillId || '').startsWith('user:');
}

function isProjectSkillId(skillId) {
  return String(skillId || '').startsWith('.claude/skills/');
}

async function listSkillScriptsForSkill(skill) {
  if (!skill || typeof skill !== 'object') return [];
  if (!window.electronAPI || typeof window.electronAPI.listDir !== 'function') return [];

  const dir = skillIdToProjectSkillDir(skill.id);
  if (!dir) return [];

  // Only list scripts if the skill exists in the project.
  // For user skills, scripts become available after importing into the project.
  const scriptsDir = `.claude/skills/${dir}/scripts`;
  const res = await window.electronAPI.listDir(scriptsDir, { maxDepth: 2 });
  if (!res || res.success !== true || !Array.isArray(res.files)) return [];
  const entries = flattenFileTreeEntries(res.files);
  const files = entries
    .filter(e => e && e.type === 'file' && typeof e.path === 'string')
    .map(e => ({
      name: String(e.name || e.path),
      relPath: `${scriptsDir}/${String(e.path).replace(/^\.?\//, '')}`
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return files.slice(0, 60);
}

async function refreshSkillScriptsForSession(sessionId = currentSessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const select = document.getElementById('skillScriptSelect');
  const runBtn = document.getElementById('runSkillScriptButton');

  const skillId = getPendingSkillId(sid);
  const skill = skillId ? getPendingSkill(sid) : null;
  let scripts = [];
  try {
    scripts = await listSkillScriptsForSkill(skill);
  } catch {
    scripts = [];
  }
  availableSkillScriptsBySession[sid] = scripts;

  if (select) {
    select.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = scripts.length > 0 ? 'Select script…' : 'No scripts';
    select.appendChild(opt0);
    for (const s of scripts) {
      const opt = document.createElement('option');
      opt.value = s.relPath;
      opt.textContent = s.name;
      select.appendChild(opt);
    }
    select.disabled = scripts.length === 0;
  }
  if (runBtn) runBtn.disabled = scripts.length === 0;
}

