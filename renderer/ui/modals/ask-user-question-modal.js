(function () {
  function normalizeQuestions(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((q) => (q && typeof q === 'object' ? q : null))
      .filter(Boolean)
      .slice(0, 4);
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  function buildQuestionCard(question, idx) {
    const card = createEl('div', 'ask-question-card');
    card.dataset.question = String(question.question || '').trim();
    card.dataset.multiSelect = question.multiSelect === true ? '1' : '0';

    const header = createEl('div', 'ask-question-header');
    const chip = createEl('span', 'ask-question-chip', String(question.header || 'Question'));
    const text = createEl('span', 'ask-question-text', String(question.question || ''));
    header.appendChild(chip);
    header.appendChild(text);

    const options = createEl('div', 'ask-question-options');
    const name = `ask-question-${idx}`;
    const inputType = question.multiSelect === true ? 'checkbox' : 'radio';
    const list = Array.isArray(question.options) ? question.options.slice(0, 4) : [];

    list.forEach((opt, optIdx) => {
      const label = createEl('label', 'ask-question-option');
      const input = document.createElement('input');
      input.type = inputType;
      input.name = name;
      input.value = String(opt && opt.label ? opt.label : `Option ${optIdx + 1}`);
      input.className = 'ask-question-input';
      label.appendChild(input);

      const info = createEl('div', 'ask-question-option-info');
      const optLabel = createEl('div', 'ask-question-option-label', input.value);
      const optDesc = createEl('div', 'ask-question-option-desc', String(opt && opt.description ? opt.description : ''));
      info.appendChild(optLabel);
      info.appendChild(optDesc);
      label.appendChild(info);
      options.appendChild(label);
    });

    const otherLabel = createEl('label', 'ask-question-option ask-question-option-other');
    const otherInput = document.createElement('input');
    otherInput.type = inputType;
    otherInput.name = name;
    otherInput.value = '__other__';
    otherInput.className = 'ask-question-input';
    const otherRow = createEl('div', 'ask-question-option-row');
    otherRow.appendChild(otherInput);
    otherRow.appendChild(createEl('div', 'ask-question-option-label', 'Other'));
    otherLabel.appendChild(otherRow);
    const otherText = document.createElement('input');
    otherText.type = 'text';
    otherText.placeholder = 'Type your answer';
    otherText.className = 'ask-question-other-input form-input';
    otherText.disabled = true;
    otherLabel.appendChild(otherText);
    options.appendChild(otherLabel);

    const error = createEl('div', 'ask-question-error');
    error.style.display = 'none';

    const onOptionChange = () => {
      const checkedOther = otherInput.checked;
      otherText.disabled = !checkedOther;
      if (checkedOther) otherText.focus();
      error.style.display = 'none';
      card.classList.remove('ask-question-card-error');
    };

    options.addEventListener('change', onOptionChange);
    otherText.addEventListener('input', () => {
      error.style.display = 'none';
      card.classList.remove('ask-question-card-error');
    });

    card.appendChild(header);
    card.appendChild(options);
    card.appendChild(error);
    return card;
  }

  function collectAnswers(container) {
    const answers = {};
    const cards = container ? Array.from(container.querySelectorAll('.ask-question-card')) : [];
    const invalidCards = [];

    cards.forEach((card) => {
      const questionText = String(card.dataset.question || '').trim();
      if (!questionText) return;
      const multiSelect = card.dataset.multiSelect === '1';
      const inputs = Array.from(card.querySelectorAll('.ask-question-input'));
      const otherText = card.querySelector('.ask-question-other-input');
      const error = card.querySelector('.ask-question-error');
      const selected = inputs.filter((input) => input.checked);

      let value = '';
      if (multiSelect) {
        const values = selected
          .map((input) => {
            if (input.value === '__other__') {
              const raw = otherText ? String(otherText.value || '').trim() : '';
              return raw || null;
            }
            return String(input.value || '').trim();
          })
          .filter(Boolean);
        value = values.join(', ');
      } else if (selected.length > 0) {
        const selectedInput = selected[0];
        if (selectedInput.value === '__other__') {
          value = otherText ? String(otherText.value || '').trim() : '';
        } else {
          value = String(selectedInput.value || '').trim();
        }
      }

      if (!value) {
        invalidCards.push(card);
        if (error) {
          error.textContent = 'Please select an option or enter a custom answer.';
          error.style.display = '';
        }
        card.classList.add('ask-question-card-error');
      } else {
        answers[questionText] = value;
      }
    });

    return { answers, invalidCards };
  }

  function openAskUserQuestionModal({ questions, titleText } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('askUserQuestionModal');
      const title = document.getElementById('askUserQuestionTitle');
      const list = document.getElementById('askUserQuestionList');
      const confirmBtn = document.getElementById('askUserQuestionConfirm');
      const cancelBtn = document.getElementById('askUserQuestionCancel');

      if (!modal || !title || !list || !confirmBtn || !cancelBtn) {
        return resolve({ allow: false, answers: null });
      }

      const normalized = normalizeQuestions(questions);
      if (normalized.length === 0) {
        return resolve({ allow: false, answers: null });
      }

      title.textContent = String(titleText || 'Claude needs your input');
      clearNode(list);
      normalized.forEach((q, idx) => {
        list.appendChild(buildQuestionCard(q, idx));
      });

      modal.style.display = 'flex';

      const cleanup = (result) => {
        modal.style.display = 'none';
        clearNode(list);
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        document.removeEventListener('keydown', onKeydown);
        resolve(result);
      };

      const onKeydown = (ev) => {
        if (ev.key === 'Escape') cleanup({ allow: false, answers: null });
      };

      document.addEventListener('keydown', onKeydown);

      confirmBtn.onclick = () => {
        const { answers, invalidCards } = collectAnswers(list);
        if (invalidCards.length > 0) return;
        cleanup({ allow: true, answers });
      };

      cancelBtn.onclick = () => cleanup({ allow: false, answers: null });

      // Focus first input
      setTimeout(() => {
        const firstInput = list.querySelector('input');
        if (firstInput) firstInput.focus();
      }, 0);
    });
  }

  window.openAskUserQuestionModal = openAskUserQuestionModal;
})();
