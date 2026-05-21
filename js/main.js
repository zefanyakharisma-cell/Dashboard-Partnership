/* =========================================================================
   Petra Partnership Dashboard — MoU / MoA / IA portfolio for
   Petra Christian University (Universitas Kristen Petra).
   Vanilla JS SPA with localStorage persistence; data loaded from /data.
   ========================================================================= */
'use strict';

/* ============================ Constants ================================== */

const STORAGE_KEY = 'unicollab_state_v3';
const SESSION_KEY = 'unicollab_session_v1';

const WORKFLOW_STAGES = [
  'Drafting',
  'Internal Review',
  'Legal Review',
  'Partner Review',
  'Waiting Signature',
  'Signed',
  'Completed',
  'Archived',
];

// Statuses derived from the real partnership lifecycle (see scripts/convert_partnerships.py).
const LIFECYCLE_STATUSES = [
  'Active',
  'Auto-renewed',
  'Open-ended',
  'Pending Approval',
  'Renewal In Progress',
  'Ended',
  'Expired',
  'Unknown',
];

const ALL_STATUSES = [...WORKFLOW_STAGES, ...LIFECYCLE_STATUSES];

// "Archived" here means: signed + indexable in the public Library.
// Includes both workflow-style terminal states and lifecycle-style signed states.
const ARCHIVE_STATUSES = [
  'Signed', 'Completed', 'Finalized', 'Archived',
  'Active', 'Auto-renewed', 'Open-ended', 'Ended', 'Expired',
];

// Statuses that still need human action before the agreement is binding.
const IN_PROGRESS_STATUSES = [
  'Drafting', 'Internal Review', 'Legal Review', 'Partner Review',
  'Waiting Signature', 'Pending Approval', 'Renewal In Progress',
];

const AGREEMENT_TYPES = ['MoU', 'MoA', 'IA'];

// Groupings exposed as filter dropdowns on the agreement database.
// Keep in sync with meta.json (by_institution_type, by_scope).
const INSTITUTION_TYPES = ['education', 'industry', 'organization', 'government', 'foundation'];
const SCOPES = ['learning', 'research', 'student_affairs', 'community_service'];
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const isLifecycleStatus = (s) => LIFECYCLE_STATUSES.includes(s);
const isLiveAgreement  = (s) => ['Active', 'Auto-renewed', 'Open-ended', 'Signed', 'Completed'].includes(s);

const typeChipClass = (t) => ({
  MoU: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  MoA: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  IA:  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
}[t] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300');

/* ============================ Utilities ================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const fmtDateTime = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const daysUntil = (d) => {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const stageProgress = (stage) => {
  const workflowIdx = WORKFLOW_STAGES.indexOf(stage);
  if (workflowIdx >= 0) {
    return Math.round((workflowIdx / (WORKFLOW_STAGES.length - 1)) * 100);
  }
  // Lifecycle statuses don't have an ordered workflow — map to representative %
  const lifecycleMap = {
    'Pending Approval':     20,
    'Renewal In Progress':  75,
    'Active':              100,
    'Auto-renewed':        100,
    'Open-ended':          100,
    'Ended':               100,
    'Expired':             100,
    'Unknown':              50,
  };
  return lifecycleMap[stage] ?? 0;
};

const pillClass = (status) => {
  const map = {
    'Drafting': 'pill-drafting',
    'Internal Review': 'pill-internal',
    'Legal Review': 'pill-legal',
    'Partner Review': 'pill-partner',
    'Waiting Signature': 'pill-signature',
    'Signed': 'pill-signed',
    'Completed': 'pill-completed',
    'Finalized': 'pill-finalized',
    'Archived': 'pill-archived',
    // Lifecycle statuses
    'Active':              'pill-signed',
    'Auto-renewed':        'pill-renewed',
    'Open-ended':          'pill-openended',
    'Pending Approval':    'pill-pending',
    'Renewal In Progress': 'pill-renewal',
    'Ended':               'pill-archived',
    'Expired':             'pill-expiring',
    'Unknown':             'pill-drafting',
  };
  return map[status] || 'pill-drafting';
};

const refreshIcons = () => {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
};

const debounce = (fn, delay = 200) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
};

const downloadFile = (filename, content, mime = 'text/plain') => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* ============================ Toast ====================================== */

const Toast = {
  show(message, type = 'info', timeout = 3500) {
    const container = $('#toast-container');
    if (!container) return;
    const id = uid('toast');
    const palette = {
      info:    { bg: 'bg-slate-900 dark:bg-slate-100', text: 'text-white dark:text-slate-900', icon: 'info' },
      success: { bg: 'bg-emerald-600',  text: 'text-white', icon: 'check-circle-2' },
      error:   { bg: 'bg-rose-600',     text: 'text-white', icon: 'alert-circle' },
      warning: { bg: 'bg-amber-500',    text: 'text-white', icon: 'alert-triangle' },
    }[type] || {};
    const el = document.createElement('div');
    el.id = id;
    el.className = `toast ${palette.bg} ${palette.text} rounded-xl shadow-lg shadow-slate-900/20 px-4 py-3 flex items-start gap-3`;
    el.innerHTML = `
      <i data-lucide="${palette.icon}" class="w-5 h-5 mt-0.5 shrink-0"></i>
      <div class="text-sm font-medium leading-snug flex-1">${escapeHtml(message)}</div>
      <button class="opacity-70 hover:opacity-100" data-dismiss="${id}">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>`;
    container.appendChild(el);
    refreshIcons();
    el.querySelector(`[data-dismiss="${id}"]`).addEventListener('click', () => Toast.dismiss(id));
    if (timeout > 0) setTimeout(() => Toast.dismiss(id), timeout);
  },
  dismiss(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('removing');
    setTimeout(() => el.remove(), 200);
  },
};

/* ============================ Modal ====================================== */

const Modal = {
  open({ title, body, actions = [], size = 'md' }) {
    const container = $('#modal-container');
    container.innerHTML = '';
    const sizeMap = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[90] flex items-center justify-center p-4';
    wrap.innerHTML = `
      <div class="modal-overlay absolute inset-0 bg-slate-900/60 backdrop-blur-sm" data-close></div>
      <div class="modal-card relative w-full ${sizeMap[size] || sizeMap.md} bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 class="text-base font-semibold text-slate-900 dark:text-white">${escapeHtml(title)}</h3>
          <button data-close class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <div class="px-5 py-4 overflow-y-auto text-sm">${body}</div>
        <div class="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-end gap-2" id="modal-actions"></div>
      </div>`;
    container.appendChild(wrap);
    const actionsRow = wrap.querySelector('#modal-actions');
    actions.forEach((a, i) => {
      const btn = document.createElement('button');
      const variant = a.variant || 'secondary';
      const variantCls = {
        primary:  'bg-brand-600 hover:bg-brand-700 text-white',
        danger:   'bg-rose-600 hover:bg-rose-700 text-white',
        secondary:'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700',
        ghost:    'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300',
      }[variant];
      btn.className = `px-3.5 py-2 rounded-lg text-sm font-medium ${variantCls}`;
      btn.textContent = a.label;
      btn.addEventListener('click', () => {
        const close = a.onClick?.();
        if (close !== false) Modal.close();
      });
      actionsRow.appendChild(btn);
    });
    wrap.querySelectorAll('[data-close]').forEach((el) =>
      el.addEventListener('click', () => Modal.close()),
    );
    refreshIcons();
    return wrap;
  },
  confirm({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      Modal.open({
        title,
        body: `<p class="text-slate-600 dark:text-slate-300">${escapeHtml(message)}</p>`,
        actions: [
          { label: 'Cancel', variant: 'secondary', onClick: () => resolve(false) },
          { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
        ],
      });
    });
  },
  close() {
    $('#modal-container').innerHTML = '';
  },
};

/* ============================ Combobox =================================== */
// Searchable combobox with optional "Add new" affordance. Renders HTML; call
// Combobox.init(rootEl, opts) after the form is mounted to wire up listeners.

const Combobox = {
  render({ name, value = '', required = false, placeholder = 'Search…' }) {
    return `
      <div class="combobox relative">
        <input type="hidden" class="cb-value" name="${name}" value="${escapeHtml(value)}" ${required ? 'data-required="1"' : ''} />
        <input type="text" autocomplete="off" class="cb-search w-full h-10 pl-3 pr-9 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" placeholder="${escapeHtml(placeholder)}" />
        <button type="button" class="cb-toggle absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600">
          <i data-lucide="chevron-down" class="w-4 h-4"></i>
        </button>
        <div class="cb-panel hidden absolute z-30 mt-1 left-0 right-0 max-h-64 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg"></div>
      </div>
    `;
  },

  init(root, opts) {
    const options = opts.options.slice();
    const value = root.querySelector('.cb-value');
    const search = root.querySelector('.cb-search');
    const toggle = root.querySelector('.cb-toggle');
    const panel = root.querySelector('.cb-panel');
    let opened = false;

    const labelFor = (id) => options.find((o) => o.id === id)?.label || '';

    const select = (opt) => {
      value.value = opt.id;
      search.value = opt.label;
      close();
      opts.onSelect?.(opt);
    };

    const open = () => { opened = true; panel.classList.remove('hidden'); render(search.value); };
    const close = () => { opened = false; panel.classList.add('hidden'); };

    const render = (q = '') => {
      const ql = q.toLowerCase().trim();
      const matches = options.filter((o) => {
        if (!ql) return true;
        return o.label.toLowerCase().includes(ql) || (o.sublabel || '').toLowerCase().includes(ql);
      }).slice(0, 100);

      const items = matches.map((o) => `
        <button type="button" data-id="${escapeHtml(o.id)}" class="cb-item w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 ${o.id === value.value ? 'bg-brand-50 dark:bg-brand-500/10' : ''}">
          <div class="text-sm font-medium text-slate-800 dark:text-slate-200">${escapeHtml(o.label)}</div>
          ${o.sublabel ? `<div class="text-xs text-slate-500">${escapeHtml(o.sublabel)}</div>` : ''}
        </button>
      `).join('');

      const showAdd = opts.allowAdd && ql && !options.some((o) => o.label.toLowerCase() === ql);
      const addRow = showAdd ? `
        <button type="button" class="cb-add w-full text-left px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <i data-lucide="plus" class="w-4 h-4"></i>
          <span>${escapeHtml(opts.addLabel || 'Add')} "<strong>${escapeHtml(search.value.trim())}</strong>"</span>
        </button>` : '';

      panel.innerHTML = matches.length
        ? items + addRow
        : `<div class="px-3 py-4 text-sm text-slate-500 text-center">${escapeHtml(opts.noMatch || 'No matches')}</div>${addRow}`;
      refreshIcons();

      panel.querySelectorAll('.cb-item').forEach((el) => {
        el.addEventListener('click', () => {
          const opt = options.find((o) => o.id === el.dataset.id);
          if (opt) select(opt);
        });
      });
      panel.querySelector('.cb-add')?.addEventListener('click', () => {
        const name = search.value.trim();
        opts.onAdd?.(name, (newOpt) => {
          if (!newOpt) return;
          options.unshift(newOpt);
          select(newOpt);
        });
      });
    };

    search.addEventListener('focus', open);
    search.addEventListener('input', () => { value.value = ''; render(search.value); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); search.blur(); }
    });
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      if (opened) close(); else { search.focus(); open(); }
    });

    const outside = (e) => {
      if (!root.contains(e.target)) {
        const lbl = labelFor(value.value);
        if (search.value !== lbl) search.value = lbl;
        close();
      }
    };
    document.addEventListener('click', outside);
    Router.onCleanup(() => document.removeEventListener('click', outside));

    if (value.value) search.value = labelFor(value.value);
  },
};

/* ============================ Time helpers =============================== */

const formatElapsed = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const day = Math.floor(sec / 86400);
  const hr = Math.floor((sec % 86400) / 3600);
  const min = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (day > 0) return `${day}d ${hr}h ${min}m`;
  if (hr > 0) return `${hr}h ${min}m ${s}s`;
  if (min > 0) return `${min}m ${s}s`;
  return `${s}s`;
};

/* ============================ Store / Database Loader ==================== */

const Store = {
  state: null,

  async load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.state = JSON.parse(raw);
        if (this._ensureSeedUsers()) this.save();
        return this.state;
      }
    } catch (e) { /* ignore */ }
    // First boot (or after a reset) — load the partnership database from /data.
    this.state = await this.loadRealData();
    this.save();
    return this.state;
  },

  // Merge any missing seed users into the persisted state. Returns true if the
  // state was modified. Older localStorage snapshots predate the admin seed,
  // which left signed-in admins matched as Viewer.
  _ensureSeedUsers() {
    if (!this.state || !Array.isArray(this.state.users)) return false;
    let changed = false;
    for (const seed of this.defaultUsers()) {
      const email = (seed.email || '').toLowerCase();
      const existing = this.state.users.find((u) => (u.email || '').toLowerCase() === email);
      if (!existing) {
        this.state.users.push(seed);
        changed = true;
      } else if (existing.role !== seed.role) {
        existing.role = seed.role;
        changed = true;
      }
    }
    return changed;
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      // QuotaExceeded is possible with 1k+ records on some browsers; log and continue.
      console.warn('Store.save: localStorage write failed', e);
    }
  },

  async reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.state = await this.loadRealData();
    this.save();
  },

  // Load institutions/departments/agreements from /data and adapt to the
  // dashboard's camelCase shape. Throws if any file is unreachable — the
  // app requires the partnership database, no fallback dataset exists.
  async loadRealData() {
    const fetchJson = async (path) => {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
      return r.json();
    };
    const [insts, depts, ags] = await Promise.all([
      fetchJson('data/institutions.json'),
      fetchJson('data/departments.json'),
      fetchJson('data/agreements.json'),
    ]);
    return this.buildStateFromSource(insts, depts, ags);
  },

  buildStateFromSource(srcInstitutions, srcDepartments, srcAgreements) {
    // The source database has no user records — seed the single Admin account
    // so the admin console is reachable. PIC defaults to the Admin.
    const users = this.defaultUsers();
    const picPool = users.filter((u) => u.active && u.role !== 'Viewer');

    const institutions = srcInstitutions.map((i) => ({
      id: i.id,
      name: i.name,
      country: i.country || i.city || '—',
      type: i.type || 'University',
      institutionTypes: i.institution_types || [],
      // Preserved extras for richer rendering
      kind: i.kind,
      city: i.city,
      address: i.address,
      canonicalName: i.canonical_name,
    }));

    const departments = srcDepartments.map((d) => ({
      id: d.id,
      name: d.name || d.short,
      short: d.short,
      isFaculty: !!d.is_faculty,
    }));

    const agreements = srcAgreements.map((a, idx) => {
      const status = a.status || 'Unknown';
      const isLive = ['Active', 'Auto-renewed', 'Open-ended', 'Ended', 'Expired'].includes(status);
      const startIso = a.start_date ? new Date(a.start_date).toISOString() : new Date().toISOString();
      const endIso   = a.end_date   ? new Date(a.end_date).toISOString()   : null;
      const tags = [a.kind, a.scope, a.implementing_unit, ...(a.scope_tags || [])]
        .filter(Boolean)
        .map(String)
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 4);
      // The source has no real PIC — round-robin across active non-viewer
      // users so "My Agreements" shows something for the signed-in admin.
      const pic = picPool[idx % picPool.length];
      return {
        id: a.id,
        code: a.code,
        title: a.title,
        type: (a.type === 'Unknown' ? 'MoU' : a.type),
        institutionId: a.institution_id,
        departmentId: a.department_id,
        picUserId: pic.id,
        status,
        progress: stageProgress(status),
        startDate: startIso,
        endDate: endIso,
        signedDate: isLive ? startIso : null,
        createdAt: startIso,
        updatedAt: startIso,
        description: a.agenda || '',
        notes: a.note || '',
        tags,
        files: [],
        statusHistory: [{
          from: null, to: status,
          at: startIso, by: pic.id,
          note: 'Imported from source data',
        }],
        // Preserved source fields surfaced in the detail view
        sourceNo: a.source_no,
        kind: a.kind,
        scope: a.scope,
        scopeTags: a.scope_tags || [],
        implementingUnit: a.implementing_unit,
        units: a.units || [],
        unitDepartmentIds: a.unit_department_ids || [],
        institutionType: a.institution_type || [],
        newPartner: !!a.new_partner,
        endDateKind: a.end_date_kind,
        endDateRaw: a.end_date_raw,
        renewalDate: a.renewal_date,
        renewalInfoRaw: a.renewal_info_raw,
        realization: a.realization,
        degreeProgram: a.degree_program,
        nonDegreeProgram: a.non_degree_program,
      };
    });

    // Activity logs: one CREATED per agreement; sorted desc by date.
    // 1k+ rows is fine — the UI only ever shows the head of this list.
    const activityLogs = agreements.map((ag) => ({
      id: uid('log'),
      agreementId: ag.id,
      userId: ag.picUserId,
      action: 'CREATED',
      message: `Agreement "${ag.title}" imported`,
      at: ag.startDate,
    }));
    activityLogs.sort((a, b) => new Date(b.at) - new Date(a.at));

    // Expiration notifications for agreements expiring within 60 days.
    const notifications = [];
    agreements.forEach((ag) => {
      const d = daysUntil(ag.endDate);
      if (d !== null && d > 0 && d <= 60 && isLiveAgreement(ag.status)) {
        notifications.push({
          id: uid('n'),
          type: 'expiration',
          title: 'Agreement nearing expiration',
          message: `"${ag.title}" expires in ${d} days.`,
          agreementId: ag.id,
          read: false,
          at: new Date().toISOString(),
        });
      }
    });
    notifications.push({
      id: uid('n'),
      type: 'info',
      title: 'Real partnership data loaded',
      message: `${agreements.length} agreements across ${institutions.length} institutions imported from data/.`,
      read: false,
      at: new Date().toISOString(),
    });

    return {
      version: 2,
      theme: 'light',
      departments,
      institutions,
      users,
      agreements,
      activityLogs,
      notifications,
    };
  },

  defaultUsers() {
    return [
      { id: 'u1', name: 'Zefanya Kharisma Nugroho', email: 'zefanya.kharisma@gmail.com', role: 'Admin', department: null, avatar: '👩‍💼', active: true },
    ];
  },

};

/* ============================ Selectors / Helpers ======================== */

const findInstitution = (id) => Store.state.institutions.find((i) => i.id === id);
const findDepartment = (id) => Store.state.departments.find((d) => d.id === id);
const findUser = (id) => Store.state.users.find((u) => u.id === id);
const findAgreement = (id) => Store.state.agreements.find((a) => a.id === id);

/* ============================ Auth (Supabase) ============================ */
/*
 * Authentication is backed by Supabase Auth (email + password, magic-link,
 * and sign-up). Local user records in Store.state.users are kept so role,
 * name, and avatar continue to drive UI; we match a Supabase session to a
 * local user by email. Unmapped Supabase users get a minimal "Viewer" record
 * so they can still sign in, but won't have admin privileges until an entry
 * is added in User Management.
 */

const Auth = {
  current: null,        // { id, name, email, role, avatar }
  supabaseUser: null,   // raw Supabase user object (for id, metadata)
  _authSub: null,

  _client() {
    return window.supabaseClient || null;
  },

  _hydrateFromSupabaseUser(supaUser) {
    if (!supaUser) {
      this.current = null;
      this.supabaseUser = null;
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    this.supabaseUser = supaUser;
    const email = (supaUser.email || '').toLowerCase();
    const local = Store.state.users.find((u) => (u.email || '').toLowerCase() === email);
    if (local) {
      this.current = {
        id: local.id,
        name: local.name,
        email: local.email,
        role: local.role,
        avatar: local.avatar,
      };
    } else {
      const meta = supaUser.user_metadata || {};
      this.current = {
        id: supaUser.id,
        name: meta.name || meta.full_name || supaUser.email || 'New user',
        email: supaUser.email,
        role: 'Viewer',
        avatar: '👤',
      };
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.current));
  },

  async init() {
    const client = this._client();
    if (!client) {
      // No Supabase SDK — fall back to whatever we had in sessionStorage so the
      // app at least renders. Login attempts will fail with a clear error.
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) this.current = JSON.parse(raw);
      } catch { /* ignore */ }
      return;
    }
    try {
      const { data } = await client.auth.getSession();
      this._hydrateFromSupabaseUser(data && data.session ? data.session.user : null);
    } catch (err) {
      console.warn('[auth] getSession failed:', err);
    }
    // Re-render the current route whenever the auth state changes so guarded
    // pages flip in/out as the session does.
    if (this._authSub && this._authSub.subscription) {
      this._authSub.subscription.unsubscribe();
    }
    this._authSub = client.auth.onAuthStateChange((_event, session) => {
      this._hydrateFromSupabaseUser(session ? session.user : null);
      if (window.Router && typeof Router.render === 'function') Router.render();
    });
  },

  async login(email, password) {
    const client = this._client();
    if (!client) return { ok: false, error: 'Supabase is not configured. Edit js/supabase-client.js.' };
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message || 'Invalid email or password.' };
    this._hydrateFromSupabaseUser(data.user);
    return { ok: true };
  },

  async signUp(email, password, name) {
    const client = this._client();
    if (!client) return { ok: false, error: 'Supabase is not configured. Edit js/supabase-client.js.' };
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { name: name || '' },
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) return { ok: false, error: error.message };
    // If "Confirm email" is enabled in Supabase, session will be null here and
    // the user must click the verification link before they can log in.
    if (data.session) {
      this._hydrateFromSupabaseUser(data.user);
      return { ok: true, needsConfirmation: false };
    }
    return { ok: true, needsConfirmation: true };
  },

  async sendMagicLink(email) {
    const client = this._client();
    if (!client) return { ok: false, error: 'Supabase is not configured. Edit js/supabase-client.js.' };
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  async logout() {
    const client = this._client();
    if (client) {
      try { await client.auth.signOut(); } catch (err) { console.warn('[auth] signOut failed:', err); }
    }
    this.current = null;
    this.supabaseUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    Router.go('/');
  },

  isAuthed() { return !!this.current; },
};

/* ============================ Theme ====================================== */

const Theme = {
  apply(theme) {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    Store.state.theme = theme;
    Store.save();
  },
  toggle() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    this.apply(next);
    // refresh any active charts
    setTimeout(() => Router.render(), 50);
  },
  init() { this.apply(Store.state.theme || 'light'); },
};

/* ============================ Router ===================================== */

const Router = {
  routes: [],
  current: null,
  params: {},

  add(pattern, handler, opts = {}) {
    this.routes.push({ pattern, handler, opts });
  },

  match(path) {
    for (const r of this.routes) {
      if (typeof r.pattern === 'string') {
        if (r.pattern === path) return { route: r, params: {} };
      } else {
        const m = path.match(r.pattern);
        if (m) return { route: r, params: m.groups || {} };
      }
    }
    return null;
  },

  go(path) {
    location.hash = '#' + path;
  },

  parseHash() {
    let h = location.hash || '#/';
    if (h.startsWith('#')) h = h.slice(1);
    if (!h.startsWith('/')) h = '/' + h;
    return h;
  },

  _cleanups: [],
  onCleanup(fn) { this._cleanups.push(fn); },

  render() {
    this._cleanups.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    this._cleanups = [];
    const path = this.parseHash();
    const match = this.match(path) || this.match('/404');
    this.current = path;
    this.params = match.params;
    if (match.route.opts.requireAuth && !Auth.isAuthed()) {
      this.go('/login');
      return;
    }
    match.route.handler(match.params);
    refreshIcons();
    window.scrollTo({ top: 0, behavior: 'instant' });
  },

  init() {
    window.addEventListener('hashchange', () => this.render());
    this.render();
  },
};

/* ============================ Charts ===================================== */

const Charts = {
  instances: {},

  destroy(id) {
    if (this.instances[id]) {
      this.instances[id].destroy();
      delete this.instances[id];
    }
  },

  destroyAll() {
    Object.keys(this.instances).forEach((k) => this.destroy(k));
  },

  axisColor() {
    return document.documentElement.classList.contains('dark') ? '#94a3b8' : '#475569';
  },
  gridColor() {
    return document.documentElement.classList.contains('dark') ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)';
  },

  statusPie(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const counts = {};
    Store.state.agreements.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
    const labels = Object.keys(counts);
    const data = labels.map((l) => counts[l]);
    const palette = ['#3a5fff', '#0ea5e9', '#f59e0b', '#8b5cf6', '#f97316', '#22c55e', '#10b981', '#64748b'];
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: palette, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: this.axisColor(), boxWidth: 10, padding: 14, font: { size: 11 } } },
        },
      },
    });
  },

  departmentBar(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const labels = Store.state.departments.map((d) => d.short);
    const data = Store.state.departments.map(
      (d) => Store.state.agreements.filter((a) => a.departmentId === d.id).length,
    );
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{
        label: 'Agreements',
        data,
        backgroundColor: 'rgba(58,95,255,0.85)',
        borderRadius: 6,
        maxBarThickness: 28,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: this.axisColor() }, grid: { display: false } },
          y: { ticks: { color: this.axisColor(), precision: 0 }, grid: { color: this.gridColor() } },
        },
      },
    });
  },

  monthlyActivity(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const now = new Date();
    const labels = [];
    const created = new Array(12).fill(0);
    const signed = new Array(12).fill(0);
    const monthIndex = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      labels.push(d.toLocaleString('en-US', { month: 'short' }));
      monthIndex[key] = 11 - i;
    }
    Store.state.agreements.forEach((a) => {
      const c = new Date(a.createdAt);
      const k = `${c.getFullYear()}-${c.getMonth()}`;
      if (monthIndex[k] !== undefined) created[monthIndex[k]]++;
      if (a.signedDate) {
        const s = new Date(a.signedDate);
        const ks = `${s.getFullYear()}-${s.getMonth()}`;
        if (monthIndex[ks] !== undefined) signed[monthIndex[ks]]++;
      }
    });
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Created', data: created, borderColor: '#3a5fff', backgroundColor: 'rgba(58,95,255,0.12)', fill: true, tension: 0.35, borderWidth: 2, pointRadius: 3 },
          { label: 'Signed',  data: signed,  borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)',  fill: true, tension: 0.35, borderWidth: 2, pointRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: this.axisColor(), boxWidth: 10, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: this.axisColor() }, grid: { display: false } },
          y: { ticks: { color: this.axisColor(), precision: 0 }, grid: { color: this.gridColor() } },
        },
      },
    });
  },

  expirationTimeline(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '181-365': 0, '365+': 0 };
    Store.state.agreements.forEach((a) => {
      if (ARCHIVE_STATUSES.includes(a.status) && a.status !== 'Archived') return;
      const d = daysUntil(a.endDate);
      if (d === null || d < 0) return;
      if (d <= 30) buckets['0-30']++;
      else if (d <= 60) buckets['31-60']++;
      else if (d <= 90) buckets['61-90']++;
      else if (d <= 180) buckets['91-180']++;
      else if (d <= 365) buckets['181-365']++;
      else buckets['365+']++;
    });
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels: Object.keys(buckets), datasets: [{
        label: 'Agreements expiring',
        data: Object.values(buckets),
        backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#64748b'],
        borderRadius: 6,
        maxBarThickness: 32,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: this.axisColor() }, grid: { display: false } },
          y: { ticks: { color: this.axisColor(), precision: 0 }, grid: { color: this.gridColor() } },
        },
      },
    });
  },

  countryBar(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const counts = {};
    Store.state.agreements.forEach((a) => {
      const inst = findInstitution(a.institutionId);
      if (!inst) return;
      counts[inst.country] = (counts[inst.country] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([k]) => k);
    const data = sorted.map(([, v]) => v);
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{
        label: 'Partners',
        data,
        backgroundColor: 'rgba(139,92,246,0.85)',
        borderRadius: 6,
        maxBarThickness: 22,
      }] },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: this.axisColor(), precision: 0 }, grid: { color: this.gridColor() } },
          y: { ticks: { color: this.axisColor() }, grid: { display: false } },
        },
      },
    });
  },

  // Domestic vs International ratio — meaningful split in the real dataset.
  kindDonut(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const counts = { International: 0, Domestic: 0, Other: 0 };
    Store.state.agreements.forEach((a) => {
      const k = a.kind || 'Other';
      counts[k] = (counts[k] || 0) + 1;
    });
    const labels = Object.keys(counts).filter((k) => counts[k] > 0);
    const data = labels.map((l) => counts[l]);
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{
        data,
        backgroundColor: ['#3a5fff', '#22c55e', '#94a3b8'],
        borderWidth: 0,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: this.axisColor(), boxWidth: 10, padding: 14, font: { size: 11 } } },
        },
      },
    });
  },

  // Agreements signed by year — replaces the misleading "created vs. signed"
  // monthly chart (imported records share one date for both).
  agreementsByYear(canvasId, { years = 15 } = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const thisYear = new Date().getFullYear();
    const startYear = thisYear - (years - 1);
    const buckets = {};
    for (let y = startYear; y <= thisYear; y++) buckets[y] = { intl: 0, dom: 0 };
    Store.state.agreements.forEach((a) => {
      if (!a.startDate) return;
      const y = new Date(a.startDate).getFullYear();
      if (y < startYear || y > thisYear) return;
      if (a.kind === 'International') buckets[y].intl++;
      else buckets[y].dom++;
    });
    const labels = Object.keys(buckets);
    const intl = labels.map((y) => buckets[y].intl);
    const dom  = labels.map((y) => buckets[y].dom);
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'International', data: intl, backgroundColor: 'rgba(58,95,255,0.85)',  borderRadius: 4, maxBarThickness: 24, stack: 's' },
          { label: 'Domestic',      data: dom,  backgroundColor: 'rgba(34,197,94,0.85)',  borderRadius: 4, maxBarThickness: 24, stack: 's' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: this.axisColor(), boxWidth: 10, font: { size: 11 } } } },
        scales: {
          x: { stacked: true, ticks: { color: this.axisColor() }, grid: { display: false } },
          y: { stacked: true, ticks: { color: this.axisColor(), precision: 0 }, grid: { color: this.gridColor() } },
        },
      },
    });
  },

  // Top 10 partner institutions by total agreements — bar list.
  topPartnersBar(canvasId, { limit = 10 } = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const counts = {};
    Store.state.agreements.forEach((a) => {
      counts[a.institutionId] = (counts[a.institutionId] || 0) + 1;
    });
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, n]) => {
        const inst = findInstitution(id);
        return { name: inst?.canonicalName || inst?.name || id, n };
      });
    this.destroy(canvasId);
    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top.map((t) => t.name.length > 42 ? t.name.slice(0, 41) + '…' : t.name),
        datasets: [{
          label: 'Agreements',
          data: top.map((t) => t.n),
          backgroundColor: 'rgba(34,197,94,0.85)',
          borderRadius: 6,
          maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: this.axisColor(), precision: 0 }, grid: { color: this.gridColor() } },
          y: { ticks: { color: this.axisColor(), font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
  },
};

/* ============================ UI Atoms =================================== */

const UI = {
  kpiCard({ label, value, icon, tone = 'brand', delta }) {
    const toneCls = {
      brand:   'from-brand-500 to-brand-700',
      emerald: 'from-emerald-500 to-emerald-700',
      amber:   'from-amber-500 to-amber-700',
      rose:    'from-rose-500 to-rose-700',
      violet:  'from-violet-500 to-violet-700',
      sky:     'from-sky-500 to-sky-700',
    }[tone];
    return `
      <div class="kpi-card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex items-start gap-4">
        <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${toneCls} flex items-center justify-center text-white shadow-lg shadow-slate-900/10 shrink-0">
          <i data-lucide="${icon}" class="w-6 h-6"></i>
        </div>
        <div class="min-w-0">
          <div class="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">${escapeHtml(label)}</div>
          <div class="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">${escapeHtml(String(value))}</div>
          ${delta ? `<div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">${escapeHtml(delta)}</div>` : ''}
        </div>
      </div>`;
  },

  card({ title, subtitle, action, body, padding = 'p-5' }) {
    return `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl ${padding}">
        ${title || action ? `
          <div class="flex items-start justify-between mb-4 gap-3">
            <div>
              ${title ? `<h3 class="text-sm font-bold text-slate-900 dark:text-white">${escapeHtml(title)}</h3>` : ''}
              ${subtitle ? `<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">${escapeHtml(subtitle)}</p>` : ''}
            </div>
            ${action || ''}
          </div>` : ''}
        <div>${body}</div>
      </div>`;
  },

  pill(status) {
    return `<span class="pill ${pillClass(status)}">${escapeHtml(status)}</span>`;
  },

  progressBar(percent, tone = 'brand') {
    const toneCls = {
      brand: 'bg-brand-500',
      emerald: 'bg-emerald-500',
      amber: 'bg-amber-500',
      rose: 'bg-rose-500',
    }[tone];
    return `
      <div class="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div class="h-full ${toneCls} rounded-full" style="width:${Math.max(0, Math.min(100, percent))}%"></div>
      </div>`;
  },

  empty({ icon = 'inbox', title = 'Nothing here yet', message = '' }) {
    return `
      <div class="flex flex-col items-center justify-center text-center py-12 px-4">
        <div class="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
          <i data-lucide="${icon}" class="w-7 h-7 text-slate-400"></i>
        </div>
        <h4 class="text-sm font-semibold text-slate-700 dark:text-slate-200">${escapeHtml(title)}</h4>
        ${message ? `<p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">${escapeHtml(message)}</p>` : ''}
      </div>`;
  },
};

/* ============================ Guest Layout =============================== */

function renderGuestLayout(content) {
  const app = $('#app');
  app.innerHTML = `
    <header class="sticky top-0 z-30 backdrop-blur bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <a href="#/" class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <i data-lucide="graduation-cap" class="w-5 h-5 text-white"></i>
          </div>
          <div>
            <div class="font-bold text-slate-900 dark:text-white leading-tight text-sm">Petra Partnership Dashboard</div>
            <div class="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Universitas Kristen Petra · OIA</div>
          </div>
        </a>
        <nav class="hidden md:flex items-center gap-1">
          ${[
            ['/', 'Dashboard'],
            ['/library', 'Partnership Catalog'],
            ['/analytics', 'Analytics'],
          ].map(([href, label]) => {
            const active = Router.current === href;
            return `<a href="#${href}" class="px-3 py-2 text-sm font-medium rounded-lg ${active ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/10' : 'text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-slate-800'}">${label}</a>`;
          }).join('')}
        </nav>
        <div class="flex items-center gap-2">
          <button data-action="toggle-theme" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" title="Toggle theme">
            <i data-lucide="sun-moon" class="w-5 h-5"></i>
          </button>
          ${Auth.isAuthed()
            ? `<a href="#/admin" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-lg shadow-sm shadow-brand-500/20 transition"><i data-lucide="layout-dashboard" class="w-4 h-4"></i>Admin Dashboard</a>`
            : `<a href="#/login" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-lg shadow-sm shadow-brand-500/20 transition"><i data-lucide="log-in" class="w-4 h-4"></i>Admin Login</a>`
          }
        </div>
      </div>
    </header>
    <main class="flex-1">${content}</main>
    <footer class="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 mt-12">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div class="text-sm text-slate-500 dark:text-slate-400">© 2026 Universitas Kristen Petra · Office of International Affairs</div>
        <div class="text-xs text-slate-400 dark:text-slate-500">Built for transparency. Data refreshed in real-time.</div>
      </div>
    </footer>`;
  app.querySelector('[data-action="toggle-theme"]').addEventListener('click', () => Theme.toggle());
}

/* ============================ Guest Pages ================================ */

function viewGuestDashboard() {
  const ags = Store.state.agreements;
  const total = ags.length;
  const active = ags.filter((a) => isLiveAgreement(a.status)).length;
  const underReview = ags.filter((a) => IN_PROGRESS_STATUSES.includes(a.status)).length;
  const autoRenewed = ags.filter((a) => a.status === 'Auto-renewed').length;
  const completed = ags.filter((a) => ['Signed', 'Completed', 'Archived', 'Ended', 'Expired'].includes(a.status)).length;
  const expiring = ags.filter((a) => {
    if (!isLiveAgreement(a.status)) return false;
    const d = daysUntil(a.endDate); return d !== null && d > 0 && d <= 90;
  }).length;
  const recentlySigned = [...ags].filter((a) => a.signedDate).sort((a, b) => new Date(b.signedDate) - new Date(a.signedDate)).slice(0, 5);
  const recentActivity = Store.state.activityLogs.slice(0, 8);

  const kpis = `
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      ${UI.kpiCard({ label: 'Total Agreements', value: total, icon: 'file-text', tone: 'brand' })}
      ${UI.kpiCard({ label: 'Active', value: active, icon: 'activity', tone: 'sky' })}
      ${UI.kpiCard({ label: 'Pending / In Review', value: underReview, icon: 'scan-search', tone: 'amber' })}
      ${UI.kpiCard({ label: 'Auto-renewed', value: autoRenewed, icon: 'repeat', tone: 'violet' })}
      ${UI.kpiCard({ label: 'Signed / Closed', value: completed, icon: 'badge-check', tone: 'emerald' })}
      ${UI.kpiCard({ label: 'Expiring ≤ 90d', value: expiring, icon: 'alarm-clock', tone: 'rose' })}
    </div>`;

  const content = `
    <section class="hero-pattern">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 text-xs font-semibold">
              <span class="w-1.5 h-1.5 rounded-full bg-brand-500"></span>
              PUBLIC PORTFOLIO
            </div>
            <h1 class="mt-3 text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">Petra Partnership Portfolio</h1>
            <p class="mt-2 text-slate-600 dark:text-slate-400 max-w-2xl">
              An open record of Universitas Kristen Petra's collaborations — Memoranda of Understanding (MoU), Memoranda of Agreement (MoA), and Implementation Arrangements (IA) — with partner institutions across Indonesia and around the world.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <a href="#/library" class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-brand-500 rounded-lg text-sm font-semibold">
              <i data-lucide="library" class="w-4 h-4"></i> Browse Catalog
            </a>
            <a href="#/analytics" class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold">
              <i data-lucide="bar-chart-3" class="w-4 h-4"></i> View Analytics
            </a>
          </div>
        </div>
        <div class="mt-8">${kpis}</div>
      </div>
    </section>

    <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        ${UI.card({
          title: 'Agreements Signed by Year',
          subtitle: 'Domestic and international, last 15 years',
          body: `<div class="h-72"><canvas id="chart-yearly"></canvas></div>`,
        })}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          ${UI.card({
            title: 'Lifecycle Status',
            subtitle: 'Across all agreements',
            body: `<div class="h-64"><canvas id="chart-status"></canvas></div>`,
          })}
          ${UI.card({
            title: 'Domestic vs International',
            subtitle: 'Partnership reach',
            body: `<div class="h-64"><canvas id="chart-kind"></canvas></div>`,
          })}
        </div>
        ${UI.card({
          title: 'Top Partner Institutions',
          subtitle: 'Most active collaborators',
          body: `<div class="h-80"><canvas id="chart-top-partners"></canvas></div>`,
        })}
      </div>

      <aside class="space-y-6">
        ${UI.card({
          title: 'Recently Added Partnerships',
          subtitle: 'Latest agreements on record',
          body: recentlySigned.length ? `<ul class="divide-y divide-slate-100 dark:divide-slate-800">${recentlySigned.map((a) => {
              const inst = findInstitution(a.institutionId);
              return `<li class="py-3 first:pt-0 last:pb-0">
                <a href="#/library" class="block group">
                  <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg ${a.kind === 'International' ? 'bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300' : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'} flex items-center justify-center shrink-0">
                      <i data-lucide="${a.kind === 'International' ? 'globe' : 'map-pin'}" class="w-4 h-4"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-brand-600">${escapeHtml(inst?.name || a.title)}</div>
                      <div class="text-xs text-slate-500 dark:text-slate-400 truncate">${escapeHtml(a.type)} · ${fmtDate(a.startDate)}</div>
                    </div>
                  </div>
                </a>
              </li>`;
            }).join('')}</ul>` : UI.empty({ icon: 'badge-check', title: 'No partnerships on record' }),
        })}
        ${(() => {
          // Top implementing units (faculty/office that manages the agreements)
          const unitCounts = {};
          Store.state.agreements.forEach((a) => {
            const u = a.implementingUnit || 'Universitas';
            unitCounts[u] = (unitCounts[u] || 0) + 1;
          });
          const topUnits = Object.entries(unitCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
          const maxN = topUnits[0]?.[1] || 1;
          return UI.card({
            title: 'Top Implementing Units',
            subtitle: 'Faculties and offices managing the most partnerships',
            body: `<ul class="space-y-2.5">${topUnits.map(([name, n]) => `
              <li>
                <div class="flex items-center justify-between text-sm mb-1">
                  <span class="font-medium text-slate-800 dark:text-slate-200 truncate pr-2">${escapeHtml(name)}</span>
                  <span class="text-xs font-bold text-slate-500 tabular-nums">${n}</span>
                </div>
                ${UI.progressBar(Math.round((n / maxN) * 100), 'brand')}
              </li>`).join('')}</ul>`,
          });
        })()}
      </aside>
    </section>
  `;

  renderGuestLayout(content);
  Charts.destroyAll();
  setTimeout(() => {
    Charts.agreementsByYear('chart-yearly');
    Charts.statusPie('chart-status');
    Charts.kindDonut('chart-kind');
    Charts.topPartnersBar('chart-top-partners', { limit: 10 });
  }, 30);
}

function viewGuestLibrary() {
  // Public catalog — any agreement that's reached at least signed/binding state.
  const archived = Store.state.agreements.filter((a) => ARCHIVE_STATUSES.includes(a.status));
  const PAGE_SIZE = 24;
  let page = 1;
  const content = `
    <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold text-slate-900 dark:text-white">Partnership Catalog</h1>
          <p class="text-slate-600 dark:text-slate-400 mt-1">Browse Petra's signed and ongoing partnerships — <span id="lib-count" class="font-semibold">${archived.length}</span> on record.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative">
            <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
            <input id="lib-search" type="search" placeholder="Search partner, code, agenda…" class="h-10 pl-9 pr-3 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
          </div>
          <select id="lib-kind" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
            <option value="">All regions</option>
            <option value="International">International</option>
            <option value="Domestic">Domestic</option>
          </select>
          <select id="lib-type" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
            <option value="">All types</option>
            ${AGREEMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
          </select>
          <select id="lib-dept" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
            <option value="">All units</option>
            ${[...Store.state.departments].sort((a, b) => a.short.localeCompare(b.short)).map((d) => `<option value="${d.id}">${escapeHtml(d.short)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="lib-grid" class="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"></div>
      <div id="lib-pagination" class="mt-6 flex items-center justify-between text-sm"></div>
    </section>
  `;
  renderGuestLayout(content);

  const render = () => {
    const q = $('#lib-search').value.trim().toLowerCase();
    const kind = $('#lib-kind').value;
    const type = $('#lib-type').value;
    const dept = $('#lib-dept').value;
    const list = archived.filter((a) => {
      const inst = findInstitution(a.institutionId);
      const matchesQ = !q || [a.title, a.code, inst?.name, a.description, (a.tags || []).join(' ')].join(' ').toLowerCase().includes(q);
      const matchesK = !kind || a.kind === kind;
      const matchesT = !type || a.type === type;
      const matchesD = !dept || a.departmentId === dept || (a.unitDepartmentIds || []).includes(dept);
      return matchesQ && matchesK && matchesT && matchesD;
    });
    list.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    $('#lib-count').textContent = list.length;

    if (!list.length) {
      $('#lib-grid').innerHTML = `<div class="col-span-full">${UI.empty({ icon: 'library', title: 'No matching partnerships', message: 'Try changing your filters.' })}</div>`;
    } else {
      $('#lib-grid').innerHTML = slice.map((a) => {
        const inst = findInstitution(a.institutionId);
        const dept = findDepartment(a.departmentId);
        const endLabel = a.endDate
          ? fmtDate(a.endDate)
          : escapeHtml(a.endDateRaw || '—');
        return `
          <article class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:border-brand-500 transition flex flex-col">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[10px] font-bold px-2 py-1 rounded-md ${typeChipClass(a.type)}">${a.type}</span>
                ${UI.pill(a.status)}
                ${a.kind ? `<span class="text-[10px] font-semibold px-2 py-1 rounded-md ${a.kind === 'International' ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}">${escapeHtml(a.kind)}</span>` : ''}
              </div>
              <div class="text-[11px] font-mono text-slate-400">${escapeHtml(a.code)}</div>
            </div>
            <h3 class="mt-3 font-semibold text-slate-900 dark:text-white leading-snug">${escapeHtml(inst?.name || a.title)}</h3>
            ${a.description ? `<p class="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-3">${escapeHtml(a.description)}</p>` : ''}
            <div class="mt-3 text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <div class="flex items-center gap-1.5"><i data-lucide="layers" class="w-3.5 h-3.5"></i>${escapeHtml(a.implementingUnit || dept?.short || '—')}${a.scope ? ` <span class="text-slate-400">· ${escapeHtml(a.scope)}</span>` : ''}</div>
              <div class="flex items-center gap-1.5"><i data-lucide="calendar" class="w-3.5 h-3.5"></i>${fmtDate(a.startDate)} → ${endLabel}</div>
              ${inst?.country ? `<div class="flex items-center gap-1.5"><i data-lucide="globe" class="w-3.5 h-3.5"></i>${escapeHtml(inst.country)}</div>` : ''}
            </div>
          </article>`;
      }).join('');
    }

    $('#lib-pagination').innerHTML = `
      <div class="text-slate-500">Showing ${slice.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${(page - 1) * PAGE_SIZE + slice.length} of ${list.length}</div>
      <div class="flex items-center gap-1">
        <button data-lib-page="prev" class="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40" ${page === 1 ? 'disabled' : ''}>Prev</button>
        <span class="px-3 py-1.5 text-slate-600">Page ${page} of ${totalPages}</span>
        <button data-lib-page="next" class="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40" ${page === totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
    $$('[data-lib-page]').forEach((b) => b.addEventListener('click', () => {
      const d = b.getAttribute('data-lib-page');
      if (d === 'prev' && page > 1) page--;
      else if (d === 'next' && page < totalPages) page++;
      render();
    }));
    refreshIcons();
  };
  $('#lib-search').addEventListener('input', debounce(() => { page = 1; render(); }, 150));
  ['lib-kind', 'lib-type', 'lib-dept'].forEach((id) => $(`#${id}`).addEventListener('change', () => { page = 1; render(); }));
  render();
}

function viewGuestAnalytics() {
  const content = `
    <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 class="text-3xl font-bold text-slate-900 dark:text-white">Analytics & Insights</h1>
        <p class="text-slate-600 dark:text-slate-400 mt-1">A deeper look at Petra's partnership portfolio.</p>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        ${UI.card({ title: 'Lifecycle Status', body: `<div class="h-72"><canvas id="ac-status"></canvas></div>` })}
        ${UI.card({ title: 'Domestic vs International', body: `<div class="h-72"><canvas id="ac-kind"></canvas></div>` })}
        ${UI.card({ title: 'Agreements by Year (signed)', body: `<div class="h-72"><canvas id="ac-yearly"></canvas></div>` })}
        ${UI.card({ title: 'Partner Countries', body: `<div class="h-72"><canvas id="ac-country"></canvas></div>` })}
        ${UI.card({ title: 'Implementing Departments', body: `<div class="h-72"><canvas id="ac-dept"></canvas></div>` })}
        ${UI.card({ title: 'Top Partner Institutions', body: `<div class="h-72"><canvas id="ac-top-partners"></canvas></div>` })}
      </div>
      ${UI.card({ title: 'Expiration Timeline', body: `<div class="h-64"><canvas id="ac-exp"></canvas></div>` })}
    </section>`;
  renderGuestLayout(content);
  Charts.destroyAll();
  setTimeout(() => {
    Charts.statusPie('ac-status');
    Charts.kindDonut('ac-kind');
    Charts.agreementsByYear('ac-yearly');
    Charts.countryBar('ac-country');
    Charts.departmentBar('ac-dept');
    Charts.topPartnersBar('ac-top-partners', { limit: 10 });
    Charts.expirationTimeline('ac-exp');
  }, 30);
}

/* ============================ Login Page ================================= */

function viewLogin() {
  const app = $('#app');
  const configWarning = !window.SUPABASE_CONFIGURED
    ? `<div class="mb-4 text-xs text-amber-800 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-200 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
         Supabase isn't configured yet. Set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in <code>js/supabase-client.js</code>.
       </div>`
    : '';

  const tabBtn = (mode, label) =>
    `<button type="button" data-mode="${mode}" class="login-tab flex-1 h-9 text-xs font-semibold rounded-md transition data-[active=true]:bg-white data-[active=true]:dark:bg-slate-900 data-[active=true]:shadow data-[active=true]:text-slate-900 data-[active=true]:dark:text-white text-slate-500">${label}</button>`;

  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center px-4 hero-pattern">
      <div class="w-full max-w-md">
        <a href="#/" class="flex items-center justify-center gap-3 mb-6">
          <div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <i data-lucide="graduation-cap" class="w-6 h-6 text-white"></i>
          </div>
          <div>
            <div class="font-bold text-slate-900 dark:text-white">Petra Partnership Dashboard</div>
            <div class="text-[10px] uppercase tracking-wider text-slate-500">Admin Console</div>
          </div>
        </a>
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-7">
          ${configWarning}
          <h1 id="login-title" class="text-xl font-bold text-slate-900 dark:text-white">Welcome back</h1>
          <p id="login-subtitle" class="text-sm text-slate-500 dark:text-slate-400 mt-1">Sign in to manage Petra's partnership portfolio.</p>

          <div class="mt-5 flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
            ${tabBtn('password', 'Password')}
            ${tabBtn('magic',    'Magic link')}
            ${tabBtn('signup',   'Sign up')}
          </div>

          <form id="login-form" class="mt-5 space-y-4" novalidate>
            <div id="field-name" class="hidden">
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Full name</label>
              <input name="name" type="text" autocomplete="name" class="w-full h-11 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:bg-white dark:focus:bg-slate-900" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
              <input name="email" type="email" required autofocus autocomplete="email" class="w-full h-11 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:bg-white dark:focus:bg-slate-900" />
            </div>
            <div id="field-password">
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Password</label>
              <input name="password" type="password" autocomplete="current-password" class="w-full h-11 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:bg-white dark:focus:bg-slate-900" />
              <p id="password-hint" class="hidden text-[11px] text-slate-500 mt-1">At least 6 characters.</p>
            </div>

            <div id="login-error"  class="hidden text-sm text-rose-600 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg px-3 py-2"></div>
            <div id="login-notice" class="hidden text-sm text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded-lg px-3 py-2"></div>

            <button id="login-submit" type="submit" class="w-full h-11 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-600/60 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2">
              <i data-lucide="log-in" class="w-4 h-4"></i> <span id="login-submit-label">Sign in</span>
            </button>
          </form>
        </div>
        <div class="mt-4 text-center">
          <a href="#/" class="text-sm text-slate-500 hover:text-brand-600">← Back to public dashboard</a>
        </div>
      </div>
    </div>`;

  let mode = 'password'; // 'password' | 'magic' | 'signup'
  const els = {
    form:          $('#login-form'),
    tabs:          $$('.login-tab'),
    title:         $('#login-title'),
    subtitle:      $('#login-subtitle'),
    fieldName:     $('#field-name'),
    fieldPassword: $('#field-password'),
    nameInput:     $('input[name="name"]', $('#login-form')),
    passwordInput: $('input[name="password"]', $('#login-form')),
    passwordHint:  $('#password-hint'),
    error:         $('#login-error'),
    notice:        $('#login-notice'),
    submit:        $('#login-submit'),
    submitLabel:   $('#login-submit-label'),
  };

  const setMode = (next) => {
    mode = next;
    els.tabs.forEach((b) => b.setAttribute('data-active', String(b.dataset.mode === next)));
    els.error.classList.add('hidden');
    els.notice.classList.add('hidden');
    if (next === 'password') {
      els.title.textContent = 'Welcome back';
      els.subtitle.textContent = "Sign in to manage Petra's partnership portfolio.";
      els.fieldName.classList.add('hidden');
      els.fieldPassword.classList.remove('hidden');
      els.passwordHint.classList.add('hidden');
      els.passwordInput.setAttribute('autocomplete', 'current-password');
      els.passwordInput.required = true;
      els.nameInput.required = false;
      els.submitLabel.textContent = 'Sign in';
    } else if (next === 'magic') {
      els.title.textContent = 'Sign in with a magic link';
      els.subtitle.textContent = 'We will email you a one-time link to sign in.';
      els.fieldName.classList.add('hidden');
      els.fieldPassword.classList.add('hidden');
      els.passwordInput.required = false;
      els.nameInput.required = false;
      els.submitLabel.textContent = 'Send magic link';
    } else {
      els.title.textContent = 'Create an account';
      els.subtitle.textContent = 'Sign up with your email and a password.';
      els.fieldName.classList.remove('hidden');
      els.fieldPassword.classList.remove('hidden');
      els.passwordHint.classList.remove('hidden');
      els.passwordInput.setAttribute('autocomplete', 'new-password');
      els.passwordInput.required = true;
      els.nameInput.required = true;
      els.submitLabel.textContent = 'Create account';
    }
    refreshIcons();
  };

  els.tabs.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  setMode('password');

  const showError = (msg) => {
    els.notice.classList.add('hidden');
    els.error.textContent = msg;
    els.error.classList.remove('hidden');
  };
  const showNotice = (msg) => {
    els.error.classList.add('hidden');
    els.notice.textContent = msg;
    els.notice.classList.remove('hidden');
  };

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const name = String(fd.get('name') || '').trim();

    if (!email) return showError('Please enter your email.');

    els.submit.disabled = true;
    const prevLabel = els.submitLabel.textContent;
    els.submitLabel.textContent = 'Please wait…';

    try {
      if (mode === 'password') {
        if (!password) return showError('Please enter your password.');
        const result = await Auth.login(email, password);
        if (!result.ok) return showError(result.error);
        Toast.show(`Welcome back, ${Auth.current.name.split(' ')[0]}!`, 'success');
        Router.go('/admin');
      } else if (mode === 'magic') {
        const result = await Auth.sendMagicLink(email);
        if (!result.ok) return showError(result.error);
        showNotice(`We've emailed a sign-in link to ${email}. Open it on this device to finish signing in.`);
      } else {
        if (password.length < 6) return showError('Password must be at least 6 characters.');
        const result = await Auth.signUp(email, password, name);
        if (!result.ok) return showError(result.error);
        if (result.needsConfirmation) {
          showNotice(`Account created. Check ${email} for a confirmation link before signing in.`);
        } else {
          Toast.show(`Welcome, ${(Auth.current && Auth.current.name || 'there').split(' ')[0]}!`, 'success');
          Router.go('/admin');
        }
      }
    } catch (err) {
      console.error('[auth] submit failed:', err);
      showError(err && err.message ? err.message : 'Something went wrong. Please try again.');
    } finally {
      els.submit.disabled = false;
      els.submitLabel.textContent = prevLabel;
    }
  });
}

/* ============================ Admin Layout =============================== */

function renderAdminLayout(content, activePath) {
  const navItems = [
    { href: '/admin',                icon: 'layout-dashboard', label: 'Dashboard' },
    { href: '/admin/agreements',     icon: 'file-text',        label: 'Agreements' },
    { href: '/admin/agreements/new', icon: 'plus-circle',      label: 'New Agreement' },
    { href: '/admin/archive',        icon: 'library',          label: 'Partnership Catalog' },
    { href: '/admin/analytics',      icon: 'bar-chart-3',      label: 'Analytics' },
    { href: '/admin/users',          icon: 'users',            label: 'User Management' },
    { href: '/admin/notifications',  icon: 'bell',             label: 'Notifications' },
    { href: '/admin/settings',       icon: 'settings',         label: 'Settings' },
  ];
  const unread = Store.state.notifications.filter((n) => !n.read).length;
  const user = findUser(Auth.current.id) || {};
  const app = $('#app');
  app.innerHTML = `
    <div class="flex min-h-screen">
      <aside id="sidebar" class="w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex-col hidden lg:flex">
        <div class="h-16 flex items-center gap-3 px-5 border-b border-slate-200 dark:border-slate-800">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <i data-lucide="graduation-cap" class="w-5 h-5 text-white"></i>
          </div>
          <div>
            <div class="font-bold text-slate-900 dark:text-white text-sm leading-tight">Petra Dashboard</div>
            <div class="text-[10px] uppercase tracking-wider text-slate-500">Admin Console</div>
          </div>
        </div>
        <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          ${navItems.map((n) => {
            const active = activePath === n.href || (n.href !== '/admin' && activePath.startsWith(n.href));
            return `<a href="#${n.href}" class="nav-link ${active ? 'active' : ''}">
              <i data-lucide="${n.icon}" class="w-4 h-4"></i>
              <span class="flex-1">${n.label}</span>
              ${n.href === '/admin/notifications' && unread ? `<span class="text-[10px] font-bold px-1.5 rounded-full bg-rose-500 text-white">${unread}</span>` : ''}
            </a>`;
          }).join('')}
        </nav>
        <div class="p-3 border-t border-slate-200 dark:border-slate-800">
          <div class="flex items-center gap-3 p-2 rounded-lg">
            <div class="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-base">${user.avatar || '👤'}</div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-slate-900 dark:text-white truncate">${escapeHtml(user.name || '')}</div>
              <div class="text-xs text-slate-500 truncate">${escapeHtml(user.role || '')}</div>
            </div>
          </div>
          <a href="#/" class="mt-2 nav-link"><i data-lucide="home" class="w-4 h-4"></i>Public Site</a>
          <button data-action="logout" class="w-full mt-1 nav-link text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10">
            <i data-lucide="log-out" class="w-4 h-4"></i> Logout
          </button>
        </div>
      </aside>

      <div class="flex-1 flex flex-col min-w-0">
        <header class="h-16 sticky top-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800 flex items-center px-4 sm:px-6 gap-3">
          <button data-action="toggle-sidebar" class="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <i data-lucide="menu" class="w-5 h-5"></i>
          </button>
          <div class="flex-1 max-w-xl">
            <div class="relative">
              <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
              <input id="global-search" type="search" placeholder="Search agreements…"
                     class="w-full h-10 pl-9 pr-3 rounded-lg bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900 outline-none text-sm" />
            </div>
          </div>
          <button data-action="toggle-theme" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" title="Toggle theme">
            <i data-lucide="sun-moon" class="w-5 h-5"></i>
          </button>
          <a href="#/admin/notifications" class="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
            <i data-lucide="bell" class="w-5 h-5"></i>
            ${unread ? `<span class="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-rose-500 text-white rounded-full flex items-center justify-center">${unread}</span>` : ''}
          </a>
        </header>
        <main class="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">${content}</main>
      </div>
    </div>`;

  // Event bindings
  app.querySelector('[data-action="toggle-theme"]').addEventListener('click', () => Theme.toggle());
  app.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    const ok = await Modal.confirm({ title: 'Sign out?', message: 'You will need to sign in again to access the admin console.', confirmLabel: 'Sign out' });
    if (ok) { Toast.show('Signed out.', 'info'); Auth.logout(); }
  });
  app.querySelector('[data-action="toggle-sidebar"]').addEventListener('click', () => {
    const s = $('#sidebar');
    s.classList.toggle('hidden');
    s.classList.toggle('flex');
    s.classList.toggle('fixed');
    s.classList.toggle('inset-y-0');
    s.classList.toggle('z-40');
  });
  $('#global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Router.go(`/admin/agreements?q=${encodeURIComponent(e.target.value)}`);
  });
}

/* ============================ Admin Dashboard ============================ */

function viewAdminDashboard() {
  const ags = Store.state.agreements;
  const total = ags.length;
  const active = ags.filter((a) => isLiveAgreement(a.status)).length;
  const underReview = ags.filter((a) => IN_PROGRESS_STATUSES.includes(a.status)).length;
  const autoRenewed = ags.filter((a) => a.status === 'Auto-renewed').length;
  const completed = ags.filter((a) => ['Signed', 'Completed', 'Archived', 'Ended', 'Expired'].includes(a.status)).length;
  const expiring = ags.filter((a) => {
    if (!isLiveAgreement(a.status)) return false;
    const d = daysUntil(a.endDate); return d !== null && d > 0 && d <= 90;
  });

  const recentActivity = Store.state.activityLogs.slice(0, 10);
  const myAgreements = ags.filter((a) => a.picUserId === Auth.current.id).slice(0, 5);

  // In-process agreements: anything not yet signed/closed. The "stopwatch"
  // counts from the first-contact moment so long-running negotiations are
  // visible at a glance.
  const inProcessAll = ags
    .filter((a) => IN_PROGRESS_STATUSES.includes(a.status))
    .map((a) => ({ a, anchor: a.contactDate || a.createdAt }))
    .filter((row) => row.anchor)
    .sort((x, y) => new Date(x.anchor) - new Date(y.anchor));
  const inProcess = inProcessAll.slice(0, 15);

  const content = `
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-white">Good day, ${escapeHtml(Auth.current.name.split(' ')[0])} 👋</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Petra's partnership portfolio at a glance.</p>
      </div>
      <div class="flex items-center gap-2">
        <a href="#/admin/agreements/new" class="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold shadow-sm shadow-brand-500/20">
          <i data-lucide="plus" class="w-4 h-4"></i> New Agreement
        </a>
        <button data-action="export" class="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold">
          <i data-lucide="download" class="w-4 h-4"></i> Export CSV
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      ${UI.kpiCard({ label: 'Total', value: total, icon: 'file-text', tone: 'brand' })}
      ${UI.kpiCard({ label: 'Active', value: active, icon: 'activity', tone: 'sky' })}
      ${UI.kpiCard({ label: 'Pending', value: underReview, icon: 'scan-search', tone: 'amber' })}
      ${UI.kpiCard({ label: 'Auto-renewed', value: autoRenewed, icon: 'repeat', tone: 'violet' })}
      ${UI.kpiCard({ label: 'Signed / Closed', value: completed, icon: 'badge-check', tone: 'emerald' })}
      ${UI.kpiCard({ label: 'Expiring ≤90d', value: expiring.length, icon: 'alarm-clock', tone: 'rose' })}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
      <div class="lg:col-span-2 space-y-6">
        ${UI.card({
          title: 'Agreements Signed by Year', subtitle: 'Last 15 years · stacked by region',
          body: `<div class="h-72"><canvas id="adm-yearly"></canvas></div>`,
        })}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          ${UI.card({ title: 'Lifecycle Status', body: `<div class="h-64"><canvas id="adm-status"></canvas></div>` })}
          ${UI.card({ title: 'Domestic vs International', body: `<div class="h-64"><canvas id="adm-kind"></canvas></div>` })}
        </div>
      </div>
      <div class="space-y-6">
        ${UI.card({
          title: 'Expiring Soon',
          subtitle: `${expiring.length} agreements within 90 days`,
          body: expiring.length ? `<ul class="space-y-2.5 max-h-80 overflow-y-auto pr-1">${expiring.slice(0, 6).map((a) => {
            const d = daysUntil(a.endDate);
            const tone = d <= 30 ? 'rose' : d <= 60 ? 'amber' : 'emerald';
            return `<li>
              <a href="#/admin/agreements/${a.id}" class="block p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-xs font-mono text-slate-400">${escapeHtml(a.code)}</div>
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md ${tone === 'rose' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : tone === 'amber' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'}">${d}d</span>
                </div>
                <div class="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate mt-0.5">${escapeHtml(a.title)}</div>
                <div class="text-xs text-slate-500 truncate">${escapeHtml(findInstitution(a.institutionId)?.name || '')}</div>
              </a>
            </li>`;
          }).join('')}</ul>` : UI.empty({ icon: 'shield-check', title: 'All clear', message: 'No agreements expiring soon.' }),
        })}
        ${UI.card({
          title: 'My Agreements',
          subtitle: 'Assigned to you as PIC',
          body: myAgreements.length ? `<ul class="space-y-2">${myAgreements.map((a) => `
            <li>
              <a href="#/admin/agreements/${a.id}" class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
                <div class="w-8 h-8 rounded-lg bg-brand-100 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 flex items-center justify-center shrink-0 text-[11px] font-bold">${a.type}</div>
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">${escapeHtml(a.title)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(a.status)}</div>
                </div>
                <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i>
              </a>
            </li>`).join('')}</ul>` : UI.empty({ icon: 'user-check', title: 'No agreements assigned' }),
        })}
      </div>
    </div>

    ${UI.card({
      title: 'In Process — Time Since First Contact',
      subtitle: `${inProcessAll.length} agreement${inProcessAll.length === 1 ? '' : 's'} in the pipeline${inProcessAll.length > inProcess.length ? ` · showing oldest ${inProcess.length}` : ''}`,
      body: inProcess.length ? `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th class="py-2 pr-3 font-medium">Agreement</th>
                <th class="py-2 px-3 font-medium">Partner</th>
                <th class="py-2 px-3 font-medium">Status</th>
                <th class="py-2 px-3 font-medium">Contacted</th>
                <th class="py-2 pl-3 font-medium text-right">Elapsed</th>
              </tr>
            </thead>
            <tbody id="adm-stopwatch-body">
              ${inProcess.map(({ a, anchor }) => {
                const inst = findInstitution(a.institutionId);
                return `
                  <tr class="row-hover border-b border-slate-100 dark:border-slate-800/60">
                    <td class="py-2 pr-3">
                      <a href="#/admin/agreements/${a.id}" class="font-medium text-slate-800 dark:text-slate-200 hover:text-brand-600 truncate block max-w-[260px]">${escapeHtml(a.title)}</a>
                      <div class="text-xs font-mono text-slate-400">${escapeHtml(a.code)}</div>
                    </td>
                    <td class="py-2 px-3 text-slate-600 dark:text-slate-300 truncate max-w-[220px]">${escapeHtml(inst?.name || '—')}</td>
                    <td class="py-2 px-3"><span class="pill ${pillClass(a.status)}">${escapeHtml(a.status)}</span></td>
                    <td class="py-2 px-3 text-xs text-slate-500">${fmtDate(anchor)}</td>
                    <td class="py-2 pl-3 text-right font-mono text-xs text-slate-700 dark:text-slate-200" data-stopwatch="${anchor}">…</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : UI.empty({ icon: 'timer-off', title: 'Pipeline empty', message: 'No agreements are currently in process.' }),
    })}

    ${UI.card({
      title: 'Recent Activity',
      subtitle: 'Latest workflow updates across all agreements',
      body: recentActivity.length ? `<ol class="timeline-rail space-y-3">${recentActivity.map((log) => {
        const ag = findAgreement(log.agreementId);
        const user = findUser(log.userId);
        return `<li class="relative">
          <span class="timeline-dot"></span>
          <div class="text-xs text-slate-500">${fmtDateTime(log.at)}</div>
          <div class="text-sm">
            <span class="font-medium">${escapeHtml(user?.name || 'System')}</span> · ${escapeHtml(log.message)}
            ${ag ? `<a href="#/admin/agreements/${ag.id}" class="text-brand-600 hover:underline ml-1">${escapeHtml(ag.code)}</a>` : ''}
          </div>
        </li>`;
      }).join('')}</ol>` : UI.empty({ icon: 'history', title: 'No recent activity' }),
    })}
  `;

  renderAdminLayout(`<div class="space-y-6">${content}</div>`, '/admin');
  Charts.destroyAll();
  setTimeout(() => {
    Charts.agreementsByYear('adm-yearly');
    Charts.statusPie('adm-status');
    Charts.kindDonut('adm-kind');
  }, 30);
  $('[data-action="export"]')?.addEventListener('click', exportAgreementsCSV);

  const tick = () => {
    const now = Date.now();
    $$('[data-stopwatch]').forEach((el) => {
      const ts = new Date(el.dataset.stopwatch).getTime();
      if (!Number.isFinite(ts)) return;
      el.textContent = formatElapsed(now - ts);
    });
  };
  tick();
  const timerId = setInterval(tick, 1000);
  Router.onCleanup(() => clearInterval(timerId));
}

/* ============================ Agreement List ============================= */

function viewAgreementList() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const initialQ = params.get('q') || '';

  const content = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-white">Agreements</h1>
        <p class="text-sm text-slate-500 mt-1">Manage all MoU and MoA records.</p>
      </div>
      <div class="flex items-center gap-2">
        <button data-action="export" class="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold">
          <i data-lucide="file-spreadsheet" class="w-4 h-4"></i> Export Excel
        </button>
        <a href="#/admin/agreements/new" class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold">
          <i data-lucide="plus" class="w-4 h-4"></i> New Agreement
        </a>
      </div>
    </div>

    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      <div class="p-4 flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-slate-800">
        <div class="relative flex-1 min-w-[220px]">
          <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input id="ag-q" value="${escapeHtml(initialQ)}" type="search" placeholder="Search by title, code, institution…" class="w-full h-10 pl-9 pr-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
        </div>
        <select id="ag-status" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="">All statuses</option>
          <optgroup label="Lifecycle">
            ${LIFECYCLE_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </optgroup>
          <optgroup label="Workflow">
            ${WORKFLOW_STAGES.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </optgroup>
        </select>
        <select id="ag-kind" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="">All regions</option>
          <option value="International">International</option>
          <option value="Domestic">Domestic</option>
        </select>
        <select id="ag-type" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="">All types</option>
          ${AGREEMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <select id="ag-dept" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="">All units</option>
          ${[...Store.state.departments].sort((a, b) => a.short.localeCompare(b.short)).map((d) => `<option value="${d.id}">${escapeHtml(d.short)}</option>`).join('')}
        </select>
        <select id="ag-itype" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="">All institution types</option>
          ${INSTITUTION_TYPES.map((t) => `<option value="${t}">${titleCase(t)}</option>`).join('')}
        </select>
        <select id="ag-scope" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="">All scopes</option>
          ${SCOPES.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}
        </select>
        <select id="ag-newpartner" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="">All partners</option>
          <option value="yes">New partners</option>
          <option value="no">Returning partners</option>
        </select>
        <button id="ag-clear" type="button" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300">Clear filters</button>
        <select id="ag-sort" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
          <option value="updated_desc">Recently updated</option>
          <option value="created_desc">Newest start date</option>
          <option value="title_asc">Title A→Z</option>
          <option value="end_asc">Ending soonest</option>
        </select>
      </div>

      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-slate-50 dark:bg-slate-900/70 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th class="text-left px-4 py-3">Code</th>
              <th class="text-left px-4 py-3">Partner / Title</th>
              <th class="text-left px-4 py-3">Type</th>
              <th class="text-left px-4 py-3">Region</th>
              <th class="text-left px-4 py-3">Unit</th>
              <th class="text-left px-4 py-3">Status</th>
              <th class="text-left px-4 py-3">End</th>
              <th class="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody id="ag-tbody" class="divide-y divide-slate-100 dark:divide-slate-800"></tbody>
        </table>
      </div>
      <div id="ag-pagination" class="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-sm"></div>
    </div>
  `;

  renderAdminLayout(content, '/admin/agreements');

  let page = 1;
  const pageSize = 10;
  let lastFiltered = [];

  const computeFiltered = () => {
    const q = $('#ag-q').value.trim().toLowerCase();
    const status = $('#ag-status').value;
    const type = $('#ag-type').value;
    const kind = $('#ag-kind').value;
    const dept = $('#ag-dept').value;
    const itype = $('#ag-itype').value;
    const scope = $('#ag-scope').value;
    const newPartner = $('#ag-newpartner').value;
    return Store.state.agreements.filter((a) => {
      const inst = findInstitution(a.institutionId);
      const matchesQ = !q || [a.title, a.code, inst?.name, a.description, a.implementingUnit, (a.units || []).join(' '), (a.tags || []).join(' ')].join(' ').toLowerCase().includes(q);
      const matchesS = !status || a.status === status;
      const matchesT = !type || a.type === type;
      const matchesK = !kind || a.kind === kind;
      const matchesD = !dept || a.departmentId === dept || (a.unitDepartmentIds || []).includes(dept);
      // institution_type can live on the agreement row OR on the linked institution
      const agITypes = Array.isArray(a.institutionType) ? a.institutionType : (a.institutionType ? [a.institutionType] : []);
      const instITypes = inst?.institutionTypes || [];
      const matchesIType = !itype || agITypes.includes(itype) || instITypes.includes(itype);
      const matchesScope = !scope || a.scope === scope || (a.scopeTags || []).includes(scope);
      const matchesNew = !newPartner || (newPartner === 'yes' ? !!a.newPartner : !a.newPartner);
      return matchesQ && matchesS && matchesT && matchesK && matchesD && matchesIType && matchesScope && matchesNew;
    });
  };

  const render = () => {
    const sort = $('#ag-sort').value;
    let list = computeFiltered();
    list.sort((a, b) => {
      // Sort puts null end dates last for end_asc; oldest first otherwise.
      const aE = a.endDate ? new Date(a.endDate).getTime() : Infinity;
      const bE = b.endDate ? new Date(b.endDate).getTime() : Infinity;
      switch (sort) {
        case 'created_desc': return new Date(b.startDate || 0) - new Date(a.startDate || 0);
        case 'title_asc': return (a.title || '').localeCompare(b.title || '');
        case 'end_asc': return aE - bE;
        default: return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      }
    });
    lastFiltered = list;

    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    if (page > totalPages) page = totalPages;
    const slice = list.slice((page - 1) * pageSize, page * pageSize);
    const tbody = $('#ag-tbody');
    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="8">${UI.empty({ icon: 'file-search', title: 'No agreements found', message: 'Adjust your filters or create a new one.' })}</td></tr>`;
    } else {
      tbody.innerHTML = slice.map((a) => {
        const inst = findInstitution(a.institutionId);
        const d = daysUntil(a.endDate);
        const endTone = d !== null && d <= 30 && isLiveAgreement(a.status) ? 'text-rose-600 font-semibold' : '';
        const endLabel = a.endDate ? fmtDate(a.endDate) : escapeHtml(a.endDateRaw || '—');
        const kindBadge = a.kind
          ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-md ${a.kind === 'International' ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}">${escapeHtml(a.kind)}</span>`
          : '<span class="text-xs text-slate-400">—</span>';
        return `
          <tr class="row-hover">
            <td class="px-4 py-3 font-mono text-xs text-slate-500">${escapeHtml(a.code)}</td>
            <td class="px-4 py-3 max-w-md">
              <a href="#/admin/agreements/${a.id}" class="font-semibold text-slate-900 dark:text-white hover:text-brand-600 line-clamp-1">${escapeHtml(inst?.name || a.title)}</a>
              <div class="text-xs text-slate-500 line-clamp-1">${escapeHtml(a.description || a.title || '')}</div>
            </td>
            <td class="px-4 py-3"><span class="text-[10px] font-bold px-2 py-1 rounded-md ${typeChipClass(a.type)}">${a.type}</span></td>
            <td class="px-4 py-3">${kindBadge}<div class="text-xs text-slate-500 mt-0.5">${escapeHtml(inst?.country || '')}</div></td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300 text-xs">${escapeHtml(a.implementingUnit || '—')}</td>
            <td class="px-4 py-3">${UI.pill(a.status)}</td>
            <td class="px-4 py-3 ${endTone} whitespace-nowrap">${endLabel}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <a href="#/admin/agreements/${a.id}" class="inline-flex p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600" title="View"><i data-lucide="eye" class="w-4 h-4"></i></a>
              <a href="#/admin/agreements/${a.id}/edit" class="inline-flex p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></a>
              <button data-delete="${a.id}" class="inline-flex p-1.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </td>
          </tr>`;
      }).join('');
    }

    $('#ag-pagination').innerHTML = `
      <div class="text-slate-500">Showing ${slice.length ? (page - 1) * pageSize + 1 : 0}–${(page - 1) * pageSize + slice.length} of ${list.length}</div>
      <div class="flex items-center gap-1">
        <button data-page="prev" class="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40" ${page === 1 ? 'disabled' : ''}>Prev</button>
        <span class="px-3 py-1.5 text-slate-600">Page ${page} of ${totalPages}</span>
        <button data-page="next" class="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40" ${page === totalPages ? 'disabled' : ''}>Next</button>
      </div>`;

    refreshIcons();

    tbody.querySelectorAll('[data-delete]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-delete');
        const ag = findAgreement(id);
        const ok = await Modal.confirm({
          title: 'Delete agreement?',
          message: `This will permanently remove "${ag.title}" and its activity logs. This action cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (ok) {
          Store.state.agreements = Store.state.agreements.filter((x) => x.id !== id);
          Store.state.activityLogs = Store.state.activityLogs.filter((x) => x.agreementId !== id);
          Store.save();
          Toast.show('Agreement deleted.', 'success');
          render();
        }
      }),
    );

    $$('[data-page]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.getAttribute('data-page') === 'prev' && page > 1) page--;
        else if (b.getAttribute('data-page') === 'next' && page < totalPages) page++;
        render();
      }),
    );
  };

  $('#ag-q').addEventListener('input', debounce(() => { page = 1; render(); }, 150));
  ['ag-status', 'ag-type', 'ag-kind', 'ag-dept', 'ag-itype', 'ag-scope', 'ag-newpartner', 'ag-sort'].forEach((id) =>
    $(`#${id}`).addEventListener('change', () => { page = 1; render(); }),
  );
  $('#ag-clear').addEventListener('click', () => {
    $('#ag-q').value = '';
    ['ag-status', 'ag-type', 'ag-kind', 'ag-dept', 'ag-itype', 'ag-scope', 'ag-newpartner'].forEach((id) => { $(`#${id}`).value = ''; });
    page = 1;
    render();
  });
  $('[data-action="export"]').addEventListener('click', () => exportAgreementsXLSX(lastFiltered, 'partnerships-filtered'));

  render();
}

/* ============================ Agreement Detail =========================== */

function viewAgreementDetail({ id }) {
  const a = findAgreement(id);
  if (!a) {
    renderAdminLayout(UI.empty({ icon: 'file-x', title: 'Agreement not found', message: 'It may have been deleted or moved.' }), '/admin/agreements');
    return;
  }
  const inst = findInstitution(a.institutionId);
  const dept = findDepartment(a.departmentId);
  const pic = findUser(a.picUserId);
  const d = daysUntil(a.endDate);

  const content = `
    <div class="flex items-center gap-2 mb-4 text-sm text-slate-500">
      <a href="#/admin/agreements" class="hover:text-brand-600">Agreements</a>
      <i data-lucide="chevron-right" class="w-4 h-4"></i>
      <span class="text-slate-700 dark:text-slate-300">${escapeHtml(a.code)}</span>
    </div>

    <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[10px] font-bold px-2 py-1 rounded-md ${typeChipClass(a.type)}">${a.type}</span>
          ${UI.pill(a.status)}
          ${a.newPartner ? '<span class="text-[10px] font-semibold px-2 py-1 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">New Partner</span>' : ''}
          <span class="font-mono text-xs text-slate-500">${escapeHtml(a.code)}</span>
        </div>
        <h1 class="mt-2 text-2xl font-bold text-slate-900 dark:text-white">${escapeHtml(a.title)}</h1>
        <p class="mt-1 text-sm text-slate-500">Updated ${fmtDateTime(a.updatedAt)}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <a href="#/admin/agreements/${a.id}/edit" class="inline-flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-brand-500 rounded-lg text-sm font-semibold">
          <i data-lucide="pencil" class="w-4 h-4"></i> Edit
        </a>
        ${isLifecycleStatus(a.status) ? '' : `<button data-action="advance" class="inline-flex items-center gap-2 px-3.5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold">
          <i data-lucide="arrow-right" class="w-4 h-4"></i> Advance Stage
        </button>`}
        <button data-action="delete" class="inline-flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-700 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg text-sm font-semibold">
          <i data-lucide="trash-2" class="w-4 h-4"></i> Delete
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        ${isLifecycleStatus(a.status)
          ? UI.card({
              title: 'Lifecycle Status',
              subtitle: `Imported record · ${a.kind || 'Partnership'}`,
              body: `
                <div class="mb-4">${UI.progressBar(a.progress)}</div>
                <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <dt class="text-xs font-semibold text-slate-500">Status</dt>
                    <dd class="mt-1">${UI.pill(a.status)}</dd>
                  </div>
                  <div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <dt class="text-xs font-semibold text-slate-500">End date (raw)</dt>
                    <dd class="mt-1 font-medium">${escapeHtml(a.endDateRaw || '—')}</dd>
                  </div>
                  ${a.renewalDate ? `<div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <dt class="text-xs font-semibold text-slate-500">Last renewal date</dt>
                    <dd class="mt-1 font-medium">${fmtDate(a.renewalDate)}</dd>
                  </div>` : ''}
                  ${a.implementingUnit ? `<div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <dt class="text-xs font-semibold text-slate-500">Implementing unit</dt>
                    <dd class="mt-1 font-medium">${escapeHtml(a.implementingUnit)}</dd>
                  </div>` : ''}
                  ${a.scope ? `<div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <dt class="text-xs font-semibold text-slate-500">Scope</dt>
                    <dd class="mt-1 font-medium">${escapeHtml(a.scope)}</dd>
                  </div>` : ''}
                  ${(a.degreeProgram || a.nonDegreeProgram) ? `<div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <dt class="text-xs font-semibold text-slate-500">Program</dt>
                    <dd class="mt-1 font-medium">${[a.degreeProgram && 'Degree', a.nonDegreeProgram && 'Non-degree'].filter(Boolean).join(' + ')}</dd>
                  </div>` : ''}
                  ${(a.institutionType && a.institutionType.length) ? `<div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <dt class="text-xs font-semibold text-slate-500">Partner sector</dt>
                    <dd class="mt-1 font-medium">${a.institutionType.map((t) => escapeHtml(String(t).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))).join(', ')}</dd>
                  </div>` : ''}
                </dl>
                ${(a.units && a.units.length > 1) ? `<div class="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div class="text-xs font-semibold text-slate-500 mb-2">Participating programs (${a.units.length})</div>
                  <div class="flex flex-wrap gap-1.5">${a.units.map((u) => `<span class="text-[11px] font-medium px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">${escapeHtml(u)}</span>`).join('')}</div>
                </div>` : ''}
                ${a.realization ? `<div class="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
                  <div class="text-xs font-semibold text-emerald-800 dark:text-emerald-300 mb-1">Realization / Track Record</div>
                  <div class="text-sm text-emerald-900 dark:text-emerald-200 whitespace-pre-line">${escapeHtml(String(a.realization))}</div>
                </div>` : ''}`,
            })
          : UI.card({
              title: 'Workflow Progress',
              subtitle: `${a.progress}% complete · Stage ${WORKFLOW_STAGES.indexOf(a.status) + 1} of ${WORKFLOW_STAGES.length}`,
              body: `
                <div class="mb-4">${UI.progressBar(a.progress)}</div>
                <ol class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  ${WORKFLOW_STAGES.map((s, i) => {
                    const reached = i <= WORKFLOW_STAGES.indexOf(a.status);
                    const current = s === a.status;
                    return `<li class="p-2 rounded-lg border ${current ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : reached ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30' : 'border-slate-200 dark:border-slate-800'}">
                      <div class="flex items-center gap-1.5">
                        <i data-lucide="${reached ? 'check-circle-2' : 'circle'}" class="w-3.5 h-3.5 ${current ? 'text-brand-600' : reached ? 'text-emerald-600' : 'text-slate-400'}"></i>
                        <span class="font-medium ${current ? 'text-brand-700 dark:text-brand-300' : reached ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500'}">${s}</span>
                      </div>
                    </li>`;
                  }).join('')}
                </ol>`,
            })}

        ${UI.card({
          title: 'Description',
          body: `<p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">${escapeHtml(a.description || 'No description provided.')}</p>
            ${a.notes ? `<div class="mt-4 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg text-sm">
              <div class="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">Internal Notes</div>
              <div class="text-amber-900 dark:text-amber-200 whitespace-pre-line">${escapeHtml(a.notes)}</div>
            </div>` : ''}`,
        })}

        ${UI.card({
          title: 'Documents',
          subtitle: `${a.files.length} file(s) attached`,
          action: `<button data-action="upload" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-semibold"><i data-lucide="upload" class="w-3.5 h-3.5"></i>Upload</button>`,
          body: a.files.length ? `<ul class="divide-y divide-slate-100 dark:divide-slate-800">${a.files.map((f) => `
            <li class="py-2.5 flex items-center justify-between gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0"><i data-lucide="file-text" class="w-4 h-4"></i></div>
                <div class="min-w-0">
                  <div class="text-sm font-semibold truncate">${escapeHtml(f.name)}</div>
                  <div class="text-xs text-slate-500">${f.size.toFixed(2)} MB · uploaded ${fmtDate(f.uploadedAt)}</div>
                </div>
              </div>
              <div class="flex items-center gap-1">
                <button data-preview="${f.id}" class="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600" title="Preview"><i data-lucide="eye" class="w-4 h-4"></i></button>
                <button data-download="${f.id}" class="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600" title="Download"><i data-lucide="download" class="w-4 h-4"></i></button>
                <button data-delete-file="${f.id}" class="p-1.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
              </div>
            </li>`).join('')}</ul>` : UI.empty({ icon: 'file-plus', title: 'No documents yet', message: 'Upload PDFs or contract drafts.' }),
        })}

        ${UI.card({
          title: 'Activity & Status History',
          body: a.statusHistory.length ? `<ol class="timeline-rail space-y-3">${[...a.statusHistory].reverse().map((h) => {
            const u = findUser(h.by);
            return `<li class="relative">
              <span class="timeline-dot"></span>
              <div class="text-xs text-slate-500">${fmtDateTime(h.at)}</div>
              <div class="text-sm">
                <span class="font-medium">${escapeHtml(u?.name || 'System')}</span>
                ${h.from ? ` moved from <span class="font-medium">${escapeHtml(h.from)}</span> to <span class="font-medium">${escapeHtml(h.to)}</span>` : ` created agreement as <span class="font-medium">${escapeHtml(h.to)}</span>`}
              </div>
              ${h.note ? `<div class="text-xs text-slate-500 italic mt-0.5">"${escapeHtml(h.note)}"</div>` : ''}
            </li>`;
          }).join('')}</ol>` : UI.empty({ icon: 'history', title: 'No history' }),
        })}
      </div>

      <aside class="space-y-6">
        ${UI.card({
          title: 'Details',
          body: `<dl class="text-sm space-y-3">
            <div class="flex items-start justify-between gap-3"><dt class="text-slate-500">Institution</dt><dd class="text-right font-medium">${escapeHtml(inst?.name || '—')}<div class="text-xs text-slate-500">${escapeHtml(inst?.country || '')}</div></dd></div>
            <div class="flex items-start justify-between gap-3"><dt class="text-slate-500">Department</dt><dd class="text-right font-medium">${escapeHtml(dept?.name || '—')}</dd></div>
            <div class="flex items-start justify-between gap-3"><dt class="text-slate-500">PIC</dt><dd class="text-right font-medium">${escapeHtml(pic?.name || '—')}<div class="text-xs text-slate-500">${escapeHtml(pic?.email || '')}</div></dd></div>
            <div class="flex items-start justify-between gap-3"><dt class="text-slate-500">Start Date</dt><dd class="text-right font-medium">${fmtDate(a.startDate)}</dd></div>
            <div class="flex items-start justify-between gap-3"><dt class="text-slate-500">End Date</dt><dd class="text-right font-medium ${d !== null && d <= 30 && !ARCHIVE_STATUSES.includes(a.status) ? 'text-rose-600' : ''}">${fmtDate(a.endDate)}<div class="text-xs text-slate-500">${d !== null ? (d > 0 ? `in ${d} days` : d === 0 ? 'expires today' : `${-d} days ago`) : ''}</div></dd></div>
            ${a.signedDate ? `<div class="flex items-start justify-between gap-3"><dt class="text-slate-500">Signed</dt><dd class="text-right font-medium">${fmtDate(a.signedDate)}</dd></div>` : ''}
          </dl>`,
        })}

        ${UI.card({
          title: 'Tags',
          body: a.tags.length ? `<div class="flex flex-wrap gap-2">${a.tags.map((t) => `<span class="text-xs px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">${escapeHtml(t)}</span>`).join('')}</div>` : '<p class="text-sm text-slate-500">No tags.</p>',
        })}

        ${ARCHIVE_STATUSES.includes(a.status) ? UI.card({
          title: 'Archive Status',
          body: `<div class="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg text-sm">
            <div class="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300"><i data-lucide="archive" class="w-4 h-4"></i>Auto-archived</div>
            <div class="text-emerald-900 dark:text-emerald-200 text-xs mt-1">This agreement is in the searchable archive library.</div>
          </div>`,
        }) : ''}
      </aside>
    </div>
  `;

  renderAdminLayout(content, '/admin/agreements');

  $('[data-action="advance"]')?.addEventListener('click', () => advanceStage(a.id));
  $('[data-action="delete"]').addEventListener('click', async () => {
    const ok = await Modal.confirm({ title: 'Delete agreement?', message: `Permanently remove "${a.title}"?`, confirmLabel: 'Delete', danger: true });
    if (ok) {
      Store.state.agreements = Store.state.agreements.filter((x) => x.id !== a.id);
      Store.state.activityLogs = Store.state.activityLogs.filter((x) => x.agreementId !== a.id);
      Store.save();
      Toast.show('Deleted.', 'success');
      Router.go('/admin/agreements');
    }
  });
  $('[data-action="upload"]').addEventListener('click', () => simulateUpload(a.id));
  $$('[data-preview]').forEach((b) => b.addEventListener('click', () => {
    Modal.open({
      title: 'PDF Preview',
      size: 'lg',
      body: `<div class="aspect-[3/4] bg-slate-100 dark:bg-slate-800 rounded-lg flex flex-col items-center justify-center text-slate-500">
        <i data-lucide="file-text" class="w-16 h-16 mb-2"></i>
        <div class="text-sm font-semibold">Preview not available in demo</div>
        <div class="text-xs">In production this would render the PDF via PDF.js or similar.</div>
      </div>`,
      actions: [{ label: 'Close', variant: 'secondary' }],
    });
  }));
  $$('[data-download]').forEach((b) => b.addEventListener('click', () => {
    const fid = b.getAttribute('data-download');
    const f = a.files.find((x) => x.id === fid);
    downloadFile(f.name + '.txt', `[Demo file content for ${f.name}]\nAgreement: ${a.title}\nCode: ${a.code}`, 'text/plain');
    Toast.show('Demo download started.', 'success');
  }));
  $$('[data-delete-file]').forEach((b) => b.addEventListener('click', async () => {
    const fid = b.getAttribute('data-delete-file');
    const ok = await Modal.confirm({ title: 'Remove file?', message: 'This will detach the file from the agreement.', confirmLabel: 'Remove', danger: true });
    if (ok) {
      a.files = a.files.filter((f) => f.id !== fid);
      a.updatedAt = new Date().toISOString();
      Store.save();
      Toast.show('File removed.', 'success');
      Router.render();
    }
  }));
}

function advanceStage(agreementId) {
  const a = findAgreement(agreementId);
  const idx = WORKFLOW_STAGES.indexOf(a.status);
  if (idx >= WORKFLOW_STAGES.length - 1) {
    Toast.show('Already at final stage.', 'info');
    return;
  }
  const nextStage = WORKFLOW_STAGES[idx + 1];
  Modal.open({
    title: `Advance to "${nextStage}"`,
    body: `
      <p class="text-sm text-slate-600 dark:text-slate-300 mb-3">Add an optional note describing this transition:</p>
      <textarea id="stage-note" rows="3" class="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" placeholder="e.g. Forwarded to legal team for review"></textarea>`,
    actions: [
      { label: 'Cancel', variant: 'secondary' },
      { label: `Advance to ${nextStage}`, variant: 'primary', onClick: () => {
        const note = $('#stage-note').value.trim();
        const prev = a.status;
        a.status = nextStage;
        a.progress = stageProgress(nextStage);
        a.updatedAt = new Date().toISOString();
        if (nextStage === 'Signed' || nextStage === 'Completed') a.signedDate = a.signedDate || new Date().toISOString();
        a.statusHistory.push({ from: prev, to: nextStage, at: new Date().toISOString(), by: Auth.current.id, note });
        Store.state.activityLogs.unshift({
          id: uid('log'), agreementId: a.id, userId: Auth.current.id,
          action: 'STATUS_CHANGE', message: `Status changed from ${prev} to ${nextStage}`,
          at: new Date().toISOString(),
        });
        // Auto-archive
        if (ARCHIVE_STATUSES.includes(nextStage) && nextStage !== 'Archived') {
          Toast.show(`Auto-archived to Library`, 'success');
        }
        Store.save();
        Toast.show(`Status advanced to ${nextStage}.`, 'success');
        Router.render();
      }},
    ],
  });
}

/* ============================ Agreement Form ============================= */

function viewAgreementForm({ id } = {}) {
  const isEdit = !!id;
  const a = isEdit ? findAgreement(id) : null;
  if (isEdit && !a) {
    renderAdminLayout(UI.empty({ icon: 'file-x', title: 'Agreement not found' }), '/admin/agreements');
    return;
  }
  const defaults = a || {
    code: '', title: '', type: 'MoU',
    institutionId: '',
    departmentId: '',
    picUserId: Auth.current.id,
    status: 'Drafting',
    contactDate: new Date().toISOString().slice(0, 10),
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    description: '', notes: '', tags: [],
  };
  // Existing edits may predate contactDate — fall back to createdAt so the
  // stopwatch on the dashboard has a sensible anchor.
  const contactDateValue = defaults.contactDate || a?.createdAt || new Date().toISOString();

  const content = `
    <div class="flex items-center gap-2 mb-4 text-sm text-slate-500">
      <a href="#/admin/agreements" class="hover:text-brand-600">Agreements</a>
      <i data-lucide="chevron-right" class="w-4 h-4"></i>
      <span class="text-slate-700 dark:text-slate-300">${isEdit ? 'Edit' : 'New'}</span>
    </div>
    <h1 class="text-2xl font-bold mb-6">${isEdit ? 'Edit Agreement' : 'New Agreement'}</h1>

    <form id="ag-form" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-5">
        ${UI.card({
          title: 'Basic Information',
          body: `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="sm:col-span-2">
                <label class="block text-xs font-semibold mb-1.5">Title *</label>
                <input name="title" required value="${escapeHtml(defaults.title)}" class="form-input w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Type *</label>
                <select name="type" required class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
                  ${AGREEMENT_TYPES.map((t) => `<option value="${t}" ${defaults.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Code</label>
                <input name="code" value="${escapeHtml(defaults.code)}" placeholder="Auto-generated if blank" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Partner Institution *</label>
                <div id="cb-institution">${Combobox.render({
                  name: 'institutionId',
                  value: defaults.institutionId,
                  required: true,
                  placeholder: 'Type to search or add a new institution…',
                })}</div>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Department / Faculty *</label>
                <div id="cb-department">${Combobox.render({
                  name: 'departmentId',
                  value: defaults.departmentId,
                  required: true,
                  placeholder: 'Type to search a department or faculty…',
                })}</div>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Person In Charge *</label>
                <select name="picUserId" required class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
                  ${Store.state.users.filter((u) => u.active).map((u) => `<option value="${u.id}" ${defaults.picUserId === u.id ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Status</label>
                <select name="status" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
                  <optgroup label="Lifecycle">
                    ${LIFECYCLE_STATUSES.map((s) => `<option value="${s}" ${defaults.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </optgroup>
                  <optgroup label="Workflow">
                    ${WORKFLOW_STAGES.map((s) => `<option value="${s}" ${defaults.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </optgroup>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Contact Date *</label>
                <input type="date" name="contactDate" required value="${new Date(contactDateValue).toISOString().slice(0, 10)}" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
                <p class="mt-1 text-[11px] text-slate-500">When this partner was first contacted — anchors the in-process timer.</p>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Start Date *</label>
                <input type="date" name="startDate" required value="${new Date(defaults.startDate).toISOString().slice(0, 10)}" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">End Date *</label>
                <input type="date" name="endDate" required value="${new Date(defaults.endDate).toISOString().slice(0, 10)}" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-xs font-semibold mb-1.5">Tags (comma separated)</label>
                <input name="tags" value="${escapeHtml((defaults.tags || []).join(', '))}" placeholder="Strategic, Research, International" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
              </div>
            </div>`,
        })}

        ${UI.card({
          title: 'Description & Notes',
          body: `
            <div>
              <label class="block text-xs font-semibold mb-1.5">Description</label>
              <textarea name="description" rows="4" class="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">${escapeHtml(defaults.description || '')}</textarea>
            </div>
            <div class="mt-4">
              <label class="block text-xs font-semibold mb-1.5">Internal Notes (private)</label>
              <textarea name="notes" rows="3" class="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">${escapeHtml(defaults.notes || '')}</textarea>
            </div>`,
        })}
      </div>

      <aside class="space-y-5">
        ${UI.card({
          title: 'Save',
          body: `
            <button type="submit" class="w-full h-11 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2">
              <i data-lucide="save" class="w-4 h-4"></i>${isEdit ? 'Update Agreement' : 'Create Agreement'}
            </button>
            <a href="#${isEdit ? `/admin/agreements/${a.id}` : '/admin/agreements'}" class="block mt-2 text-center h-11 leading-[44px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold">Cancel</a>`,
        })}
        ${UI.card({
          title: 'Workflow Reminder',
          body: `<ol class="text-xs space-y-1.5 text-slate-600 dark:text-slate-300 list-decimal pl-4">
            ${WORKFLOW_STAGES.map((s) => `<li>${s}</li>`).join('')}
          </ol>
          <p class="mt-3 text-xs text-slate-500">Marking status as <strong>Signed</strong>, <strong>Completed</strong>, or <strong>Finalized</strong> will auto-archive this agreement to the library.</p>`,
        })}
      </aside>
    </form>
  `;
  renderAdminLayout(content, isEdit ? '/admin/agreements' : '/admin/agreements/new');

  // Partner Institution combobox — searchable + supports adding a brand-new
  // institution inline via a small modal for country / kind.
  Combobox.init($('#cb-institution'), {
    options: Store.state.institutions.map((i) => ({
      id: i.id, label: i.name, sublabel: i.country || (i.kind || ''),
    })),
    allowAdd: true,
    addLabel: 'Add new institution',
    noMatch: 'No institutions match — type a name to add a new one.',
    onAdd: (name, done) => {
      if (!name) return;
      Modal.open({
        title: 'Add new partner institution',
        body: `
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-semibold mb-1.5">Name</label>
              <input id="ni-name" value="${escapeHtml(name)}" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold mb-1.5">Country</label>
                <input id="ni-country" placeholder="e.g. Indonesia" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1.5">Kind</label>
                <select id="ni-kind" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
                  <option value="Domestic">Domestic</option>
                  <option value="International">International</option>
                </select>
              </div>
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1.5">Type</label>
              <select id="ni-type" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
                ${INSTITUTION_TYPES.map((t) => `<option value="${t}">${titleCase(t)}</option>`).join('')}
              </select>
            </div>
          </div>`,
        actions: [
          { label: 'Cancel', variant: 'secondary' },
          { label: 'Add institution', variant: 'primary', onClick: () => {
            const nm = $('#ni-name').value.trim();
            const country = $('#ni-country').value.trim();
            const kind = $('#ni-kind').value;
            const itype = $('#ni-type').value;
            if (!nm) { Toast.show('Institution name is required.', 'error'); return false; }
            const inst = {
              id: `inst-custom-${Date.now().toString(36)}`,
              name: nm,
              canonical_name: nm,
              kind,
              country: country || null,
              city: null,
              address: null,
              institutionTypes: [itype],
              institution_types: [itype],
              type: titleCase(itype),
            };
            Store.state.institutions.push(inst);
            Store.save();
            Toast.show(`Added "${nm}" to the institution list.`, 'success');
            done({ id: inst.id, label: inst.name, sublabel: inst.country || inst.kind });
          } },
        ],
      });
    },
  });

  Combobox.init($('#cb-department'), {
    options: Store.state.departments.map((d) => ({
      id: d.id, label: d.name, sublabel: d.isFaculty ? 'Faculty' : 'Department',
    })),
    noMatch: 'No departments or faculties match.',
  });

  $('#ag-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());

    if (!data.institutionId) { Toast.show('Please choose or add a partner institution.', 'error'); return; }
    if (!data.departmentId) { Toast.show('Please choose a department or faculty.', 'error'); return; }
    if (new Date(data.endDate) <= new Date(data.startDate)) {
      Toast.show('End date must be after start date.', 'error'); return;
    }

    const now = new Date().toISOString();
    const tags = data.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (isEdit) {
      const prevStatus = a.status;
      Object.assign(a, {
        ...data, tags,
        contactDate: new Date(data.contactDate).toISOString(),
        startDate: new Date(data.startDate).toISOString(),
        endDate: new Date(data.endDate).toISOString(),
        progress: stageProgress(data.status),
        updatedAt: now,
      });
      if (prevStatus !== data.status) {
        a.statusHistory.push({ from: prevStatus, to: data.status, at: now, by: Auth.current.id, note: 'Status updated via edit form' });
        Store.state.activityLogs.unshift({ id: uid('log'), agreementId: a.id, userId: Auth.current.id, action: 'STATUS_CHANGE', message: `Status changed from ${prevStatus} to ${data.status}`, at: now });
        if (ARCHIVE_STATUSES.includes(data.status) && !ARCHIVE_STATUSES.includes(prevStatus)) a.signedDate = a.signedDate || now;
      } else {
        Store.state.activityLogs.unshift({ id: uid('log'), agreementId: a.id, userId: Auth.current.id, action: 'UPDATED', message: `Agreement "${a.title}" updated`, at: now });
      }
      Store.save();
      Toast.show('Agreement updated.', 'success');
      Router.go(`/admin/agreements/${a.id}`);
    } else {
      const code = data.code.trim() || `${data.type}-${new Date().getFullYear()}-${String(Store.state.agreements.length + 100).padStart(3, '0')}`;
      const newAg = {
        id: uid('ag'), code, ...data, tags,
        contactDate: new Date(data.contactDate).toISOString(),
        startDate: new Date(data.startDate).toISOString(),
        endDate: new Date(data.endDate).toISOString(),
        signedDate: ARCHIVE_STATUSES.includes(data.status) ? now : null,
        progress: stageProgress(data.status),
        createdAt: now, updatedAt: now,
        files: [],
        statusHistory: [{ from: null, to: data.status, at: now, by: Auth.current.id, note: 'Initial creation' }],
      };
      Store.state.agreements.unshift(newAg);
      Store.state.activityLogs.unshift({ id: uid('log'), agreementId: newAg.id, userId: Auth.current.id, action: 'CREATED', message: `Agreement "${newAg.title}" created`, at: now });
      Store.save();
      Toast.show('Agreement created.', 'success');
      Router.go(`/admin/agreements/${newAg.id}`);
    }
  });
}

function simulateUpload(agreementId) {
  const a = findAgreement(agreementId);
  Modal.open({
    title: 'Upload Document',
    body: `
      <div class="p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-center">
        <i data-lucide="cloud-upload" class="w-10 h-10 text-slate-400 mx-auto mb-2"></i>
        <p class="text-sm text-slate-600 dark:text-slate-300">Drop PDF here or click to browse</p>
        <input id="file-input" type="file" accept="application/pdf,image/*" class="mt-3 text-xs" />
      </div>
      <p class="text-xs text-slate-500 mt-3">Demo only — file is not actually stored. In production this would upload to Supabase Storage or S3.</p>`,
    actions: [
      { label: 'Cancel', variant: 'secondary' },
      { label: 'Upload', variant: 'primary', onClick: () => {
        const fileEl = $('#file-input');
        const file = fileEl.files[0];
        if (!file) { Toast.show('No file selected.', 'error'); return false; }
        a.files.push({
          id: uid('f'),
          name: file.name,
          size: file.size / (1024 * 1024),
          uploadedAt: new Date().toISOString(),
        });
        a.updatedAt = new Date().toISOString();
        Store.state.activityLogs.unshift({ id: uid('log'), agreementId: a.id, userId: Auth.current.id, action: 'FILE_UPLOAD', message: `Uploaded file "${file.name}"`, at: a.updatedAt });
        Store.save();
        Toast.show('File uploaded (simulated).', 'success');
        Router.render();
      }},
    ],
  });
  refreshIcons();
}

/* ============================ Archive Library (Admin) ==================== */

function viewArchiveLibrary() {
  const archived = Store.state.agreements.filter((a) => ARCHIVE_STATUSES.includes(a.status));
  let page = 1;
  const PAGE_SIZE = 24;
  const content = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-bold">Partnership Catalog</h1>
        <p class="text-sm text-slate-500 mt-1"><span id="arc-count">${archived.length}</span> signed / ongoing agreement(s)</p>
      </div>
      <button data-action="export" class="inline-flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold">
        <i data-lucide="download" class="w-4 h-4"></i> Export CSV
      </button>
    </div>
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3">
      <div class="relative flex-1 min-w-[220px]">
        <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
        <input id="arc-q" type="search" placeholder="Search partner, code, agenda…" class="w-full h-10 pl-9 pr-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
      </div>
      <select id="arc-kind" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
        <option value="">All regions</option>
        <option value="International">International</option>
        <option value="Domestic">Domestic</option>
      </select>
      <select id="arc-type" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
        <option value="">All types</option>
        ${AGREEMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <select id="arc-dept" class="h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
        <option value="">All units</option>
        ${[...Store.state.departments].sort((a, b) => a.short.localeCompare(b.short)).map((d) => `<option value="${d.id}">${escapeHtml(d.short)}</option>`).join('')}
      </select>
    </div>
    <div id="arc-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"></div>
    <div id="arc-pagination" class="mt-6 flex items-center justify-between text-sm"></div>
  `;
  renderAdminLayout(content, '/admin/archive');

  const render = () => {
    const q = $('#arc-q').value.trim().toLowerCase();
    const kind = $('#arc-kind').value;
    const type = $('#arc-type').value;
    const dept = $('#arc-dept').value;
    const list = archived.filter((a) => {
      const inst = findInstitution(a.institutionId);
      const matchesQ = !q || [a.title, a.code, inst?.name, a.description, (a.tags || []).join(' ')].join(' ').toLowerCase().includes(q);
      const matchesK = !kind || a.kind === kind;
      const matchesT = !type || a.type === type;
      const matchesD = !dept || a.departmentId === dept;
      return matchesQ && matchesK && matchesT && matchesD;
    });
    list.sort((a, b) => {
      const ya = a.startDate ? new Date(a.startDate).getFullYear() : 0;
      const yb = b.startDate ? new Date(b.startDate).getFullYear() : 0;
      if (yb !== ya) return yb - ya;
      return new Date(b.startDate || 0) - new Date(a.startDate || 0);
    });
    $('#arc-count').textContent = list.length;
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const grid = $('#arc-grid');
    if (!list.length) {
      grid.innerHTML = `<div class="col-span-full">${UI.empty({ icon: 'library', title: 'No matching agreements' })}</div>`;
    } else {
      grid.innerHTML = slice.map((a) => {
        const inst = findInstitution(a.institutionId);
        const endLabel = a.endDate ? fmtDate(a.endDate) : escapeHtml(a.endDateRaw || '—');
        return `
          <article class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:border-brand-500 transition">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[10px] font-bold px-2 py-1 rounded-md ${typeChipClass(a.type)}">${a.type}</span>
                ${UI.pill(a.status)}
                ${a.kind ? `<span class="text-[10px] font-semibold px-2 py-1 rounded-md ${a.kind === 'International' ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}">${escapeHtml(a.kind)}</span>` : ''}
              </div>
              <div class="text-[11px] font-mono text-slate-400">${escapeHtml(a.code)}</div>
            </div>
            <h3 class="mt-3 font-semibold leading-snug"><a href="#/admin/agreements/${a.id}" class="hover:text-brand-600">${escapeHtml(inst?.name || a.title)}</a></h3>
            ${a.description ? `<p class="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${escapeHtml(a.description)}</p>` : ''}
            <div class="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <div class="flex items-center gap-1.5"><i data-lucide="layers" class="w-3.5 h-3.5"></i>${escapeHtml(a.implementingUnit || '—')}</div>
              <div class="flex items-center gap-1.5"><i data-lucide="calendar" class="w-3.5 h-3.5"></i>${fmtDate(a.startDate)} → ${endLabel}</div>
              ${inst?.country ? `<div class="flex items-center gap-1.5"><i data-lucide="globe" class="w-3.5 h-3.5"></i>${escapeHtml(inst.country)}</div>` : ''}
            </div>
            <div class="mt-3 flex items-center justify-end">
              <a href="#/admin/agreements/${a.id}" class="text-xs font-semibold text-brand-600 hover:underline">View →</a>
            </div>
          </article>`;
      }).join('');
    }
    $('#arc-pagination').innerHTML = `
      <div class="text-slate-500">Showing ${slice.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${(page - 1) * PAGE_SIZE + slice.length} of ${list.length}</div>
      <div class="flex items-center gap-1">
        <button data-arc-page="prev" class="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40" ${page === 1 ? 'disabled' : ''}>Prev</button>
        <span class="px-3 py-1.5 text-slate-600">Page ${page} of ${totalPages}</span>
        <button data-arc-page="next" class="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40" ${page === totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
    $$('[data-arc-page]').forEach((b) => b.addEventListener('click', () => {
      const d = b.getAttribute('data-arc-page');
      if (d === 'prev' && page > 1) page--;
      else if (d === 'next' && page < totalPages) page++;
      render();
    }));
    refreshIcons();
  };
  $('#arc-q').addEventListener('input', debounce(() => { page = 1; render(); }, 150));
  ['arc-kind', 'arc-type', 'arc-dept'].forEach((id) => $(`#${id}`).addEventListener('change', () => { page = 1; render(); }));
  $('[data-action="export"]').addEventListener('click', () => exportAgreementsCSV(archived, 'catalog'));
  render();
}

/* ============================ Admin Analytics ============================ */

function viewAdminAnalytics() {
  const content = `
    <h1 class="text-2xl font-bold mb-1">Analytics & Reports</h1>
    <p class="text-sm text-slate-500 mb-6">Insights across the partnership portfolio.</p>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      ${UI.card({ title: 'Lifecycle Status', body: `<div class="h-72"><canvas id="an-status"></canvas></div>` })}
      ${UI.card({ title: 'Domestic vs International', body: `<div class="h-72"><canvas id="an-kind"></canvas></div>` })}
      ${UI.card({ title: 'Agreements by Year', body: `<div class="h-72"><canvas id="an-yearly"></canvas></div>` })}
      ${UI.card({ title: 'Partner Countries', body: `<div class="h-72"><canvas id="an-country"></canvas></div>` })}
      ${UI.card({ title: 'Implementing Departments', body: `<div class="h-72"><canvas id="an-dept"></canvas></div>` })}
      ${UI.card({ title: 'Top Partner Institutions', body: `<div class="h-72"><canvas id="an-top-partners"></canvas></div>` })}
    </div>
    <div class="mt-6">
      ${UI.card({ title: 'Expiration Timeline', body: `<div class="h-64"><canvas id="an-exp"></canvas></div>` })}
    </div>
  `;
  renderAdminLayout(content, '/admin/analytics');
  Charts.destroyAll();
  setTimeout(() => {
    Charts.statusPie('an-status');
    Charts.kindDonut('an-kind');
    Charts.agreementsByYear('an-yearly');
    Charts.countryBar('an-country');
    Charts.departmentBar('an-dept');
    Charts.topPartnersBar('an-top-partners', { limit: 10 });
    Charts.expirationTimeline('an-exp');
  }, 30);
}

/* ============================ Users ====================================== */

function viewUsers() {
  if (Auth.current.role !== 'Admin') {
    renderAdminLayout(UI.empty({ icon: 'lock', title: 'Restricted', message: 'Only admins can manage users.' }), '/admin/users');
    return;
  }
  const content = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-bold">User Management</h1>
        <p class="text-sm text-slate-500 mt-1">Manage admin and staff accounts.</p>
      </div>
      <button data-action="add-user" class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold">
        <i data-lucide="user-plus" class="w-4 h-4"></i> Add User
      </button>
    </div>
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      <table class="min-w-full text-sm">
        <thead class="bg-slate-50 dark:bg-slate-900/70 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th class="text-left px-4 py-3">User</th>
            <th class="text-left px-4 py-3">Role</th>
            <th class="text-left px-4 py-3">Department</th>
            <th class="text-left px-4 py-3">Status</th>
            <th class="text-right px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody id="users-tbody" class="divide-y divide-slate-100 dark:divide-slate-800"></tbody>
      </table>
    </div>
  `;
  renderAdminLayout(content, '/admin/users');

  const render = () => {
    $('#users-tbody').innerHTML = Store.state.users.map((u) => {
      const dept = findDepartment(u.department);
      return `
        <tr class="row-hover">
          <td class="px-4 py-3">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white">${u.avatar || '👤'}</div>
              <div>
                <div class="font-semibold">${escapeHtml(u.name)}</div>
                <div class="text-xs text-slate-500">${escapeHtml(u.email)}</div>
              </div>
            </div>
          </td>
          <td class="px-4 py-3"><span class="text-xs font-semibold px-2 py-1 rounded-md ${u.role === 'Admin' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : u.role === 'Manager' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : u.role === 'Staff' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}">${escapeHtml(u.role)}</span></td>
          <td class="px-4 py-3">${escapeHtml(dept?.name || '—')}</td>
          <td class="px-4 py-3">${u.active ? '<span class="pill pill-signed">Active</span>' : '<span class="pill pill-archived">Disabled</span>'}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap">
            <button data-toggle="${u.id}" class="px-2.5 py-1.5 text-xs rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">${u.active ? 'Disable' : 'Enable'}</button>
            ${u.id !== Auth.current.id ? `<button data-delete-user="${u.id}" class="px-2.5 py-1.5 text-xs rounded-md text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">Delete</button>` : ''}
          </td>
        </tr>`;
    }).join('');
    refreshIcons();
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
      const u = findUser(b.getAttribute('data-toggle'));
      u.active = !u.active;
      Store.save();
      Toast.show(`User ${u.active ? 'enabled' : 'disabled'}.`, 'success');
      render();
    }));
    $$('[data-delete-user]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-delete-user');
      const u = findUser(id);
      const ok = await Modal.confirm({ title: 'Delete user?', message: `Permanently delete ${u.name}?`, confirmLabel: 'Delete', danger: true });
      if (ok) {
        Store.state.users = Store.state.users.filter((x) => x.id !== id);
        Store.save();
        Toast.show('User deleted.', 'success');
        render();
      }
    }));
  };
  render();

  $('[data-action="add-user"]').addEventListener('click', () => {
    Modal.open({
      title: 'Add User',
      size: 'md',
      body: `
        <form id="new-user-form" class="space-y-3 text-sm">
          <div><label class="block text-xs font-semibold mb-1">Name</label><input name="name" required class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" /></div>
          <div><label class="block text-xs font-semibold mb-1">Email</label><input name="email" type="email" required class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" /></div>
          <div><label class="block text-xs font-semibold mb-1">Password</label><input name="password" type="text" required class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" /></div>
          <div><label class="block text-xs font-semibold mb-1">Role</label>
            <select name="role" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
              <option>Admin</option><option>Manager</option><option selected>Staff</option><option>Viewer</option>
            </select>
          </div>
          <div><label class="block text-xs font-semibold mb-1">Department</label>
            <select name="department" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
              ${Store.state.departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
        </form>`,
      actions: [
        { label: 'Cancel', variant: 'secondary' },
        { label: 'Create', variant: 'primary', onClick: () => {
          const form = $('#new-user-form');
          if (!form.reportValidity()) return false;
          const fd = new FormData(form);
          const data = Object.fromEntries(fd.entries());
          if (Store.state.users.some((u) => u.email.toLowerCase() === data.email.toLowerCase())) {
            Toast.show('Email already exists.', 'error'); return false;
          }
          Store.state.users.push({ id: uid('u'), avatar: '👤', active: true, ...data });
          Store.save();
          Toast.show('User created.', 'success');
          render();
        }},
      ],
    });
  });
}

/* ============================ Notifications ============================== */

function viewNotifications() {
  const content = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-bold">Notifications</h1>
        <p class="text-sm text-slate-500 mt-1">${Store.state.notifications.filter((n) => !n.read).length} unread</p>
      </div>
      <button data-action="mark-all" class="inline-flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold">
        <i data-lucide="check-check" class="w-4 h-4"></i> Mark all read
      </button>
    </div>
    <div id="notif-list" class="space-y-2"></div>
  `;
  renderAdminLayout(content, '/admin/notifications');
  const render = () => {
    const list = Store.state.notifications.sort((a, b) => new Date(b.at) - new Date(a.at));
    const el = $('#notif-list');
    if (!list.length) { el.innerHTML = UI.empty({ icon: 'bell-off', title: 'No notifications' }); refreshIcons(); return; }
    el.innerHTML = list.map((n) => {
      const tone = n.type === 'expiration' ? 'rose' : n.type === 'warning' ? 'amber' : 'brand';
      const icon = n.type === 'expiration' ? 'alarm-clock' : n.type === 'warning' ? 'alert-triangle' : 'bell';
      return `
        <div class="bg-white dark:bg-slate-900 border ${n.read ? 'border-slate-200 dark:border-slate-800' : 'border-brand-200 dark:border-brand-500/30 ring-1 ring-brand-500/10'} rounded-xl p-4 flex items-start gap-3">
          <div class="w-9 h-9 rounded-lg bg-${tone}-100 dark:bg-${tone}-500/15 text-${tone}-700 dark:text-${tone}-300 flex items-center justify-center shrink-0"><i data-lucide="${icon}" class="w-4 h-4"></i></div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-semibold">${escapeHtml(n.title)}</h4>
              ${!n.read ? '<span class="w-2 h-2 rounded-full bg-brand-500"></span>' : ''}
            </div>
            <p class="text-sm text-slate-600 dark:text-slate-300 mt-0.5">${escapeHtml(n.message)}</p>
            <div class="text-xs text-slate-500 mt-1">${fmtDateTime(n.at)}</div>
          </div>
          <div class="flex items-center gap-1">
            ${n.agreementId ? `<a href="#/admin/agreements/${n.agreementId}" class="px-2.5 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 rounded-md">View</a>` : ''}
            <button data-toggle-read="${n.id}" class="px-2.5 py-1.5 text-xs rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">${n.read ? 'Mark unread' : 'Mark read'}</button>
          </div>
        </div>`;
    }).join('');
    refreshIcons();
    $$('[data-toggle-read]').forEach((b) => b.addEventListener('click', () => {
      const n = Store.state.notifications.find((x) => x.id === b.getAttribute('data-toggle-read'));
      n.read = !n.read; Store.save(); render();
    }));
  };
  render();
  $('[data-action="mark-all"]').addEventListener('click', () => {
    Store.state.notifications.forEach((n) => n.read = true);
    Store.save();
    Toast.show('All marked as read.', 'success');
    render();
  });
}

/* ============================ Settings =================================== */

function viewSettings() {
  const u = findUser(Auth.current.id);
  const content = `
    <h1 class="text-2xl font-bold mb-1">Settings</h1>
    <p class="text-sm text-slate-500 mb-6">Manage your profile and application preferences.</p>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        ${UI.card({
          title: 'Profile',
          body: `
            <form id="profile-form" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="sm:col-span-2 flex items-center gap-4">
                <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white text-2xl">${u.avatar}</div>
                <div>
                  <div class="font-bold">${escapeHtml(u.name)}</div>
                  <div class="text-sm text-slate-500">${escapeHtml(u.email)} · ${escapeHtml(u.role)}</div>
                </div>
              </div>
              <div><label class="block text-xs font-semibold mb-1.5">Display Name</label><input name="name" value="${escapeHtml(u.name)}" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" /></div>
              <div><label class="block text-xs font-semibold mb-1.5">Email</label><input name="email" type="email" value="${escapeHtml(u.email)}" class="w-full h-10 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" /></div>
              <div class="sm:col-span-2"><button type="submit" class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold"><i data-lucide="save" class="w-4 h-4"></i>Save profile</button></div>
            </form>`,
        })}
        ${UI.card({
          title: 'Appearance',
          body: `
            <div class="flex items-center justify-between">
              <div>
                <div class="font-semibold text-sm">Theme</div>
                <div class="text-xs text-slate-500">Choose your preferred color scheme</div>
              </div>
              <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                <button data-theme="light" class="px-3 py-1.5 rounded-md text-xs font-semibold ${Store.state.theme === 'light' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}">Light</button>
                <button data-theme="dark" class="px-3 py-1.5 rounded-md text-xs font-semibold ${Store.state.theme === 'dark' ? 'bg-slate-900 text-white shadow' : 'text-slate-500'}">Dark</button>
              </div>
            </div>`,
        })}
      </div>
      <aside class="space-y-6">
        ${UI.card({
          title: 'Data Management',
          body: `
            <div class="space-y-2">
              <button data-action="export-all" class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-brand-500 rounded-lg text-sm font-semibold"><i data-lucide="download" class="w-4 h-4"></i>Export all data (JSON)</button>
              <button data-action="export-csv" class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-brand-500 rounded-lg text-sm font-semibold"><i data-lucide="table" class="w-4 h-4"></i>Export agreements (CSV)</button>
              <button data-action="reset" class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 rounded-lg text-sm font-semibold"><i data-lucide="refresh-cw" class="w-4 h-4"></i>Re-import from database</button>
            </div>`,
        })}
        ${UI.card({
          title: 'About',
          body: `<p class="text-sm text-slate-600 dark:text-slate-300">Petra Partnership Dashboard v1.0 — MoU / MoA / IA portfolio for Universitas Kristen Petra. Built with vanilla JS, Tailwind, and Chart.js. Records are imported from <code class="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">data/*.json</code> at first load and persisted in your browser via localStorage. Use "Re-import from database" to refresh after the source files change.</p>`,
        })}
      </aside>
    </div>
  `;
  renderAdminLayout(content, '/admin/settings');

  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    Object.assign(u, { name: fd.get('name'), email: fd.get('email') });
    Object.assign(Auth.current, { name: u.name, email: u.email });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(Auth.current));
    Store.save();
    Toast.show('Profile updated.', 'success');
  });
  $$('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    Theme.apply(b.getAttribute('data-theme'));
    Router.render();
  }));
  $('[data-action="export-all"]').addEventListener('click', () => {
    downloadFile('unicollab-data.json', JSON.stringify(Store.state, null, 2), 'application/json');
    Toast.show('Exported.', 'success');
  });
  $('[data-action="export-csv"]').addEventListener('click', () => exportAgreementsCSV());
  $('[data-action="reset"]').addEventListener('click', async () => {
    const ok = await Modal.confirm({
      title: 'Re-import from database?',
      message: 'This will discard local edits and reload all institutions, departments, and agreements from data/*.json.',
      confirmLabel: 'Re-import',
      danger: true,
    });
    if (!ok) return;
    try {
      await Store.reset();
      Toast.show('Database re-imported.', 'success');
      Router.render();
    } catch (err) {
      Toast.show(`Re-import failed: ${err.message || err}`, 'error', 6000);
    }
  });
}

/* ============================ Export ===================================== */

function exportAgreementsCSV(list, filename = 'partnerships') {
  const rows = list || Store.state.agreements;
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
  const headers = [
    'Code', 'Kind', 'Type', 'Status',
    'Partner', 'Country', 'City',
    'Implementing Unit', 'Department', 'Scope',
    'Start Date', 'End Date', 'End Date (raw)', 'Renewal Date',
    'Agenda', 'Realization', 'Notes',
  ];
  const csv = [headers.join(',')];
  rows.forEach((a) => {
    const inst = findInstitution(a.institutionId);
    const dept = findDepartment(a.departmentId);
    csv.push([
      a.code,
      a.kind || '',
      a.type,
      a.status,
      q(inst?.name || a.title),
      inst?.country || '',
      q(inst?.city || ''),
      q(a.implementingUnit || ''),
      dept?.short || '',
      q(a.scope || ''),
      a.startDate?.slice(0, 10) || '',
      a.endDate?.slice(0, 10) || '',
      q(a.endDateRaw || ''),
      a.renewalDate?.slice(0, 10) || '',
      q(a.description || ''),
      q(a.realization ?? ''),
      q(a.notes || ''),
    ].join(','));
  });
  downloadFile(`${filename}-${new Date().toISOString().slice(0, 10)}.csv`, csv.join('\n'), 'text/csv');
  Toast.show('CSV exported.', 'success');
}

function exportAgreementsXLSX(list, filename = 'partnerships') {
  const rows = list || Store.state.agreements;
  if (typeof XLSX === 'undefined') {
    Toast.show('Excel library not loaded — falling back to CSV.', 'warning');
    exportAgreementsCSV(rows, filename);
    return;
  }
  if (!rows.length) {
    Toast.show('No rows match the current filters.', 'warning');
    return;
  }
  const data = rows.map((a) => {
    const inst = findInstitution(a.institutionId);
    const dept = findDepartment(a.departmentId);
    const agITypes = Array.isArray(a.institutionType) ? a.institutionType : (a.institutionType ? [a.institutionType] : []);
    const itypes = agITypes.length ? agITypes : (inst?.institutionTypes || []);
    return {
      'Code': a.code || '',
      'Region': a.kind || '',
      'Type': a.type || '',
      'Status': a.status || '',
      'Partner': inst?.name || a.title || '',
      'Country': inst?.country || '',
      'City': inst?.city || '',
      'Institution Type': itypes.map(titleCase).join(', '),
      'Implementing Unit': a.implementingUnit || '',
      'Department': dept?.short || '',
      'Scope': titleCase(a.scope || ''),
      'Scope Tags': (a.scopeTags || []).map(titleCase).join(', '),
      'New Partner': a.newPartner ? 'Yes' : 'No',
      'Start Date': a.startDate ? a.startDate.slice(0, 10) : '',
      'End Date': a.endDate ? a.endDate.slice(0, 10) : '',
      'End Date (raw)': a.endDateRaw || '',
      'Renewal Date': a.renewalDate ? String(a.renewalDate).slice(0, 10) : '',
      'Agenda': a.description || '',
      'Realization': a.realization ?? '',
      'Notes': a.notes || '',
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  // Auto-size columns based on the longest cell per column (capped).
  const headers = Object.keys(data[0]);
  ws['!cols'] = headers.map((h) => {
    const maxLen = data.reduce((m, row) => Math.max(m, String(row[h] ?? '').length), h.length);
    return { wch: Math.min(60, maxLen + 2) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Partnerships');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}-${stamp}.xlsx`);
  Toast.show(`Exported ${rows.length} row(s) to Excel.`, 'success');
}

/* ============================ 404 ======================================== */

function view404() {
  const app = $('#app');
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center px-4">
      <div class="text-center">
        <div class="text-6xl mb-4">🔍</div>
        <h1 class="text-2xl font-bold mb-2">Page not found</h1>
        <p class="text-slate-500 mb-6">The page you're looking for doesn't exist.</p>
        <a href="#/" class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold">
          <i data-lucide="home" class="w-4 h-4"></i>Back to dashboard
        </a>
      </div>
    </div>`;
}

/* ============================ Routes ===================================== */

Router.add('/',           () => viewGuestDashboard());
Router.add('/library',    () => viewGuestLibrary());
Router.add('/analytics',  () => viewGuestAnalytics());
Router.add('/login',      () => viewLogin());

Router.add('/admin',                                      () => viewAdminDashboard(),    { requireAuth: true });
Router.add(/^\/admin\/agreements(\?.*)?$/,                () => viewAgreementList(),     { requireAuth: true });
Router.add('/admin/agreements/new',                       () => viewAgreementForm({}),   { requireAuth: true });
Router.add(/^\/admin\/agreements\/(?<id>[^/]+)\/edit$/,   (p) => viewAgreementForm(p),   { requireAuth: true });
Router.add(/^\/admin\/agreements\/(?<id>[^/]+)$/,         (p) => viewAgreementDetail(p), { requireAuth: true });
Router.add('/admin/archive',                              () => viewArchiveLibrary(),    { requireAuth: true });
Router.add('/admin/analytics',                            () => viewAdminAnalytics(),    { requireAuth: true });
Router.add('/admin/users',                                () => viewUsers(),             { requireAuth: true });
Router.add('/admin/notifications',                        () => viewNotifications(),     { requireAuth: true });
Router.add('/admin/settings',                             () => viewSettings(),          { requireAuth: true });
Router.add('/404',                                        () => view404());

/* ============================ Boot ======================================= */

function renderBootError(err) {
  const app = document.getElementById('app');
  if (!app) return;
  const msg = err && err.message ? err.message : String(err);
  const fileProtocol = location.protocol === 'file:';
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center px-4">
      <div class="max-w-lg w-full bg-white border border-rose-200 rounded-2xl p-7 shadow-xl">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center text-xl">!</div>
          <h1 class="text-lg font-bold text-slate-900">Cannot load the partnership database</h1>
        </div>
        <p class="text-sm text-slate-600">The app failed to fetch one of the required files in <code class="px-1 py-0.5 rounded bg-slate-100">data/</code>:</p>
        <pre class="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto">${escapeHtml(msg)}</pre>
        ${fileProtocol ? `
          <div class="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
            You opened <code>index.html</code> directly (<code>file://</code>). Browsers block <code>fetch()</code> from local files. Start a static server from the project root:
            <pre class="mt-2 text-xs bg-white border border-amber-200 rounded p-2">python3 -m http.server 8080</pre>
            then visit <a href="http://localhost:8080" class="font-semibold underline">http://localhost:8080</a>.
          </div>
        ` : `
          <p class="mt-4 text-sm text-slate-600">Check that <code>data/institutions.json</code>, <code>data/departments.json</code>, and <code>data/agreements.json</code> exist and are served by your web server. If you've updated the source JSON, re-run <code>python3 scripts/convert_partnerships.py</code>.</p>
        `}
      </div>
    </div>`;
}

(async function boot() {
  try {
    await Store.load();
  } catch (err) {
    console.error('Boot failed:', err);
    renderBootError(err);
    return;
  }
  await Auth.init();
  Theme.init();
  Router.init();
  // Lucide periodic refresh safety
  setTimeout(refreshIcons, 100);
})();
