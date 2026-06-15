/**
 * Checkpoint Timeline UI
 *
 * Uses existing git checkpoint mechanism ([AI-Agent-Checkpoint] commits) and adds:
 * - Timeline modal
 * - Diff since checkpoint
 * - One-click restore
 */

(function () {
  const $ = (id) => document.getElementById(id);

  function fmtTime(epochSec) {
    const ms = Number(epochSec) * 1000;
    if (!Number.isFinite(ms)) return '';
    try { return new Date(ms).toLocaleString(); } catch { return String(epochSec); }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function runGit(cmd) {
    const root = (window.currentFolder || '').replace(/\/+$/, '');
    if (!root) throw new Error('No workspace open');
    if (!window.electronAPI?.runTerminalCommand) throw new Error('Terminal command API not available');
    return await window.electronAPI.runTerminalCommand(`cd "${root}" && ${cmd}`, true, 15000);
  }

  function parseCheckpointLog(output) {
    const text = String(output || '');
    const parts = text.split('__CKPT__').map(s => s.trim()).filter(Boolean);
    return parts.map(p => {
      const [hash, epoch, subject] = p.split('|');
      return {
        hash: (hash || '').trim(),
        epoch: (epoch || '').trim(),
        subject: (subject || '').trim()
      };
    }).filter(x => x.hash);
  }

  async function loadCheckpoints() {
    const res = await runGit(`git log --all --grep="\\[AI-Agent-Checkpoint\\]" --format="__CKPT__%H|%ct|%s" -n 60`);
    if (!res?.success) throw new Error(res?.error || res?.output || 'Failed to load git log');
    return parseCheckpointLog(res.output);
  }

  async function loadDiffSince(hash) {
    const stat = await runGit(`git diff ${hash}..HEAD --stat`);
    const names = await runGit(`git diff ${hash}..HEAD --name-only`);
    return {
      stat: stat?.success ? stat.output : (stat?.error || stat?.output || ''),
      names: names?.success ? names.output : (names?.error || names?.output || '')
    };
  }

  function setDetailLoading(text) {
    const detail = $('checkpointDetail');
    if (detail) detail.innerHTML = `<div class="checkpoint-pre">${escapeHtml(text)}</div>`;
  }

  function renderList(items) {
    const list = $('checkpointList');
    if (!list) return;
    list.innerHTML = '';

    if (!items || items.length === 0) {
      list.innerHTML = `<div class="checkpoint-item"><div>No checkpoints found yet.</div></div>`;
      return;
    }

    items.forEach((c, idx) => {
      const div = document.createElement('div');
      div.className = 'checkpoint-item';
      div.dataset.hash = c.hash;
      div.innerHTML = `
        <div class="checkpoint-hash">${escapeHtml(c.hash.substring(0, 10))}</div>
        <div class="checkpoint-meta">${escapeHtml(fmtTime(c.epoch))}</div>
        <div class="checkpoint-meta">${escapeHtml(c.subject || '')}</div>
      `;
      div.addEventListener('click', () => selectCheckpoint(c.hash, div));
      list.appendChild(div);

      if (idx === 0) {
        // auto-select newest
        setTimeout(() => div.click(), 0);
      }
    });
  }

  async function selectCheckpoint(hash, el) {
    const list = $('checkpointList');
    if (list) {
      [...list.querySelectorAll('.checkpoint-item')].forEach(n => n.classList.remove('active'));
    }
    if (el) el.classList.add('active');

    setDetailLoading('Loading diff…');
    try {
      const diff = await loadDiffSince(hash);
      const detail = $('checkpointDetail');
      if (!detail) return;

      const names = String(diff.names || '').trim();
      const stat = String(diff.stat || '').trim();
      detail.innerHTML = `
        <div><strong>Checkpoint</strong>: <span class="checkpoint-hash">${escapeHtml(hash)}</span></div>
        <div class="checkpoint-actions">
          <button class="btn-primary" id="checkpointRestoreBtn">Restore</button>
          <button class="btn-secondary" id="checkpointCopyBtn">Copy Hash</button>
        </div>
        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 12px 0;">
        <div><strong>Diff since checkpoint (stat)</strong></div>
        <div class="checkpoint-pre">${escapeHtml(stat || '(no changes)')}</div>
        <div style="margin-top: 10px;"><strong>Changed files</strong></div>
        <div class="checkpoint-pre">${escapeHtml(names || '(no files)')}</div>
      `;

      const restoreBtn = $('checkpointRestoreBtn');
      if (restoreBtn) {
        restoreBtn.onclick = async () => {
          if (typeof window.restoreToCheckpoint === 'function') {
            await window.restoreToCheckpoint(hash);
          } else {
            // fallback
            await runGit(`git checkout ${hash}`);
          }
        };
      }

      const copyBtn = $('checkpointCopyBtn');
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(hash);
            if (typeof window.showToast === 'function') window.showToast('Copied checkpoint hash');
          } catch {
            // ignore
          }
        };
      }
    } catch (e) {
      setDetailLoading(`Failed to load diff: ${e?.message || String(e)}`);
    }
  }

  async function openModal() {
    const modal = $('checkpointsModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const list = $('checkpointList');
    const detail = $('checkpointDetail');
    if (list) list.innerHTML = '';
    if (detail) detail.innerHTML = '';

    setDetailLoading('Loading checkpoints…');
    try {
      const checkpoints = await loadCheckpoints();
      renderList(checkpoints);
    } catch (e) {
      setDetailLoading(`Failed to load checkpoints: ${e?.message || String(e)}`);
    }
  }

  function closeModal() {
    const modal = $('checkpointsModal');
    if (modal) modal.style.display = 'none';
  }

  function bind() {
    const btn = $('checkpointsButton');
    const close = $('closeCheckpointsButton');
    const closeFooter = $('closeCheckpointsFooter');
    if (btn) btn.addEventListener('click', openModal);
    if (close) close.addEventListener('click', closeModal);
    if (closeFooter) closeFooter.addEventListener('click', closeModal);

    const modal = $('checkpointsModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }
  }

  // Defer until DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();


