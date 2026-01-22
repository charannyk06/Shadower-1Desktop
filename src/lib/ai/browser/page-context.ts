/**
 * Page Context Extraction System
 *
 * Replaces screenshot-based browser automation with structured context.
 * Instead of sending base64 images to the model, we extract:
 * - Interactive elements (buttons, links, inputs)
 * - Form structures with field types
 * - Page structure (headings, landmarks)
 * - Visible text content
 *
 * This dramatically reduces token usage while giving the model
 * better actionable information for automation.
 */

// ============================================================================
// Types
// ============================================================================

export interface PageContext {
  /** Current page URL */
  url: string;
  /** Page title */
  title: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Interactive elements on the page */
  elements: InteractiveElement[];
  /** Forms detected on the page */
  forms: FormAnalysis[];
  /** Page structure (headings, landmarks) */
  structure: PageStructure;
  /** Truncated visible text content */
  visibleText: string;
  /** Focused element if any */
  focusedElement?: string;
  /** Any alerts/dialogs present */
  dialogs: DialogInfo[];
  /** Extraction timestamp */
  extractedAt: string;
}

export interface InteractiveElement {
  /** Generated reference ID (e.g., "btn-1", "input-3") */
  ref: string;
  /** HTML tag name */
  tag: string;
  /** ARIA role if present */
  role?: string;
  /** Visible text content */
  text?: string;
  /** Placeholder text (for inputs) */
  placeholder?: string;
  /** Element value (for inputs) */
  value?: string;
  /** CSS selector to interact with this element */
  selector: string;
  /** Input type if applicable */
  type?: string;
  /** Whether element is disabled */
  disabled?: boolean;
  /** Whether element is visible in viewport */
  inViewport: boolean;
  /** ARIA label if present */
  ariaLabel?: string;
  /** Name attribute */
  name?: string;
  /** Associated label text (for form fields) */
  labelText?: string;
  /** Bounding box for reference */
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FormAnalysis {
  /** Reference ID for the form */
  ref: string;
  /** CSS selector for the form */
  selector: string;
  /** Form action URL */
  action?: string;
  /** Form method */
  method?: string;
  /** Form name/id */
  name?: string;
  /** All fields in the form */
  fields: FormField[];
  /** Submit button selector */
  submitButton?: {
    ref: string;
    selector: string;
    text?: string;
  };
  /** Whether form appears to be a login form */
  isLoginForm: boolean;
  /** Whether form appears to be a search form */
  isSearchForm: boolean;
  /** Whether form appears to be a signup/registration form */
  isSignupForm: boolean;
}

export interface FormField {
  /** Reference ID */
  ref: string;
  /** CSS selector */
  selector: string;
  /** Field type (text, email, password, select, checkbox, etc.) */
  type: string;
  /** Field name attribute */
  name?: string;
  /** Associated label text */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Current value */
  value?: string;
  /** Whether field is required */
  required: boolean;
  /** Whether field is disabled */
  disabled: boolean;
  /** Options for select/radio fields */
  options?: { value: string; text: string; selected?: boolean }[];
  /** Validation pattern if any */
  pattern?: string;
  /** Min/max for number inputs */
  min?: string;
  max?: string;
  /** Autocomplete hint */
  autocomplete?: string;
}

export interface PageStructure {
  /** Page headings hierarchy */
  headings: { level: number; text: string; ref: string }[];
  /** ARIA landmarks */
  landmarks: { role: string; label?: string; ref: string }[];
  /** Main content area selector if detected */
  mainContent?: string;
  /** Navigation areas */
  navigation: { ref: string; selector: string; links: number }[];
}

export interface DialogInfo {
  /** Type of dialog */
  type: "alert" | "confirm" | "prompt" | "modal";
  /** Dialog message/content */
  message?: string;
  /** Whether it's blocking */
  isModal: boolean;
  /** Buttons available */
  buttons?: string[];
}

// ============================================================================
// Context Extraction Script (runs in browser via CDP)
// ============================================================================

/**
 * This script is injected into the page via Chrome DevTools Protocol.
 * It extracts all relevant context without taking screenshots.
 */
export const PAGE_CONTEXT_EXTRACTION_SCRIPT = `
(function extractPageContext() {
  const context = {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    elements: [],
    forms: [],
    structure: {
      headings: [],
      landmarks: [],
      navigation: []
    },
    visibleText: '',
    focusedElement: null,
    dialogs: [],
    extractedAt: new Date().toISOString()
  };

  // Track refs for unique IDs
  let elementCounter = 0;
  const refMap = new WeakMap();

  function getRef(el, prefix = 'el') {
    if (refMap.has(el)) return refMap.get(el);
    const ref = prefix + '-' + (++elementCounter);
    refMap.set(el, ref);
    return ref;
  }

  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);

    // Try to build a unique selector
    const parts = [];
    let current = el;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\\s+/).filter(c => c && !c.includes(':'));
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
        }
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
  }

  function getElementText(el) {
    // Get direct text content, not nested
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    text = text.trim();
    if (!text) {
      text = el.innerText?.trim().substring(0, 100) || '';
    }
    return text.substring(0, 200);
  }

  function getLabelForInput(input) {
    // Check for associated label
    if (input.id) {
      const label = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (label) return label.innerText?.trim();
    }
    // Check for wrapping label
    const parentLabel = input.closest('label');
    if (parentLabel) {
      return parentLabel.innerText?.trim().replace(input.value || '', '').trim();
    }
    // Check for aria-label
    if (input.getAttribute('aria-label')) {
      return input.getAttribute('aria-label');
    }
    // Check for aria-labelledby
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.innerText?.trim();
    }
    return null;
  }

  // Extract interactive elements
  const interactiveSelectors = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="option"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])'
  ];

  const interactiveElements = document.querySelectorAll(interactiveSelectors.join(','));

  for (const el of interactiveElements) {
    if (!isVisible(el)) continue;

    const ref = getRef(el, el.tagName.toLowerCase().substring(0, 3));
    const rect = el.getBoundingClientRect();

    const element = {
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      text: getElementText(el) || undefined,
      placeholder: el.placeholder || undefined,
      value: el.value || undefined,
      selector: getSelector(el),
      type: el.type || undefined,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
      inViewport: isInViewport(el),
      ariaLabel: el.getAttribute('aria-label') || undefined,
      name: el.name || undefined,
      labelText: (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
        ? getLabelForInput(el)
        : undefined,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };

    // Clean up undefined values
    Object.keys(element).forEach(key => {
      if (element[key] === undefined || element[key] === '') {
        delete element[key];
      }
    });

    context.elements.push(element);
  }

  // Extract forms
  const forms = document.querySelectorAll('form');

  for (const form of forms) {
    if (!isVisible(form)) continue;

    const formRef = getRef(form, 'form');
    const fields = [];

    // Get all form fields
    const formInputs = form.querySelectorAll('input:not([type="hidden"]), select, textarea');

    for (const input of formInputs) {
      if (!isVisible(input)) continue;

      const fieldRef = getRef(input, 'field');
      const field = {
        ref: fieldRef,
        selector: getSelector(input),
        type: input.type || input.tagName.toLowerCase(),
        name: input.name || undefined,
        label: getLabelForInput(input) || undefined,
        placeholder: input.placeholder || undefined,
        value: input.type === 'password' ? (input.value ? '••••' : '') : (input.value || undefined),
        required: input.required || input.getAttribute('aria-required') === 'true',
        disabled: input.disabled,
        pattern: input.pattern || undefined,
        min: input.min || undefined,
        max: input.max || undefined,
        autocomplete: input.autocomplete || undefined
      };

      // Get options for select
      if (input.tagName === 'SELECT') {
        field.options = Array.from(input.options).map(opt => ({
          value: opt.value,
          text: opt.text,
          selected: opt.selected || undefined
        }));
      }

      // Clean up undefined values
      Object.keys(field).forEach(key => {
        if (field[key] === undefined || field[key] === '') {
          delete field[key];
        }
      });

      fields.push(field);
    }

    // Find submit button
    let submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submitBtn) {
      submitBtn = form.querySelector('button:not([type="button"]):not([type="reset"])');
    }

    // Detect form type
    const formHTML = form.innerHTML.toLowerCase();
    const hasPassword = form.querySelector('input[type="password"]');
    const hasEmail = form.querySelector('input[type="email"], input[name*="email"]');
    const hasUsername = form.querySelector('input[name*="user"], input[name*="login"]');
    const hasConfirmPassword = form.querySelectorAll('input[type="password"]').length > 1;

    const isLoginForm = hasPassword && !hasConfirmPassword && (hasEmail || hasUsername);
    const isSignupForm = hasPassword && (hasConfirmPassword || formHTML.includes('sign up') || formHTML.includes('register') || formHTML.includes('create account'));
    const isSearchForm = form.getAttribute('role') === 'search' || form.querySelector('input[type="search"]') || (form.querySelectorAll('input').length === 1 && formHTML.includes('search'));

    const formAnalysis = {
      ref: formRef,
      selector: getSelector(form),
      action: form.action || undefined,
      method: form.method || undefined,
      name: form.name || form.id || undefined,
      fields,
      submitButton: submitBtn ? {
        ref: getRef(submitBtn, 'btn'),
        selector: getSelector(submitBtn),
        text: getElementText(submitBtn) || submitBtn.value || undefined
      } : undefined,
      isLoginForm,
      isSearchForm,
      isSignupForm
    };

    // Clean up
    Object.keys(formAnalysis).forEach(key => {
      if (formAnalysis[key] === undefined) {
        delete formAnalysis[key];
      }
    });

    context.forms.push(formAnalysis);
  }

  // Extract page structure
  // Headings
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const h of headings) {
    if (!isVisible(h)) continue;
    context.structure.headings.push({
      level: parseInt(h.tagName[1]),
      text: h.innerText?.trim().substring(0, 100) || '',
      ref: getRef(h, 'h')
    });
  }

  // Landmarks
  const landmarks = document.querySelectorAll('[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], main, nav, header, footer, aside');
  for (const lm of landmarks) {
    if (!isVisible(lm)) continue;
    const role = lm.getAttribute('role') || lm.tagName.toLowerCase();
    context.structure.landmarks.push({
      role,
      label: lm.getAttribute('aria-label') || undefined,
      ref: getRef(lm, 'lm')
    });
  }

  // Navigation areas
  const navs = document.querySelectorAll('nav, [role="navigation"]');
  for (const nav of navs) {
    if (!isVisible(nav)) continue;
    context.structure.navigation.push({
      ref: getRef(nav, 'nav'),
      selector: getSelector(nav),
      links: nav.querySelectorAll('a').length
    });
  }

  // Main content
  const main = document.querySelector('main, [role="main"]');
  if (main) {
    context.structure.mainContent = getSelector(main);
  }

  // Focused element
  if (document.activeElement && document.activeElement !== document.body) {
    context.focusedElement = getRef(document.activeElement, 'focus');
  }

  // Check for dialogs/modals
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]');
  for (const dialog of dialogs) {
    if (!isVisible(dialog)) continue;
    context.dialogs.push({
      type: dialog.getAttribute('role') === 'alertdialog' ? 'alert' : 'modal',
      message: dialog.innerText?.substring(0, 500),
      isModal: true,
      buttons: Array.from(dialog.querySelectorAll('button')).map(b => b.innerText?.trim()).filter(Boolean)
    });
  }

  // Extract visible text (truncated)
  const mainEl = document.querySelector('main, [role="main"], article') || document.body;
  const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let visibleText = '';
  while (walker.nextNode() && visibleText.length < 3000) {
    const text = walker.currentNode.textContent?.trim();
    if (text && text.length > 1) {
      visibleText += text + ' ';
    }
  }
  context.visibleText = visibleText.trim().substring(0, 3000);

  return context;
})();
`;

// ============================================================================
// Form Filling Script
// ============================================================================

/**
 * Script to fill form fields. Takes a map of selectors to values.
 */
export function createFormFillScript(
  fields: { selector: string; value: string }[],
): string {
  const fieldsJson = JSON.stringify(fields);
  return `
(function fillForm() {
  const fields = ${fieldsJson};
  const results = [];

  for (const { selector, value } of fields) {
    try {
      const el = document.querySelector(selector);
      if (!el) {
        results.push({ selector, success: false, error: 'Element not found' });
        continue;
      }

      // Focus the element
      el.focus();

      if (el.tagName === 'SELECT') {
        // Handle select
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ selector, success: true, type: 'select' });
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        // Handle checkbox/radio
        const shouldCheck = value === 'true' || value === '1' || value === 'checked';
        if (el.checked !== shouldCheck) {
          el.click();
        }
        results.push({ selector, success: true, type: el.type });
      } else {
        // Handle text input
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));

        // Type character by character for better compatibility
        for (const char of value) {
          el.value += char;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }

        el.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ selector, success: true, type: 'text' });
      }
    } catch (err) {
      results.push({ selector, success: false, error: err.message });
    }
  }

  return { success: results.every(r => r.success), results };
})();
`;
}

// ============================================================================
// Simplified Context for Token Efficiency
// ============================================================================

/**
 * Create a minimal context representation for very token-constrained scenarios.
 * Only includes elements in viewport and essential form info.
 */
export function simplifyContext(context: PageContext): {
  url: string;
  title: string;
  elements: Array<{
    ref: string;
    tag: string;
    text?: string;
    type?: string;
    selector: string;
  }>;
  forms: FormAnalysis[];
  visibleText: string;
  extractedAt: string;
} {
  return {
    url: context.url,
    title: context.title,
    // Only elements in viewport
    elements: context.elements
      .filter((el) => el.inViewport)
      .map((el) => ({
        ref: el.ref,
        tag: el.tag,
        text: el.text?.substring(0, 50),
        type: el.type,
        selector: el.selector,
      })),
    // Full form info (needed for automation)
    forms: context.forms,
    // Truncated visible text
    visibleText: context.visibleText.substring(0, 1000),
    extractedAt: context.extractedAt,
  };
}

/**
 * Format context as a human-readable string for the model.
 * More efficient than JSON for some models.
 */
export function formatContextAsText(context: PageContext): string {
  const lines: string[] = [];

  lines.push(`Page: ${context.title}`);
  lines.push(`URL: ${context.url}`);
  lines.push("");

  if (context.dialogs.length > 0) {
    lines.push("⚠️ DIALOGS PRESENT:");
    for (const dialog of context.dialogs) {
      lines.push(`  - ${dialog.type}: ${dialog.message?.substring(0, 100)}`);
      if (dialog.buttons) {
        lines.push(`    Buttons: ${dialog.buttons.join(", ")}`);
      }
    }
    lines.push("");
  }

  if (context.forms.length > 0) {
    lines.push("FORMS:");
    for (const form of context.forms) {
      const formType = form.isLoginForm
        ? "Login"
        : form.isSignupForm
          ? "Signup"
          : form.isSearchForm
            ? "Search"
            : "Form";
      lines.push(`  [${form.ref}] ${formType} (${form.fields.length} fields)`);
      for (const field of form.fields) {
        const label = field.label || field.placeholder || field.name || "?";
        const value = field.value ? `="${field.value}"` : "";
        const required = field.required ? "*" : "";
        lines.push(
          `    [${field.ref}] ${field.type}${required}: ${label}${value}`,
        );
      }
      if (form.submitButton) {
        lines.push(
          `    Submit: [${form.submitButton.ref}] "${form.submitButton.text || "Submit"}"`,
        );
      }
      lines.push("");
    }
  }

  // Interactive elements (not in forms)
  const formFieldRefs = new Set(
    context.forms.flatMap((f) => f.fields.map((field) => field.ref)),
  );
  const standaloneElements = context.elements.filter(
    (el) => !formFieldRefs.has(el.ref) && el.inViewport,
  );

  if (standaloneElements.length > 0) {
    lines.push("INTERACTIVE ELEMENTS (in viewport):");
    for (const el of standaloneElements.slice(0, 30)) {
      // Limit to 30
      const text = el.text || el.ariaLabel || el.placeholder || "";
      lines.push(`  [${el.ref}] ${el.tag}: ${text.substring(0, 50)}`);
    }
    lines.push("");
  }

  if (context.structure.headings.length > 0) {
    lines.push("PAGE STRUCTURE:");
    for (const h of context.structure.headings.slice(0, 10)) {
      lines.push(`  ${"#".repeat(h.level)} ${h.text}`);
    }
    lines.push("");
  }

  lines.push("VISIBLE TEXT (excerpt):");
  lines.push(context.visibleText.substring(0, 500));

  return lines.join("\n");
}
