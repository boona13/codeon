/**
 * Custom Dropdown Component
 * A cross-platform styled dropdown that replaces native <select> elements
 * to ensure consistent dark theme styling on Windows, macOS, and Linux.
 */

(function() {
  'use strict';

  // Track all dropdown instances for cleanup
  const dropdownInstances = new Map();

  /**
   * Create a custom dropdown from a native select element
   * @param {HTMLSelectElement} selectEl - The native select to replace
   * @param {Object} options - Configuration options
   * @returns {HTMLElement} The custom dropdown container
   */
  function createCustomDropdown(selectEl, options = {}) {
    if (!selectEl || selectEl.tagName !== 'SELECT') return null;
    
    // Skip if already converted
    if (selectEl.dataset.customDropdown === 'true') return null;
    
    const {
      _width = 'auto',
      maxHeight = '280px',
      _position = 'bottom', // 'bottom' or 'top'
      _searchable = false,
      placeholder = 'Select...'
    } = options;

    // Create container
    const container = document.createElement('div');
    container.className = 'custom-dropdown';
    container.setAttribute('role', 'listbox');
    container.setAttribute('aria-label', selectEl.getAttribute('aria-label') || selectEl.title || 'Select option');
    
    // Copy classes for styling context
    if (selectEl.classList.contains('composer-select')) {
      container.classList.add('custom-dropdown--composer');
    }
    if (selectEl.classList.contains('terminal-theme-select')) {
      container.classList.add('custom-dropdown--terminal');
    }
    if (selectEl.classList.contains('form-input')) {
      container.classList.add('custom-dropdown--form');
    }
    if (selectEl.classList.contains('asl-input')) {
      container.classList.add('custom-dropdown--asl');
    }
    if (selectEl.classList.contains('context-inspector-select')) {
      container.classList.add('custom-dropdown--context-inspector');
    }
    // AET run selects
    if (selectEl.id === 'executionTimelineRunSelect' || selectEl.id === 'executionTimelineEditorRunSelect') {
      container.classList.add('custom-dropdown--aet');
    }

    // Create trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-dropdown__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    
    const triggerText = document.createElement('span');
    triggerText.className = 'custom-dropdown__value';
    
    const triggerArrow = document.createElement('span');
    triggerArrow.className = 'custom-dropdown__arrow';
    triggerArrow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    
    trigger.appendChild(triggerText);
    trigger.appendChild(triggerArrow);

    // Create dropdown menu
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown__menu';
    menu.style.maxHeight = maxHeight;
    menu.setAttribute('role', 'listbox');

    // Build options from select
    const buildOptions = () => {
      menu.innerHTML = '';
      const options = selectEl.querySelectorAll('option, optgroup');
      
      options.forEach((el) => {
        if (el.tagName === 'OPTGROUP') {
          const group = document.createElement('div');
          group.className = 'custom-dropdown__group';
          group.textContent = el.label;
          menu.appendChild(group);
        } else if (el.tagName === 'OPTION') {
          const item = document.createElement('div');
          item.className = 'custom-dropdown__item';
          item.dataset.value = el.value;
          item.textContent = el.textContent;
          item.setAttribute('role', 'option');
          
          if (el.disabled) {
            item.classList.add('custom-dropdown__item--disabled');
            item.setAttribute('aria-disabled', 'true');
          }
          
          if (el.selected) {
            item.classList.add('custom-dropdown__item--selected');
            item.setAttribute('aria-selected', 'true');
          }
          
          menu.appendChild(item);
        }
      });
    };

    buildOptions();

    // Update displayed value
    const updateValue = () => {
      const selectedOption = selectEl.options[selectEl.selectedIndex];
      if (selectedOption) {
        triggerText.textContent = selectedOption.textContent;
        triggerText.classList.remove('custom-dropdown__value--placeholder');
      } else {
        triggerText.textContent = placeholder;
        triggerText.classList.add('custom-dropdown__value--placeholder');
      }
      
      // Update selected state in menu
      menu.querySelectorAll('.custom-dropdown__item').forEach(item => {
        const isSelected = item.dataset.value === selectEl.value;
        item.classList.toggle('custom-dropdown__item--selected', isSelected);
        item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });
    };

    updateValue();

    // Toggle menu
    const toggleMenu = (show) => {
      const isOpen = show !== undefined ? show : !container.classList.contains('custom-dropdown--open');
      container.classList.toggle('custom-dropdown--open', isOpen);
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      
      if (isOpen) {
        // Position menu
        positionMenu();
        // Focus first selected or first item
        const selected = menu.querySelector('.custom-dropdown__item--selected') || 
                        menu.querySelector('.custom-dropdown__item:not(.custom-dropdown__item--disabled)');
        if (selected) {
          selected.scrollIntoView({ block: 'nearest' });
        }
      }
    };

    // Position menu (handle screen edges)
    const positionMenu = () => {
      const rect = container.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const menuHeight = Math.min(parseInt(maxHeight), menu.scrollHeight);
      
      // Default to bottom, flip to top if not enough space
      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        menu.classList.add('custom-dropdown__menu--top');
        menu.classList.remove('custom-dropdown__menu--bottom');
      } else {
        menu.classList.add('custom-dropdown__menu--bottom');
        menu.classList.remove('custom-dropdown__menu--top');
      }
    };

    // Handle item selection
    const selectItem = (item) => {
      if (item.classList.contains('custom-dropdown__item--disabled')) return;
      
      const value = item.dataset.value;
      selectEl.value = value;
      
      // Trigger change event on original select
      const event = new Event('change', { bubbles: true });
      selectEl.dispatchEvent(event);
      
      updateValue();
      toggleMenu(false);
      trigger.focus();
    };

    // Event listeners
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.custom-dropdown__item');
      if (item) {
        selectItem(item);
      }
    });

    // Keyboard navigation
    trigger.addEventListener('keydown', (e) => {
      const isOpen = container.classList.contains('custom-dropdown--open');
      
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          toggleMenu();
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            toggleMenu(true);
          } else {
            navigateItems(1);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen) {
            toggleMenu(true);
          } else {
            navigateItems(-1);
          }
          break;
        case 'Escape':
          if (isOpen) {
            e.preventDefault();
            toggleMenu(false);
          }
          break;
        case 'Tab':
          if (isOpen) {
            toggleMenu(false);
          }
          break;
      }
    });

    const navigateItems = (direction) => {
      const items = Array.from(menu.querySelectorAll('.custom-dropdown__item:not(.custom-dropdown__item--disabled)'));
      const currentIndex = items.findIndex(item => item.classList.contains('custom-dropdown__item--focused'));
      let nextIndex = currentIndex + direction;
      
      if (nextIndex < 0) nextIndex = items.length - 1;
      if (nextIndex >= items.length) nextIndex = 0;
      
      items.forEach(item => item.classList.remove('custom-dropdown__item--focused'));
      if (items[nextIndex]) {
        items[nextIndex].classList.add('custom-dropdown__item--focused');
        items[nextIndex].scrollIntoView({ block: 'nearest' });
      }
    };

    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const focused = menu.querySelector('.custom-dropdown__item--focused');
        if (focused) {
          selectItem(focused);
        }
      }
    });

    // Close on outside click
    const handleOutsideClick = (e) => {
      if (!container.contains(e.target)) {
        toggleMenu(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);

    // Close on scroll (optional, helps with positioning issues)
    const handleScroll = (e) => {
      if (container.classList.contains('custom-dropdown--open') && !container.contains(e.target)) {
        toggleMenu(false);
      }
    };
    document.addEventListener('scroll', handleScroll, true);

    // Assemble
    container.appendChild(trigger);
    container.appendChild(menu);

    // Hide original select but keep it in DOM for form submission
    selectEl.style.display = 'none';
    selectEl.dataset.customDropdown = 'true';
    selectEl.parentNode.insertBefore(container, selectEl);

    // Store instance for cleanup
    const instance = {
      container,
      trigger,
      menu,
      selectEl,
      updateValue,
      buildOptions,
      destroy: () => {
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('scroll', handleScroll, true);
        container.remove();
        selectEl.style.display = '';
        selectEl.dataset.customDropdown = '';
        dropdownInstances.delete(selectEl);
      }
    };
    
    dropdownInstances.set(selectEl, instance);

    // Watch for changes to the select (e.g., options added dynamically)
    const observer = new MutationObserver(() => {
      buildOptions();
      updateValue();
    });
    observer.observe(selectEl, { childList: true, subtree: true });
    instance.observer = observer;

    return container;
  }

  /**
   * Check if running on Windows
   */
  function isWindows() {
    // Check navigator.platform (more reliable in Electron)
    if (navigator.platform) {
      return navigator.platform.toLowerCase().includes('win');
    }
    // Fallback to userAgent
    return navigator.userAgent.toLowerCase().includes('windows');
  }

  /**
   * Initialize custom dropdowns on all matching selects
   * NOTE: Only runs on Windows where native <select> dropdowns can't be styled
   */
  function initCustomDropdowns() {
    // Only apply custom dropdowns on Windows - macOS and Linux native selects look fine
    if (!isWindows()) {
      return;
    }

    // Selectors to convert - ALL select elements that appear in visible UI
    const selectors = [
      // Composer selects (bottom bar)
      'select.composer-select',
      '#permissionModeComposerInput',
      '#claudeModelComposerInput',
      
      // Terminal theme
      'select.terminal-theme-select',
      '#terminalThemeSelect',
      
      // Settings modal selects
      'select.form-input',
      '#permissionModeInput',
      '#networkPolicyModeInput',
      '#openrouterModelInput',
      '#mcpServerType',
      
      // Agents & Skills library
      'select.asl-input',
      '#aslAgentLocation',
      '#aslSkillLocation',
      '#aslScriptSkill',
      '#aslScriptType',
      
      // AET / Execution timeline
      '#executionTimelineRunSelect',
      '#executionTimelineEditorRunSelect',
      
      // Tools panel
      '#agentSelect',
      '#skillSelect',
      '#skillScriptSelect',
      
      // Receipts
      '#receiptsToolFilter',
      
      // Context inspector
      '#contextInspectorSelect',
      'select.context-inspector-select'
    ];

    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (el.dataset.customDropdown !== 'true') {
          createCustomDropdown(el);
        }
      });
    });
  }

  /**
   * Refresh a specific dropdown (when options change)
   */
  function refreshDropdown(selectEl) {
    const instance = dropdownInstances.get(selectEl);
    if (instance) {
      instance.buildOptions();
      instance.updateValue();
    }
  }

  /**
   * Update the value display of a dropdown (when select value changes programmatically)
   */
  function updateDropdownValue(selectEl) {
    const instance = dropdownInstances.get(selectEl);
    if (instance) {
      instance.updateValue();
    }
  }

  // Export to global
  window.CustomDropdown = {
    create: createCustomDropdown,
    init: initCustomDropdowns,
    refresh: refreshDropdown,
    updateValue: updateDropdownValue,
    instances: dropdownInstances
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomDropdowns);
  } else {
    // Small delay to ensure selects are populated
    setTimeout(initCustomDropdowns, 100);
  }
})();
