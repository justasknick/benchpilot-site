// lib/shared.js - Constants and helpers shared by every BenchPilot context
// (service worker, content script, popup, dashboard, options, upgrade page).

(function (root) {
  'use strict';

  const CFG = root.BP_CONFIG || {};

  // ── Lead statuses (single source of truth) ──────────────────────────────
  const STATUSES = ['New', 'Contacted', 'Responded', 'Interview', 'Closed'];
  const STATUS_EMOJI = { New: '🆕', Contacted: '📨', Responded: '✅', Interview: '🎤', Closed: '🔒' };
  // Values written by v1.0.x drawer before statuses were unified
  const LEGACY_STATUS_MAP = { 'New Lead': 'New', 'Profile Sent': 'Contacted', 'Hot Lead': 'Responded' };

  function normalizeStatus(status) {
    if (STATUSES.includes(status)) return status;
    return LEGACY_STATUS_MAP[status] || 'New';
  }

  // ── Defaults ─────────────────────────────────────────────────────────────
  const DEFAULT_DESIGNATIONS = [
    'Technical Recruiter', 'US IT Recruiter', 'IT Recruiter', 'Recruiter',
    'Lead Recruiter', 'Lead IT Recruiter', 'Lead Technical Recruiter',
    'Talent Acquisition', 'Talent Acquisition Specialist', 'Lead Talent Acquisition Specialist',
    'Account Manager', 'Sourcer', 'Staffing', 'Recruitment', 'Delivery Manager'
  ];

  const DEFAULT_BLACKLIST = [
    'example.com', 'domain.com', 'sample.com', 'test.com', 'email.com',
    'sentry.io', 'w3.org', 'schema.org', 'cloudflare.com', 'linkedin.com'
  ];

  // ── Companies (v1.5 data foundation) ─────────────────────────────────────
  // A company groups recruiters by email domain. Free-mail domains never form one.
  const COMPANY_LABELS = {
    none: 'No label',
    trusted: 'Trusted',
    avoid: 'Avoid',
    'direct-client': 'Direct client',
    'prime-vendor': 'Prime vendor',
    'implementation-partner': 'Implementation partner',
    'bench-seller': 'Bench seller (not hiring)'
  };
  const COMPANY_LABEL_KEYS = Object.keys(COMPANY_LABELS);

  // Exact free-mail domains, plus families that exist under many country domains (yahoo.co.in...).
  const FREE_MAIL_DOMAINS = [
    'gmail.com', 'googlemail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
    'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'mail.com', 'rediffmail.com',
    'yahoo.com', 'yahoo.co.in', 'hotmail.com'   // also matched by FREE_MAIL_FAMILY; listed so plain .includes() keeps working
  ];
  // Old name, kept so nothing that still reads it breaks. Same list: use BP.isFreeMailDomain() for new code.
  const FREE_EMAIL_DOMAINS = FREE_MAIL_DOMAINS;
  const FREE_MAIL_FAMILY = /^(yahoo|hotmail|yandex|gmx)\.[a-z]{2,}(\.[a-z]{2,})?$/;

  // Lower-case domain of an email, or '' when it has none.
  function emailDomain(email) {
    const s = String(email || '').trim().toLowerCase();
    const at = s.lastIndexOf('@');
    if (at < 1) return '';
    const d = s.slice(at + 1);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : '';
  }

  function isFreeMailDomain(domain) {
    const d = String(domain || '').trim().toLowerCase();
    return FREE_MAIL_DOMAINS.includes(d) || FREE_MAIL_FAMILY.test(d);
  }

  // Company id for an email (its business domain), or null for free-mail / invalid addresses.
  function companyIdForEmail(email) {
    const d = emailDomain(email);
    return d && !isFreeMailDomain(d) ? d : null;
  }

  // Most common non-empty name (case-insensitive; ties go to the one seen first). Returns the
  // first-seen spelling, or `fallback` when there is none.
  function pickCompanyName(names, fallback = '') {
    const counts = new Map();
    for (const raw of names || []) {
      const n = String(raw || '').trim();
      if (!n) continue;
      const k = n.toLowerCase();
      const e = counts.get(k);
      if (e) e.n++; else counts.set(k, { name: n, n: 1 });
    }
    let best = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    return best ? best.name : fallback;
  }

  const DEFAULT_TEMPLATES = [
    {
      id: 'intro',
      name: 'Consultant intro',
      subject: 'Available consultant for your {requirement} role',
      body:
        'Hi {firstName},\n\n' +
        'I came across your {requirement} requirement {location}. I have a strong consultant available ' +
        'who matches this role and can start immediately.\n\n' +
        'Could you share the full job description and rate? I will send the resume right away.\n\n' +
        'Thanks & Regards,\n{myName}'
    },
    {
      id: 'consultant',
      name: 'Submit a consultant',
      subject: '{consultantTitle} available for your {requirement} role - {consultantVisa}',
      body:
        'Hi {firstName},\n\n' +
        'I saw your {requirement} requirement {location} and have a matching consultant:\n\n' +
        'Name: {consultantName}\n' +
        'Role: {consultantTitle}\n' +
        'Experience: {consultantExperience}\n' +
        'Key skills: {consultantSkills}\n' +
        'Visa: {consultantVisa}\n' +
        'Location: {consultantLocation}\n' +
        'Availability: {consultantAvailability}\n' +
        'Rate: {consultantRate}\n\n' +
        'Resume: {consultantResume}\n\n' +
        'Please let me know if we can submit. Happy to share more details.\n\n' +
        'Thanks & Regards,\n{myName}'
    },
    {
      id: 'hotlist',
      name: 'Hotlist share',
      subject: 'Available bench consultants - {technologies}',
      body:
        'Hi {firstName},\n\n' +
        'Hope you are doing well. Sharing our currently available consultants. ' +
        'Please let me know if any of them fit your open requirements at {company}.\n\n' +
        '<paste hotlist here>\n\n' +
        'Thanks & Regards,\n{myName}'
    }
  ];

  const MAX_CONSULTANTS = 200;
  const MAX_TEMPLATES = 10;

  // ── Plan tiers: the ONE table every context gates through ───────────────
  // reveals: new recruiter contacts per calendar month (Infinity = unlimited).
  // A reveal (shown to users as "contacts saved this month") = saving, copying or pitching a new recruiter contact.
  const TIERS = {
    free:  { label: 'Free',  reveals: 25,       consultants: 2,  templates: 1, quickNotes: 3,
             features: { csvImport: true } },
    basic: { label: 'Basic', reveals: 300,      consultants: 10, templates: 3, quickNotes: 20,
             features: { csvExport: true, followUps: true, csvImport: true, jsonExport: true, cleanupActions: true } },
    pro:   { label: 'Pro',   reveals: Infinity, consultants: MAX_CONSULTANTS, templates: MAX_TEMPLATES, quickNotes: Infinity,
             features: { csvExport: true, followUps: true, csvImport: true,
                         jsonExport: true, matcher: true, cleanupActions: true, resumeVersions: true } }
  };
  const TIER_ORDER = ['free', 'basic', 'pro'];
  const FEATURE_LABELS = {
    csvExport: 'CSV, Excel and JSON export', followUps: 'Follow-up dates with a due count on the toolbar icon',
    csvImport: 'CSV import (free)', jsonExport: 'JSON export', matcher: 'Tech matcher',
    cleanupActions: 'Fix my data actions (merge, dismiss, delete bounced)',
    resumeVersions: 'Resume version history'
  };
  // One line for every place a locked follow-up control is shown (Settings, lead panel). Matches the behaviour: submissions always get a
  // follow-up date; lead follow-up dates and the settings for them are Basic and up.
  const FOLLOWUP_PLAN_NOTE = 'Free: follow-ups on submissions. Basic+: follow-up dates on any recruiter.';
  const REVEAL_EXPLAINER = 'A contact counts when you save, copy or pitch a new recruiter. The same recruiter again is free.';

  // Accepts a tier string, a plan object ({ tier }) or a GET_STATE result ({ plan: { tier } }).
  function tierOf(x) {
    let t = x;
    if (t && typeof t === 'object') t = t.plan ? t.plan.tier : t.tier;
    return TIERS[t] ? t : 'free';
  }
  function limit(tier, key) { return TIERS[tierOf(tier)][key]; }
  function can(tier, feature) { return Boolean(TIERS[tierOf(tier)].features[feature]); }
  // The lowest tier that unlocks a feature (for "X is a Pro feature" messages).
  function minTierFor(feature) { return TIER_ORDER.find(t => TIERS[t].features[feature]) || 'pro'; }
  function tierLabel(tier) { return TIERS[tierOf(tier)].label; }

  // A paid plan that ends in this many days or fewer can be extended from the upgrade page (the server adds the new days to the
  // current end date, so none are lost). Takes a GET_STATE result or its `plan`. Returns { tier, label, daysLeft } or null.
  const EXTEND_WINDOW_DAYS = 14;
  function extendOffer(stateOrPlan) {
    const p = stateOrPlan && stateOrPlan.plan ? stateOrPlan.plan : stateOrPlan;
    if (!p || !p.isPaid || p.expired) return null;
    const d = Number(p.daysLeft);
    if (!Number.isFinite(d) || d < 0 || d > EXTEND_WINDOW_DAYS) return null;
    const tier = tierOf(p.tier);
    return { tier, label: 'Extend ' + TIERS[tier].label, daysLeft: d };
  }
  function tierRank(tier) { return TIER_ORDER.indexOf(tierOf(tier)); }
  // Signed license payload -> tier. A missing tier means Pro (legacy / manually issued keys).
  function licenseTier(payload) {
    if (payload && (payload.tier === 'basic' || payload.tier === 'pro')) return payload.tier;
    return payload && payload.plan === 'basic' ? 'basic' : 'pro';
  }

  // "25", "300" or "Unlimited"
  function revealsText(tier) {
    const n = limit(tier, 'reveals');
    return Number.isFinite(n) ? String(n) : 'Unlimited';
  }

  // Masks for leads that are not revealed: r***@ptrglobal.com and +1 ***-***-**12
  function maskEmail(email) {
    const s = String(email || '');
    const at = s.lastIndexOf('@');
    if (at < 1) return '***';
    return s[0] + '***' + s.slice(at);
  }
  function maskPhone(phone) {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    if (digits.length < 4) return phone ? '***' : '';
    const cc = digits.length > 10 ? '+' + digits.slice(0, digits.length - 10) + ' ' : '';
    return cc + '***-***-**' + digits.slice(-2);
  }

  // Bullet lines for pricing / comparison UIs, generated from the table above.
  function tierFeatureList(tier) {
    const t = tierOf(tier);
    const T = TIERS[t];
    const out = [
      `${revealsText(t) === 'Unlimited' ? 'Unlimited contacts (fair use)' : revealsText(t) + ' contacts a month'}`,
      `${T.consultants >= MAX_CONSULTANTS ? 'Up to ' + MAX_CONSULTANTS : T.consultants} bench consultants with auto-matching`,
      `${T.templates} pitch email template${T.templates === 1 ? '' : 's'}`
    ];
    out.push(Number.isFinite(T.quickNotes) ? `${T.quickNotes} quick notes` : 'Unlimited quick notes');
    if (T.features.csvExport) out.push('CSV, Excel and JSON export');
    if (T.features.followUps) out.push('Follow-up dates with a due count on the toolbar icon');
    if (T.features.cleanupActions) out.push('Fix my data: merge duplicate recruiters, clear bounced emails');
    if (T.features.resumeVersions) out.push('Résumé version history');
    if (T.features.csvImport) out.push('Excel and CSV import (free on every plan)');
    out.push('Full backup and restore (free on every plan)');
    if (T.features.matcher) out.push('Tech matcher in the dashboard');
    return out;
  }

  // ── Phone labels ──────────────────────────────────────────────────────────
  const PHONE_TYPES = ['unknown', 'mobile', 'office'];
  const PHONE_TYPE_LABELS = { unknown: 'Unknown', mobile: 'Mobile', office: 'Office' };

  function normalizePhoneType(t) { return PHONE_TYPES.includes(t) ? t : 'unknown'; }

  // Extension written straight after a phone number: "555-123-4567 x123", "... ext 112", "Ext: 112".
  // `phone` must be the exact number string as it appears in `text`. Returns digits or ''.
  function phoneExtAfter(text, phone) {
    const t = String(text || '');
    const p = String(phone || '');
    const i = p ? t.indexOf(p) : -1;
    if (i === -1) return '';
    const m = t.slice(i + p.length, i + p.length + 24).match(/^\s*[,;]?\s*(?:ext(?:ension)?\.?|x)\s*[:.#-]?\s*(\d{1,6})(?!\d)/i);
    return m ? m[1] : '';
  }

  // "555-123-4567 x12" typed into one field -> { phone: '555-123-4567', ext: '12' }
  function splitPhoneExt(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(.*?\d)\s*[,;]?\s*(?:ext(?:ension)?\.?|x)\s*[:.#-]?\s*(\d{1,6})\s*$/i);
    return m ? { phone: m[1].trim(), ext: m[2] } : { phone: s, ext: '' };
  }

  // Short label shown next to a phone number: "Office x112", "Mobile", or '' when unknown.
  function phoneLabel(lead) {
    const l = lead || {};
    const type = normalizePhoneType(l.phoneType);
    const ext = String(l.phoneExt || '').replace(/\D/g, '');
    const base = type === 'unknown' ? (ext ? 'Office' : '') : PHONE_TYPE_LABELS[type];
    return ext ? `${base} x${ext}` : base;
  }

  // https://wa.me/<digits>. US 10-digit numbers get a leading 1. '' when the number is unusable.
  function whatsappUrl(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.length === 10) d = '1' + d;
    return d.length >= 11 && d.length <= 15 ? `https://wa.me/${d}` : '';
  }

  // ── Time zones (IST <-> US) ───────────────────────────────────────────────
  // Pure functions on IANA zones via Intl, so daylight saving is automatic. Every function that
  // depends on "now" takes an explicit Date so it can be tested deterministically.
  const TZ = (function () {
    const ZONES = {
      IST: 'Asia/Kolkata', ET: 'America/New_York', CT: 'America/Chicago',
      MT: 'America/Denver', PT: 'America/Los_Angeles'
    };
    const ORDER = ['IST', 'ET', 'CT', 'MT', 'PT'];
    const ALIAS = {
      est: 'ET', edt: 'ET', et: 'ET', eastern: 'ET',
      cst: 'CT', cdt: 'CT', ct: 'CT', central: 'CT',
      mst: 'MT', mdt: 'MT', mt: 'MT', mountain: 'MT',
      pst: 'PT', pdt: 'PT', pt: 'PT', pacific: 'PT'
    };

    const partsFmt = {};
    function partsOf(ms, zone) {
      const f = partsFmt[zone] || (partsFmt[zone] = new Intl.DateTimeFormat('en-US', {
        timeZone: ZONES[zone], hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      }));
      const o = {};
      for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
      if (o.hour === 24) o.hour = 0;
      return o;
    }

    // Zone offset from UTC in minutes at instant `ms`.
    function offsetMinutes(zone, ms) {
      const p = partsOf(ms, zone);
      const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
    }

    // Wall-clock time in `zone` -> UTC ms (re-checks the offset so the DST switch day is right).
    function wallToUtc(y, mo, d, h, mi, zone) {
      const guess = Date.UTC(y, mo - 1, d, h, mi);
      const first = guess - offsetMinutes(zone, guess) * 60000;
      return guess - offsetMinutes(zone, first) * 60000;
    }

    const abbrFmt = {};
    function abbr(zone, date) {
      if (zone === 'IST') return 'IST';
      const f = abbrFmt[zone] || (abbrFmt[zone] = new Intl.DateTimeFormat('en-US', { timeZone: ZONES[zone], timeZoneName: 'short' }));
      const part = f.formatToParts(date).find(p => p.type === 'timeZoneName');
      return part ? part.value : zone;
    }

    // "10 AM", "8:30 PM" (minutes only when non-zero)
    function fmt12(h, m) {
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}${m ? ':' + pad2(m) : ''} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    // Clock display always shows minutes: "8:05 PM"
    function fmtClock(h, m) {
      return `${h % 12 === 0 ? 12 : h % 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
    }

    // [{ key, abbr, time, weekday }] for the clock strip.
    function clocks(date) {
      const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
      return ORDER.map(key => {
        const p = partsOf(date.getTime(), key);
        return {
          key, abbr: abbr(key, date), time: fmtClock(p.hour, p.minute),
          weekday: wd.format(new Date(Date.UTC(p.year, p.month - 1, p.day)))
        };
      });
    }

    // The wall time h:m in `from`, on the calendar day it currently is in `from` (at `date`),
    // shown in zone `to`. dayShift = calendar days between the two results (0, 1 or -1).
    function convert(h, m, from, to, date) {
      const src = partsOf(date.getTime(), from);
      const utc = wallToUtc(src.year, src.month, src.day, h, m, from);
      const t = partsOf(utc, to);
      const dayShift = Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(src.year, src.month - 1, src.day)) / 86400000);
      return { hour: t.hour, minute: t.minute, dayShift, label: fmt12(t.hour, t.minute), abbr: abbr(to, new Date(utc)) };
    }

    // Converter for the popup: time in `from` -> every other zone.
    function convertAll(h, m, from, date) {
      return ORDER.filter(k => k !== from).map(to => {
        const r = convert(h, m, from, to, date);
        return { key: to, abbr: r.abbr, time: fmtClock(r.hour, r.minute), dayShift: r.dayShift };
      });
    }

    // ── Finding times in post text ──
    // A time only counts when a US zone follows it: "10 AM EST", "10:30am CST", "9 - 11 AM PT",
    // "14:00 EST", "10 am (CST)", "11AM Eastern". "5+ years", "10 AM" alone and phone numbers never match.
    const ZONE_WORDS = 'EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|Eastern|Central|Mountain|Pacific';
    const RE_SRC =
      '(?<![\\w:.$+\\-])(\\d{1,2})(?::(\\d{2}))?\\s*(?:([ap])\\.?m(?![a-z])\\.?)?' +
      '(?:\\s*(?:-|\\u2013|\\u2014|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(?:([ap])\\.?m(?![a-z])\\.?)?)?' +
      '\\s*\\(?\\s*(' + ZONE_WORDS + ')(?![a-z])';

    // One endpoint: 12-hour needs a meridiem; without one only "HH:MM" (24-hour) counts.
    function endpoint(hStr, mStr, mer) {
      const h = Number(hStr);
      const m = mStr === undefined ? 0 : Number(mStr);
      if (m > 59) return null;
      if (mer) return h >= 1 && h <= 12 ? { h: (h % 12) + (mer === 'p' ? 12 : 0), m } : null;
      return mStr !== undefined && h <= 23 ? { h, m } : null;
    }

    // -> [{ raw, index, zone: 'ET'|'CT'|'MT'|'PT', zoneText, start: {h,m}, end: {h,m}|null }]
    function parseTimes(text) {
      const out = [];
      const s = String(text || '');
      if (!/\d/.test(s)) return out;
      const re = new RegExp(RE_SRC, 'gi');
      let m;
      while ((m = re.exec(s)) && out.length < 4) {
        const [raw, h1, m1, p1raw, h2, m2, p2raw, z] = m;
        const p2 = p2raw && p2raw.toLowerCase();
        let mer1 = p1raw && p1raw.toLowerCase();
        let start;
        let end = null;
        if (h2 !== undefined) {
          end = endpoint(h2, m2, p2);
          if (!end) continue;
          if (!mer1 && p2) {
            // "9 - 11 AM EST": the first time shares the second's AM/PM, unless that runs backwards.
            start = endpoint(h1, m1, p2);
            if (start && start.h * 60 + start.m > end.h * 60 + end.m) start = endpoint(h1, m1, p2 === 'p' ? 'a' : 'p');
          } else {
            start = endpoint(h1, m1, mer1);
          }
        } else {
          start = endpoint(h1, m1, mer1);
        }
        if (!start) continue;
        out.push({ raw: raw.trim(), index: m.index, zone: ALIAS[z.toLowerCase()], zoneText: z.length <= 3 ? z.toUpperCase() : z, start, end });
      }
      return out;
    }

    function shiftNote(n) { return n > 0 ? ' (next day)' : n < 0 ? ' (previous day)' : ''; }

    // "10 AM EST -> 8:30 PM IST" strings for one parsed match, converted for the day it is now in that zone.
    function describe(match, date) {
      const a = convert(match.start.h, match.start.m, match.zone, 'IST', date);
      let src = fmt12(match.start.h, match.start.m);
      let dst = a.label;
      let note = shiftNote(a.dayShift);
      if (match.end) {
        const b = convert(match.end.h, match.end.m, match.zone, 'IST', date);
        src += ' - ' + fmt12(match.end.h, match.end.m);
        // Mark the start too only when the two ends land on different days.
        dst += (a.dayShift !== b.dayShift ? shiftNote(a.dayShift) : '') + ' - ' + b.label;
        note = shiftNote(b.dayShift);
      }
      return {
        from: `${src} ${match.zoneText}`,
        to: `${dst} IST${note}`,
        text: `${src} ${match.zoneText} → ${dst} IST${note}`
      };
    }

    // Convenience: every conversion found in `text` -> [{ from, to, text }]
    function convertText(text, date) {
      return parseTimes(text).map(m => describe(m, date));
    }

    return { ZONES, ORDER, offsetMinutes, abbr, clocks, convert, convertAll, parseTimes, describe, convertText, fmt12 };
  })();

  const VISA_TYPES = ['USC', 'GC', 'GC-EAD', 'H1B', 'H4-EAD', 'L2-EAD', 'OPT', 'CPT', 'STEM OPT', 'TN', 'Other'];

  // ── Dates (local time, YYYY-MM-DD) ───────────────────────────────────────
  function pad2(n) { return String(n).padStart(2, '0'); }

  function todayStr(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return todayStr(new Date(y, m - 1, d + days));
  }

  function daysUntil(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  // ── Person names ──────────────────────────────────────────────────────────
  // ── Display titles ────────────────────────────────────────────────────────────────────────────────────
  // Recruiters type "SENIOR DATA ENGINEER". For DISPLAY only (never stored): a title that is mostly upper-case becomes Title Case, keeping
  // known acronyms and tech names as written (AWS, SQL, .NET, DevOps, PL/SQL ...) and "Sr." / "Jr.". Mixed-case titles are left untouched.
  const TITLE_KEEP = ['AI', 'ML', 'AI/ML', 'SRE', 'AWS', 'GCP', 'SQL', 'ETL', 'ELT', 'UI', 'UX', 'QA', 'SAP', 'BI', 'API', 'IT', '.NET', 'C#', 'C++', 'iOS',
    'DevOps', 'J2EE', 'SDET', 'PL/SQL', 'CI/CD', 'ERP', 'CRM', 'HR', 'PM', 'BA', 'GenAI', 'LLM', 'NLP', 'MLOps', 'DBA', 'OCI', 'SFDC', 'SSIS', 'SSRS', 'ADF',
    // Common in US IT staffing titles
    'ABAP', 'HANA', 'BW', 'FICO', 'MDM', 'IAM', 'SOC', 'SIEM', 'SSO', 'EDI', 'HL7', 'FHIR', 'EHR', 'QE', 'TPM', 'BSA', 'PMO', 'RPA',
    'SQA', 'UAT', 'ITSM', 'SCCM', 'MDX', 'BIM', 'GIS', 'SDE', 'SWE', 'VP', 'CTO', 'CIO', 'IoT', 'AR/VR', 'SaaS', 'PaaS', 'IaaS', 'B2B',
    'MS', 'SQL/BI', 'ETL/ELT', 'HCM', 'SCM', 'OIC', 'OTM', 'EBS', 'JD', 'SAFe', 'GxP', 'CSV', 'NOC', 'WMS', 'POS', 'ADO', 'AEM', 'MuleSoft',
    'ServiceNow', 'Salesforce', 'PowerBI', 'Power BI', 'iPaaS', 'TIBCO', 'COBOL', 'JCL', 'DB2', 'CICS', 'IMS', 'VMware', 'Linux', 'UNIX',
    'Sr.', 'Jr.', 'Sr', 'Jr'];
  const TITLE_KEEP_MAP = Object.fromEntries(TITLE_KEEP.map(k => [k.toLowerCase(), k]));
  const TITLE_SMALL = new Set(['and', 'or', 'of', 'for', 'with', 'in', 'the', 'to', 'a', 'an', 'at', 'on']);
  function titleWord(core, first) {
    const lower = core.toLowerCase();
    if (TITLE_KEEP_MAP[lower]) return TITLE_KEEP_MAP[lower];
    if (/\d/.test(core) && /^[A-Z0-9#+.]+$/.test(core)) return core;   // W2, C2C, H1B, J2EE-like codes
    if (!first && TITLE_SMALL.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  function displayTitle(raw) {
    const s = raw === null || raw === undefined ? '' : String(raw);
    const letters = s.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3) return s;
    const upper = letters.replace(/[^A-Z]/g, '').length;
    if (upper / letters.length < 0.7) return s;
    let first = true;
    return s.replace(/[^\s]+/g, (token) => {
      const m = /^([^A-Za-z0-9.#+]*)(.*?)([^A-Za-z0-9#+]*)$/.exec(token);
      const lead = m[1], core = m[2], tail = m[3];
      if (!core) return token;
      let out;
      if (TITLE_KEEP_MAP[core.toLowerCase()]) out = TITLE_KEEP_MAP[core.toLowerCase()];
      else if (/[\/\-]/.test(core)) out = core.split(/([\/\-])/).map(p => (/^[\/\-]$/.test(p) || !p ? p : titleWord(p, first))).join('');
      else out = titleWord(core, first);
      first = false;
      return lead + out + tail;
    });
  }

  // LinkedIn appends the connection degree, pronouns and badges to names ("Bhuvana Ramarao 2nd",
  // "Priya S (She/Her)", "Ravi K • 3rd+ • Following"). Returns just the person's name.
  // Display only: the scanner stores 'Recruiter Lead' / 'Staffing Partner' when a post shows no name or company. Those words must
  // never read as a real person or company, so screens show these plain phrases instead. The stored value is not changed.
  // `fallback` (for example the email) is used only when the name is truly empty; the stored placeholder always reads "Name not shown".
  function shownRecruiterName(raw, fallback) {
    const n = cleanPersonName(raw);
    if (n === 'Recruiter Lead') return 'Name not shown';
    return n || fallback || 'Name not shown';
  }
  function shownCompanyName(raw) {
    const c = String(raw === null || raw === undefined ? '' : raw).trim();
    return !c || c === '\u2014' || c === 'Staffing Partner' ? 'Company not shown' : c;
  }
  function cleanPersonName(raw) {
    let n = String(raw === null || raw === undefined ? '' : raw).split('\n')[0];
    n = n.replace(/\s*\((?:he|she|they|him|her|them|xe|ze)\b[^)]*\)/gi, '');
    n = n.replace(/\s*(?:View profile.*|Premium|Influencer)$/i, '');
    for (let i = 0; i < 4; i++) {
      const before = n;
      n = n
        .replace(/\s*[•·|]\s*(?:following|follow|you|premium|verified|influencer)\s*$/i, '')
        .replace(/(?:\s*[•·|,]\s*|\s+)(?:1st|2nd|3rd)\+?(?:\s+degree(?:\s+connection)?)?\s*$/i, '');
      if (n === before) break;
    }
    return n.replace(/^[•·\-\s]+/, '').replace(/\s+/g, ' ').trim();
  }

  // ── Emails ────────────────────────────────────────────────────────────────
  // Lowercased address, or '' when it is not a usable email (same rule the service worker applies).
  function normalizeEmail(value) {
    const e = String(value || '').trim().replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : '';
  }

  // ── Duplicate leads ───────────────────────────────────────────────────────
  // LinkedIn renders the same post in several places (feed, profile Activity carousel, featured) and the
  // text it shows can be clipped or run together, so one address can be found as "john@x.co",
  // "john@x.com" and "john@x.comlocation", or with a phone number glued on the front.
  const KNOWN_TLDS = new Set(['com', 'net', 'org', 'io', 'co', 'us', 'in', 'ai', 'info', 'biz', 'edu', 'gov',
    'dev', 'tech', 'app', 'cloud', 'solutions', 'group', 'llc', 'inc']);

  function normText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Stable identity of the post a lead came from: its URN when known, else requirement text on that page.
  function leadPostKey(lead) {
    const l = lead || {};
    if (l.postUrn) return 'u:' + l.postUrn;
    const req = normText(l.requirement);
    return req ? 'r:' + req + '|' + String(l.sourceUrl || '') : '';
  }

  // Given two different addresses from the same post, returns the one that is a damaged copy of the other
  // (the one to drop), or '' when they look like two real addresses.
  function damagedEmailOf(a, b) {
    const ia = a.lastIndexOf('@'), ib = b.lastIndexOf('@');
    const la = a.slice(0, ia), da = a.slice(ia + 1);
    const lb = b.slice(0, ib), db = b.slice(ib + 1);
    if (da === db) {
      // Digits or punctuation glued on the front: "5551234567john@x.com"
      const [longer, shorter] = la.length > lb.length ? [la, lb] : [lb, la];
      if (longer !== shorter && longer.endsWith(shorter) && /^[\d\-+._()/=]+$/.test(longer.slice(0, longer.length - shorter.length))) {
        return la.length > lb.length ? a : b;
      }
      return '';
    }
    if (la !== lb) return '';
    // Clipped or run-together domain: "x.co" / "x.com" / "x.comlocation" (only letters differ)
    const [longer, shorter] = da.length > db.length ? [da, db] : [db, da];
    if (!longer.startsWith(shorter) || !/^[a-z]+$/.test(longer.slice(shorter.length))) return '';
    const known = (d) => KNOWN_TLDS.has(d.split('.').pop());
    const keep = known(longer) ? longer : shorter;
    return keep === da ? b : a;
  }

  // One lead per address and per damaged copy of it. First occurrence wins; order is kept.
  // ── Per-post lead identity (page scanner + save) ──────────────────────────
  // One lead per (address, post): the same recruiter posting three requirements gives three page leads.
  function textHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function pageLeadKey(email, postUrn, postText) {
    const e = String(email || '').trim().toLowerCase();
    if (postUrn) return e + '|u:' + postUrn;
    const t = normText(postText).slice(0, 200);
    return e + '|' + (t ? 't:' + textHash(t) : '');
  }

  // A page lead is "rich" once role, location and posted time are all known: nothing more to learn from re-reading it.
  function isRichLead(lead) {
    if (!lead) return false;
    return ['requirement', 'location', 'postedAt'].every(k => !cleanupIsEmpty(lead[k]));
  }

  // The same post seen again: keep what we had, fill only what was empty.
  function mergeRicherLead(oldLead, newLead) {
    const out = Object.assign({}, oldLead);
    for (const k of Object.keys(newLead || {})) {
      if (cleanupIsEmpty(out[k]) && !cleanupIsEmpty(newLead[k])) out[k] = newLead[k];
    }
    return out;
  }

  // Storage holds one record per address. When several requirements from one address arrive in a single save,
  // keep the newest (by posted time, later in the list on a tie) and, on equal time, the one with more filled fields.
  function collapseLeadsByEmail(leads) {
    const best = new Map();
    const order = [];
    const richness = (l) => ['requirement', 'location', 'notes', 'phone', 'recruiterName', 'companyName'].filter(k => !cleanupIsEmpty(l[k])).length;
    const when = (l) => { const t = Date.parse(l.postedAt || ''); return Number.isFinite(t) ? t : 0; };
    for (const lead of leads || []) {
      const e = normalizeEmail(lead && lead.email);
      if (!e) { order.push(lead); continue; }
      if (!best.has(e)) { best.set(e, lead); order.push(e); continue; }
      const cur = best.get(e);
      const a = when(lead), b = when(cur);
      if (a > b || (a === b && richness(lead) >= richness(cur))) best.set(e, lead);
    }
    return order.map(x => (typeof x === 'string' ? best.get(x) : x));
  }

  // A recruiter's second requirement (a different post) is kept: the identity is address + post.
  function dedupeLeads(leads) {
    const byKey = new Map();   // 'email|postKey' -> { e, lead }
    for (const lead of leads || []) {
      const e = normalizeEmail(lead && lead.email);
      if (!e) continue;
      const k = e + '|' + leadPostKey(lead);
      if (!byKey.has(k)) byKey.set(k, { e, lead });
    }
    const groups = new Map();
    for (const { e, lead } of byKey.values()) {
      const key = leadPostKey(lead);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(e);
    }
    const drop = new Set();   // 'email|postKey'
    for (const [key, set] of groups) {
      const emails = [...set];
      for (let i = 0; i < emails.length; i++) {
        for (let j = i + 1; j < emails.length; j++) {
          if (drop.has(emails[i] + '|' + key) || drop.has(emails[j] + '|' + key)) continue;
          const bad = damagedEmailOf(emails[i], emails[j]);
          if (bad) drop.add(bad + '|' + key);
        }
      }
    }
    return [...byKey].filter(([k]) => !drop.has(k)).map(([, v]) => v.lead);
  }

  // ── Database cleanup (v1.5): duplicates, missing data ─────────────────────
  // Pure helpers behind the dashboard's Cleanup view. Nothing here touches storage; the service worker
  // applies merges (MERGE_LEADS) and the dashboard only displays results. Detection is bucket/lookup based
  // (union-find over hash maps), so 5,000 leads take a few milliseconds, never an all-pairs scan.
  const CLEANUP_PLACEHOLDERS = new Set(['', '—', 'Staffing Partner']);
  const CLEANUP_MAX_SHARED_PHONE = 40; // a number on more leads than this is a switchboard, not a person

  function cleanupIsEmpty(v) {
    if (v === undefined || v === null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'string') return CLEANUP_PLACEHOLDERS.has(v.trim());
    return false;
  }

  // Normalised person name ("Priya  Shah 2nd" -> "priya shah"), or '' when it is under two words
  // (a first name alone is too weak to call two leads the same person).
  function cleanupNameKey(lead) {
    const n = normText(cleanPersonName(lead && lead.recruiterName));
    return n.split(' ').filter(Boolean).length >= 2 ? n : '';
  }

  // Last 10 digits of a phone number, or '' when it has fewer than 10 digits.
  function cleanupPhoneKey(phone) {
    const d = String(phone || '').replace(/\D/g, '');
    return d.length >= 10 ? d.slice(-10) : '';
  }

  function cleanupProfileKey(lead) {
    const u = canonicalProfileUrl(lead && lead.linkedinProfile);
    return u ? u.toLowerCase() : '';
  }

  // Two names are compatible for the shared-phone rule unless both are known and clearly differ.
  function cleanupNamesCompatible(a, b) {
    if (!a || !b) return true;
    if (a === b) return true;
    return a.split(' ').pop() === b.split(' ').pop();
  }

  // Stable identity of a group of leads: their lower-case emails, sorted. A dismissed group stays hidden
  // until its membership changes.
  function duplicateSignature(emails) {
    return (emails || []).map(e => String(e || '').toLowerCase()).sort().join('|');
  }

  // Groups of leads that are probably one person. Returns
  //   [{ signature, emails: [...], leads: [...], reasons: [string] }]
  // largest group first. `dismissed` is an array/Set of signatures the user marked "Not duplicates".
  // Rules (any one links two leads): same name + same company; one email a damaged copy of another;
  // same LinkedIn profile; same phone (10+ digits) with names that do not clearly differ.
  function findDuplicateGroups(leads, dismissed) {
    const list = [], emails = [];
    for (const l of Array.isArray(leads) ? leads : []) {
      const e = l ? normalizeEmail(l.email) : '';
      if (e) { list.push(l); emails.push(e); }
    }
    const skip = dismissed instanceof Set ? dismissed : new Set(dismissed || []);
    const n = list.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const edges = []; // [i, j, reason]
    const link = (i, j, reason) => {
      if (i === j) return;
      edges.push([i, j, reason]);
      const a = find(i), b = find(j);
      if (a !== b) parent[b] = a;
    };
    const bucket = (map, key, i) => { const b = map.get(key); if (b) b.push(i); else map.set(key, [i]); };

    const byEmail = new Map();
    emails.forEach((e, i) => { if (!byEmail.has(e)) byEmail.set(e, i); });

    const byNameCo = new Map(), byProfile = new Map(), byPhone = new Map();
    for (let i = 0; i < n; i++) {
      const l = list[i];
      const nk = cleanupNameKey(l);
      if (nk && l.companyId) bucket(byNameCo, nk + '|' + l.companyId, i);
      const pk = cleanupProfileKey(l);
      if (pk) bucket(byProfile, pk, i);
      const ph = cleanupPhoneKey(l.phone);
      if (ph) bucket(byPhone, ph, i);
    }
    // Rule 1: same name + same company. Rule 3: same LinkedIn profile.
    for (const ids of byNameCo.values()) for (let k = 1; k < ids.length; k++) link(ids[0], ids[k], 'Same name at the same company');
    for (const ids of byProfile.values()) for (let k = 1; k < ids.length; k++) link(ids[0], ids[k], 'Same LinkedIn profile');
    // Rule 4: same phone, unless both leads carry clearly different names.
    for (const ids of byPhone.values()) {
      if (ids.length > CLEANUP_MAX_SHARED_PHONE) continue;
      for (let k = 1; k < ids.length; k++) {
        const nk = cleanupNameKey(list[ids[k]]);
        for (let m = 0; m < k; m++) {
          if (cleanupNamesCompatible(nk, cleanupNameKey(list[ids[m]]))) { link(ids[m], ids[k], 'Same phone number'); break; }
        }
      }
    }
    // Rule 2: damaged email copies, found by looking up the clean address a damaged one could come from.
    for (let i = 0; i < n; i++) {
      const e = emails[i];
      const at = e.lastIndexOf('@');
      const local = e.slice(0, at), domain = e.slice(at + 1);
      const candidates = [];
      // glued-on prefix: "5551234567john@x.com" -> "john@x.com"
      const glued = /^[\d\-+._()/=]+/.exec(local);
      if (glued) for (let k = 1; k <= glued[0].length && k < local.length; k++) candidates.push(local.slice(k) + '@' + domain);
      // run-together or clipped domain: "john@x.comlocation" -> "john@x.com"
      for (let k = 3; k < domain.length; k++) candidates.push(local + '@' + domain.slice(0, k));
      // The reverse direction is found when the longer (damaged) address is the one being visited.
      for (const c of candidates) {
        const j = byEmail.get(c);
        if (j !== undefined && j !== i && damagedEmailOf(e, c)) link(i, j, 'One email looks like a damaged copy of the other');
      }
    }

    const comps = new Map();
    for (let i = 0; i < n; i++) bucket(comps, find(i), i);
    const reasonsOf = new Map();
    for (const [i, , why] of edges) {
      const r = find(i);
      const s = reasonsOf.get(r);
      if (s) s.add(why); else reasonsOf.set(r, new Set([why]));
    }
    const out = [];
    for (const [r, ids] of comps) {
      if (ids.length < 2) continue;
      const groupEmails = ids.map(i => emails[i]);
      const signature = duplicateSignature(groupEmails);
      if (skip.has(signature)) continue;
      out.push({ signature, emails: groupEmails, leads: ids.map(i => list[i]), reasons: [...(reasonsOf.get(r) || [])] });
    }
    out.sort((a, b) => b.emails.length - a.emails.length || (a.signature < b.signature ? -1 : 1));
    return out;
  }

  // Merges duplicate records into `keep` and returns the single resulting lead (inputs are not changed).
  //   - the kept record's non-empty fields win; empty ones are filled from `others`, in order
  //   - phone type and extension travel with the phone number they describe
  //   - notes are joined with a separator (a note already contained is not repeated)
  //   - activity timelines are combined, de-duplicated, sorted oldest to newest, last 50 kept
  //   - savedAt is the earliest; lastContactDate the latest; status the most advanced in STATUSES
  //   - followUpDate: the kept record's, else the soonest of the others
  // `now` (ISO string) stamps the audit entry added to the activity timeline.
  const CLEANUP_NOTES_SEPARATOR = '\n---\n';
  const CLEANUP_SPECIAL_FIELDS = new Set(['email', 'activity', 'notes', 'status', 'savedAt', 'bounced', 'sno',
    'companyId', 'phone', 'phoneType', 'phoneExt', 'followUpDate', 'lastContactDate']);

  // Undo of the last duplicate merge. snapshot = { keep (record before the merge), merged (record the merge
  // wrote), others (deleted records) }. Re-adds deleted records whose email is free again; restores the kept
  // record only if nobody changed it since the merge (otherwise the user's later edits win and it stays as is).
  // Returns { allLeads, restored, keptRestored }.
  function undoLeadMerge(allLeads, snapshot) {
    const leads = Array.isArray(allLeads) ? allLeads.slice() : [];
    if (!snapshot || !snapshot.keep || !Array.isArray(snapshot.others)) return { allLeads: leads, restored: 0, keptRestored: false };
    const key = (l) => String((l && l.email) || '').toLowerCase();
    let keptRestored = false;
    const ki = leads.findIndex(l => key(l) === key(snapshot.keep));
    if (ki !== -1 && JSON.stringify(leads[ki]) === JSON.stringify(snapshot.merged)) {
      leads[ki] = snapshot.keep;
      keptRestored = true;
    }
    const present = new Set(leads.map(key));
    let restored = 0;
    for (const o of snapshot.others) {
      if (!o || present.has(key(o))) continue;
      leads.push(o);
      present.add(key(o));
      restored++;
    }
    return { allLeads: leads, restored, keptRestored };
  }

  function mergeLeadRecords(keep, others, now) {
    const rest = (others || []).filter(Boolean);
    const all = [keep, ...rest];
    const out = { ...keep };

    for (const o of rest) {
      for (const k of Object.keys(o)) {
        if (CLEANUP_SPECIAL_FIELDS.has(k)) continue;
        if (cleanupIsEmpty(out[k]) && !cleanupIsEmpty(o[k])) out[k] = o[k];
      }
    }
    if (cleanupIsEmpty(out.phone)) {
      const src = rest.find(o => !cleanupIsEmpty(o.phone));
      if (src) {
        out.phone = src.phone;
        if (src.phoneType !== undefined) out.phoneType = src.phoneType;
        if (src.phoneExt !== undefined) out.phoneExt = src.phoneExt;
      }
    }
    if (out.companyId === undefined || out.companyId === null) {
      const src = rest.find(o => o.companyId);
      if (src) out.companyId = src.companyId;
    }

    const notes = [];
    for (const l of all) {
      const t = String(l.notes || '').trim();
      if (t && !notes.some(x => x.includes(t))) notes.push(t);
    }
    out.notes = notes.join(CLEANUP_NOTES_SEPARATOR);

    const seen = new Set();
    const activity = [];
    for (const l of all) {
      for (const a of Array.isArray(l.activity) ? l.activity : []) {
        const sig = (a.at || '') + '|' + (a.type || '') + '|' + (a.text || '');
        if (!seen.has(sig)) { seen.add(sig); activity.push(a); }
      }
    }
    if (rest.length) {
      activity.push({
        at: now || new Date().toISOString(), type: 'note',
        text: `Merged ${rest.length} duplicate record${rest.length === 1 ? '' : 's'} (${rest.map(o => o.email).join(', ')})`.slice(0, 200)
      });
    }
    const time = (a) => { const t = Date.parse(a.at); return isNaN(t) ? 0 : t; };
    activity.sort((a, b) => time(a) - time(b)); // stable: equal times keep their input order
    out.activity = activity.slice(-50);

    const saved = all.map(l => l.savedAt).filter(s => typeof s === 'string' && !isNaN(Date.parse(s)));
    if (saved.length) out.savedAt = saved.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));

    out.status = STATUSES[Math.max(...all.map(l => STATUSES.indexOf(normalizeStatus(l.status))))];

    const contacts = all.map(l => l.lastContactDate).filter(Boolean).sort();
    if (contacts.length) out.lastContactDate = contacts[contacts.length - 1];
    if (!out.followUpDate) {
      const fu = rest.map(o => o.followUpDate).filter(Boolean).sort()[0];
      if (fu) out.followUpDate = fu;
    }
    return out;
  }

  // The "missing data" filters; `key` is also what the Leads view filters by.
  const MISSING_FIELDS = [
    { key: 'noPhone', label: 'No phone', test: l => cleanupIsEmpty(l.phone) },
    { key: 'noCompany', label: 'No company', test: l => !l.companyId },
    { key: 'noDesignation', label: 'No designation', test: l => cleanupIsEmpty(l.designation) },
    { key: 'noLinkedin', label: 'No LinkedIn profile', test: l => !safeHttpUrl(l.linkedinProfile) },
    { key: 'noLocation', label: 'No location', test: l => cleanupIsEmpty(l.location) }
  ];
  function missingDataCounts(leads) {
    const counts = {};
    for (const f of MISSING_FIELDS) counts[f.key] = 0;
    for (const l of Array.isArray(leads) ? leads : []) {
      if (l) for (const f of MISSING_FIELDS) if (f.test(l)) counts[f.key]++;
    }
    return counts;
  }
  function leadMissing(lead, key) {
    const f = MISSING_FIELDS.find(x => x.key === key);
    return Boolean(f && lead && f.test(lead));
  }

  // ── LinkedIn profile parsing (pure text helpers; the DOM reading lives in content.js) ──
  function cleanLines(lines) {
    const out = [];
    for (const raw of lines || []) {
      const l = String(raw === null || raw === undefined ? '' : raw).replace(/\s+/g, ' ').trim();
      if (l && l !== out[out.length - 1]) out.push(l);
    }
    return out;
  }

  function profileSlugFromPath(pathname) {
    const m = String(pathname || '').match(/^\/in\/([^/?#]+)/i);
    if (!m) return '';
    let s = m[1];
    try { s = decodeURIComponent(s); } catch (_) {}
    s = s.toLowerCase();
    return s === 'me' ? '' : s;
  }

  // https://www.linkedin.com/in/<slug>/ for any linkedin.com profile URL (sub-pages, overlays, tracking params), else ''.
  function canonicalProfileUrl(href) {
    try {
      const u = new URL(href, 'https://www.linkedin.com');
      if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return '';
      const m = u.pathname.match(/^\/in\/([^/?#]+)/i);
      return m ? `https://www.linkedin.com/in/${m[1]}/` : '';
    } catch (_) {
      return '';
    }
  }

  // "1 yr 7 mos" / "8 months" / "2 years" -> months, or null when there is no duration in the text.
  function parseDurationMonths(text) {
    const s = String(text || '');
    const y = s.match(/(\d+)\s*(?:yrs?|years?)\b/i);
    const m = s.match(/(\d+)\s*(?:mos?|months?)\b/i);
    if (!y && !m) return /less than a year/i.test(s) ? 0 : null;
    return (y ? Number(y[1]) * 12 : 0) + (m ? Number(m[1]) : 0);
  }

  // 19 -> "1 yr 7 mos" (LinkedIn's own wording); 0 or invalid -> ''.
  function formatTenure(months) {
    if (!Number.isFinite(months) || months <= 0) return '';
    const y = Math.floor(months / 12);
    const m = months % 12;
    const parts = [];
    if (y) parts.push(`${y} ${y === 1 ? 'yr' : 'yrs'}`);
    if (m) parts.push(`${m} ${m === 1 ? 'mo' : 'mos'}`);
    return parts.join(' ');
  }

  // "2nd", "· 3rd+", "Priya 1st degree connection" -> '1st' | '2nd' | '3rd'; '' when there is no degree marker.
  function parseConnectionDegree(text) {
    const m = String(text || '').match(/(?:^|[\s·•(])(1st|2nd|3rd)\+?(?=$|[\s·•)])/i);
    return m ? m[1].toLowerCase() : '';
  }
  function degreeToken(line) {
    const m = String(line || '').match(/^[·•\s]*(1st|2nd|3rd)\+?(?:\s+degree(?:\s+connection)?)?[·•\s]*$/i);
    return m ? m[1].toLowerCase() : '';
  }

  // Name from the tab title: "(3) Priya Sharma - Sr Recruiter - Acme | LinkedIn" -> "Priya Sharma".
  function nameFromPageTitle(title) {
    const t = String(title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|·]\s*LinkedIn\s*$/i, '');
    const n = cleanPersonName(t.split(/\s+[-–—]\s+/)[0]);
    return n.length <= 80 ? n : '';
  }

  // "Current company: Refocus LLC. Click to skip to experience card" -> "Refocus LLC"
  function parseCurrentCompanyLabel(label) {
    if (!/^current company:/i.test(String(label || ''))) return '';
    return String(label).replace(/^current company:\s*/i, '').replace(/\.?\s*click to.*$/i, '').trim();
  }

  // Top-card entries [{ text, href, label }] -> current company name, or ''.
  // Order: aria-label "Current company: X. ..." first, then the first /company/ (or /showcase/) link with text.
  // /school/ entries and generic links are never taken as the company.
  function pickCurrentCompany(items) {
    const list = Array.isArray(items) ? items : [];
    for (const it of list) {
      const c = parseCurrentCompanyLabel(it && it.label);
      if (c) return c;
    }
    for (const it of list) {
      const href = String((it && it.href) || '');
      if (!/\/(?:company|showcase)\//i.test(href) || /\/school\//i.test(href)) continue;
      const line = cleanLines(String((it && it.text) || '').split('\n'))[0] || '';
      if (line && line.length <= 100) return line;
    }
    return '';
  }

  // "Current company: X" for the tenure guard: does the experience entry's company match the top-card company?
  function sameCompany(a, b) {
    const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const x = n(a), y = n(b);
    return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
  }

  const TOPCARD_NOISE =/^(?:[·•]|\(?(?:he|she|they)\/[a-z/]+\)?|(?:[·•]\s*)?contact info|message|connect|follow|following|pending|more|save in sales navigator|open to|premium|verified|send profile in a message|resources|book an appointment|visit my website|edit profile|view .* profile|\d[\d,+]*\+?\s+(?:connections?|followers?)|.*\bmutual connections?\b.*)$/i;
  const LOOKS_LIKE_LOCATION = /,|\b(?:area|metropolitan|region|united states|india|canada|united kingdom)\b/i;

  // Lines of the profile top card (innerText split) -> { degree, headline, location }.
  function parseTopCard(lines, name) {
    const L = cleanLines(lines);
    const want = normText(name);
    let start = want ? L.findIndex(l => normText(l).startsWith(want)) : -1;
    let degree = '';
    // The name is often repeated (visually-hidden copy, "Name 1st"): consume every leading name line.
    while (start !== -1 && start < L.length && normText(L[start]).startsWith(want)) {
      degree = degree || parseConnectionDegree(L[start].slice(String(name).length));
      start++;
    }
    const rest = [];
    for (const line of (start === -1 ? L : L.slice(start))) {
      const d = degreeToken(line);
      if (d) { if (!degree) degree = d; continue; }
      if (TOPCARD_NOISE.test(line)) continue;
      rest.push(line);
    }
    const headline = rest[0] || '';
    const location = rest.slice(1).find(l => l.length <= 80 && LOOKS_LIKE_LOCATION.test(l)) || '';
    return { degree, headline, location };
  }

  // Lines of the first Experience entry -> { title, company, current, months, tenure } or null.
  // Handles one role ("Title / Company · Full-time / Jan 2023 - Present · 1 yr 7 mos") and a company
  // with several roles ("Company / Full-time · 3 yrs / Title / ... dates"; the first role is the current one).
  const DATE_RANGE = /(?:\b[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:present|(?:\b[a-z]{3,9}\.?\s+)?(?:19|20)\d{2})/i;
  const EMPLOYMENT_TYPE = /^(?:full-?time|part-?time|contract|self-?employed|freelance|internship|apprenticeship|seasonal|permanent|temporary)$/i;

  function isDurationOnly(line) {
    if (parseDurationMonths(line) === null || DATE_RANGE.test(line)) return false;
    const rest = line.replace(/\d+\s*(?:yrs?|years?|mos?|months?)\b/gi, '').replace(/[·\s]/g, '');
    return rest === '' || EMPLOYMENT_TYPE.test(rest);
  }

  function parseExperienceLines(lines) {
    const L = cleanLines(lines);
    const d = L.findIndex(l => DATE_RANGE.test(l));
    if (d < 1) return null;
    const grouped = d >= 3 && isDurationOnly(L[1]);
    const title = grouped ? L[2] : (d >= 2 ? L[d - 2] : L[0]);
    const company = grouped ? L[0] : (d >= 2 ? L[d - 1].split(/\s+·\s+/)[0] : '');
    const parts = L[d].split('·');
    const months = parts.length > 1 ? parseDurationMonths(parts[parts.length - 1]) : null;
    return {
      title: title.trim(),
      company: company.trim(),
      current: /present/i.test(L[d]),
      months,
      tenure: months ? formatTenure(months) : ''
    };
  }

  // ── LinkedIn "Contact info" dialog (email / phone / website of a 1st-degree connection) ──
  // "(Mobile)" -> mobile, "(Work)" -> office, anything else -> unknown.
  function phoneTypeFromLabel(label) {
    const s = String(label || '').toLowerCase();
    if (/mobile|cell/.test(s)) return 'mobile';
    if (/work|office|business/.test(s)) return 'office';
    return 'unknown';
  }

  // "+1 469-555-0123 (Mobile)" / "469 555 0123 x12 (Work)" -> { value, ext, type } or null.
  function parsePhoneLine(line) {
    const m = String(line || '').trim().match(/^(.*?)\s*(?:\(([A-Za-z ]{2,20})\))?\s*$/);
    const { phone, ext } = splitPhoneExt(m ? m[1] : '');
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15 || !/^[+\d(][\d\s().+-]*$/.test(phone)) return null;
    return { value: phone, ext, type: phoneTypeFromLabel(m && m[2]) };
  }

  const CONTACT_HEADINGS = { 'your profile': 'profile', website: 'websites', websites: 'websites', phone: 'phones', phones: 'phones',
    email: 'emails', emails: 'emails', address: 'address', birthday: 'birthday', connected: 'connected', 'connected since': 'connected',
    twitter: 'twitter', im: 'im', x: 'twitter' };
  const PHONE_LABEL = '(?:mobile|cell|work|home|office|business|other)';
  const PHONE_LABEL_END = new RegExp('\\(' + PHONE_LABEL + '\\)\\s*$', 'i');
  const PHONE_LABEL_ONLY = new RegExp('^\\(' + PHONE_LABEL + '\\)$', 'i');
  const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  // innerText of the dialog -> { emails: [], phones: [{ value, ext, type }], websites: [] }
  function parseContactInfoText(text) {
    const lines = cleanLines(String(text || '').split(/\r?\n/));
    const out = { emails: [], phones: [], websites: [] };
    let section = '';
    for (const line of lines) {
      const head = CONTACT_HEADINGS[line.toLowerCase()];
      if (head) { section = head; continue; }

      for (const raw of line.match(EMAIL_IN_TEXT) || []) {
        const e = normalizeEmail(raw);
        if (e && !out.emails.includes(e)) out.emails.push(e);
      }

      if (section === 'phones' || PHONE_LABEL_END.test(line)) {
        if (PHONE_LABEL_ONLY.test(line)) {
          const last = out.phones[out.phones.length - 1];
          if (last && last.type === 'unknown') last.type = phoneTypeFromLabel(line);
          continue;
        }
        const p = parsePhoneLine(line);
        if (p && !out.phones.some(x => x.value === p.value)) out.phones.push(p);
      } else if (section === 'websites') {
        const m = line.match(/\bhttps?:\/\/[^\s)]+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s)]*)?/i);
        if (m && !/linkedin\.com/i.test(m[0])) {
          const href = safeHttpUrl(/^https?:/i.test(m[0]) ? m[0] : 'https://' + m[0]);
          if (href && !out.websites.includes(href)) out.websites.push(href);
        }
      }
    }
    return out;
  }

  // ── Escaping ─────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Quotes a CSV cell and neutralises spreadsheet formulas (scraped text is untrusted).
  // Phone numbers like "+1 (555)..." are left alone.
  function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=@\t\r]/.test(s) || /^[+\-](?![\d\s(])/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function safeHttpUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (_) {
      return '';
    }
  }

  // ── Consultant ↔ requirement matching ────────────────────────────────────
  // Consultant: { id, name, title, skills: 'Java, Spring Boot, AWS', experienceYears, visa,
  //               rate, location, relocation, availability, resumeUrl, notes, active }
  function splitSkills(text) {
    // "CI/CD", "PL/SQL" and "TCP/IP" are one skill each: hide their slash while splitting on "/".
    return String(text || '')
      .replace(/\b(CI|PL|TCP)\s*\/\s*(CD|SQL|IP)\b/gi, '$1\u0001$2')
      .split(/[,;|/\n]+/)
      .map(s => s.replace(/\u0001/g, '/').trim())
      .filter(s => s.length > 0 && s.length <= 40);
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Whole-word match that also works for skills like ".NET", "C#", "C++", "Node.js"
  function containsSkill(haystackLower, skill) {
    const s = skill.toLowerCase().trim();
    if (!s) return false;
    return new RegExp(`(?<![a-z0-9])${escapeRegex(s)}(?![a-z0-9])`).test(haystackLower);
  }

  // ── Résumé PDF: file checks, skill dictionary and text parsing ──────────
  const RESUME_MAX_BYTES = 5 * 1024 * 1024;

  const RESUME_PDF_TYPE = 'application/pdf';
  const RESUME_DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const RESUME_OLD_DOC_MESSAGE = 'Old Word .doc files can\u2019t be read. Please save it as .docx or PDF and upload again.';

  // What the first bytes of a file say it is: 'pdf', 'docx' (a ZIP; word/document.xml is checked
  // separately), 'doc' (old Word 97-2003 / OLE2) or ''. headerText is the file's first bytes as latin1 text.
  function resumeKind(headerText) {
    const h = String(headerText || '').slice(0, 1024);
    if (h.indexOf('%PDF-') !== -1) return 'pdf';
    if (h.slice(0, 4) === 'PK\u0003\u0004') return 'docx';
    if (h.slice(0, 4) === '\u00d0\u00cf\u0011\u00e0') return 'doc';
    return '';
  }

  // MIME type to store for a given kind ('pdf' | 'docx'); anything else is treated as PDF (older records).
  function resumeMime(kind) { return kind === 'docx' ? RESUME_DOCX_TYPE : RESUME_PDF_TYPE; }

  // Type of a stored record, with older PDF-only records (no type saved) defaulting to PDF.
  function resumeRecordType(rec) {
    const r = rec || {};
    if (r.type === RESUME_DOCX_TYPE) return RESUME_DOCX_TYPE;
    if (r.type === RESUME_PDF_TYPE) return RESUME_PDF_TYPE;
    return /\.docx$/i.test(String(r.fileName || '')) ? RESUME_DOCX_TYPE : RESUME_PDF_TYPE;
  }

  // meta: { name, type, size }; headerText: the first bytes of the file as text;
  // extra.docxOk: true when a ZIP file really contains word/document.xml (the caller checks that).
  // Returns '' when the file is acceptable, otherwise the message to show.
  function checkResumeFile(meta, headerText, extra) {
    const m = meta || {};
    const size = Number(m.size) || 0;
    if (size <= 0) return 'That file is empty.';
    if (size > RESUME_MAX_BYTES) return 'That file is larger than 5 MB.';
    const kind = resumeKind(headerText);
    const name = String(m.name || '');
    const type = m.type === 'application/octet-stream' ? '' : String(m.type || '');
    if (kind === 'doc' || type === 'application/msword' || (!type && /\.doc$/i.test(name))) return RESUME_OLD_DOC_MESSAGE;
    const wantsDocx = type === RESUME_DOCX_TYPE || (!type && /\.docx$/i.test(name));
    const wantsPdf = type === RESUME_PDF_TYPE || (!type && /\.pdf$/i.test(name));
    if (!wantsDocx && !wantsPdf) return 'Please choose a PDF or Word (.docx) file.';
    if (wantsDocx) {
      if (kind !== 'docx' || !(extra && extra.docxOk === true)) return 'That file is not a valid Word (.docx) document.';
      return '';
    }
    if (kind !== 'pdf') return 'That file is not a valid PDF.';
    return '';
  }

  // Common US IT skills and technologies (canonical spelling shown to the user).
  const SKILL_DICTIONARY = [
    'Java', 'JavaScript', 'TypeScript', 'Python', 'C', 'C++', 'C#', '.NET', '.NET Core', 'ASP.NET', 'VB.NET',
    'Go', 'Rust', 'Ruby', 'Ruby on Rails', 'PHP', 'Scala', 'Kotlin', 'Swift', 'Objective-C', 'R', 'Perl',
    'Shell Scripting', 'Bash', 'PowerShell', 'SQL', 'PL/SQL', 'T-SQL', 'HTML', 'CSS', 'Sass',
    'Spring', 'Spring Boot', 'Spring MVC', 'Hibernate', 'Microservices', 'REST API', 'SOAP', 'GraphQL', 'gRPC',
    'JSON', 'XML', 'Maven', 'Gradle', 'JUnit', 'Mockito', 'Selenium', 'Cypress', 'Playwright', 'TestNG',
    'Angular', 'AngularJS', 'React', 'Redux', 'Next.js', 'Vue.js', 'Node.js', 'Express.js', 'NestJS', 'jQuery',
    'Django', 'Flask', 'FastAPI', 'Laravel', 'Entity Framework', 'LINQ', 'Blazor', 'WPF', 'Xamarin',
    'AWS', 'Azure', 'GCP', 'EC2', 'S3', 'Lambda', 'EKS', 'CloudFormation', 'Terraform', 'Ansible', 'Puppet', 'Chef',
    'Docker', 'Kubernetes', 'OpenShift', 'Jenkins', 'GitLab CI', 'GitHub Actions', 'CI/CD', 'Git', 'Bitbucket',
    'Linux', 'Unix', 'Windows Server', 'VMware', 'Nginx', 'Apache Tomcat', 'WebLogic', 'WebSphere', 'JBoss',
    'MySQL', 'PostgreSQL', 'Oracle', 'SQL Server', 'MongoDB', 'Cassandra', 'DynamoDB', 'Redis', 'Elasticsearch',
    'Snowflake', 'Redshift', 'Teradata', 'DB2', 'Neo4j', 'NoSQL',
    'Kafka', 'RabbitMQ', 'ActiveMQ', 'Hadoop', 'Spark', 'Hive', 'Airflow', 'Databricks', 'PySpark', 'ETL',
    'Informatica', 'Talend', 'SSIS', 'SSRS', 'DBT', 'Data Warehousing', 'Data Modeling',
    'Tableau', 'Power BI', 'Looker', 'Splunk', 'Grafana', 'Prometheus', 'Datadog',
    'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'NLP', 'MLOps',
    'Salesforce', 'Apex', 'SAP', 'ServiceNow', 'Workday', 'Dynamics 365', 'SharePoint', 'Power Apps', 'MuleSoft',
    'Guidewire', 'Oracle EBS', 'PeopleSoft', 'Pega', 'Appian',
    'Agile', 'Scrum', 'Kanban', 'JIRA', 'Confluence', 'DevOps', 'SRE', 'TDD', 'BDD',
    'Android', 'iOS', 'React Native', 'Flutter', 'Cybersecurity', 'SIEM', 'IAM', 'OAuth', 'SSO',
    'Postman', 'SoapUI', 'JMeter', 'Business Analysis', 'UML', 'Excel'
  ];

  // Other ways people write a skill -> canonical name.
  const SKILL_ALIASES = {
    'nodejs': 'Node.js', 'node js': 'Node.js', 'reactjs': 'React', 'react.js': 'React',
    'vuejs': 'Vue.js', 'vue.js': 'Vue.js', 'expressjs': 'Express.js', 'express js': 'Express.js', 'nextjs': 'Next.js',
    'golang': 'Go', 'k8s': 'Kubernetes', 'postgres': 'PostgreSQL', 'amazon web services': 'AWS',
    'microsoft azure': 'Azure', 'google cloud': 'GCP', 'google cloud platform': 'GCP', 'dotnet': '.NET',
    'asp.net core': '.NET Core', 'c sharp': 'C#', 'restful': 'REST API', 'rest apis': 'REST API',
    'restful api': 'REST API', 'restful apis': 'REST API', 'ms sql server': 'SQL Server',
    'mssql': 'SQL Server', 'mongo db': 'MongoDB', 'apache spark': 'Spark', 'apache kafka': 'Kafka',
    'powerbi': 'Power BI', 'springboot': 'Spring Boot', 'angular js': 'AngularJS', 'sfdc': 'Salesforce',
    'unix shell': 'Shell Scripting', 'shell scripts': 'Shell Scripting',
    // v1.6.1 matching: more spellings, used on both the post side and the consultant side
    'dot net': '.NET', 'dot-net': '.NET', 'node': 'Node.js', 'mongo': 'MongoDB', 'cicd': 'CI/CD', 'ci cd': 'CI/CD', 'ci-cd': 'CI/CD',
    'sprint boot': 'Spring Boot', 'spring-boot': 'Spring Boot', 'service now': 'ServiceNow', 'sales force': 'Salesforce',
    'js': 'JavaScript', 'ts': 'TypeScript', 'ml': 'Machine Learning', 'snow': 'ServiceNow', 'ai/ml': 'Machine Learning',
    'postgre sql': 'PostgreSQL', 'react native js': 'React Native'
  };
  // Short spellings that are also ordinary words or common letters: in free text they only count in capitals
  // and standing alone ("JS", "TS", "ML", "AI", "SNOW"), never inside another word.
  const SHORT_CAPS_SKILLS = { JS: 'JavaScript', TS: 'TypeScript', ML: 'Machine Learning', AI: 'AI', SNOW: 'ServiceNow' };
  // Aliases that are ordinary words in free text: only used when the consultant typed them in a skills list.
  const LIST_ONLY_ALIASES = new Set(['js', 'ts', 'ml', 'snow', 'node', 'ai/ml']);
  // Go / R / C in a sentence count only with a tech word next to them ("Go developer", "R programming",
  // "C programming"); "go ahead" and "R&D" never do.
  const STRICT_CONTEXT = {
    Go: 'Go\\s+(?:developers?|engineers?|programmers?|programming|language|lang|backend|microservices)',
    R: 'R\\s+(?:programming|language|developers?|studio|shiny)',
    C: 'C\\s+(?:programming|language|developers?)'
  };
  // Skills that are single letters or ordinary words: match with exact case, and only as a list item
  // (", C," / "C/C++" / "Languages: Python, R"), so "Vitamin C" or "Go to market" never count.
  const STRICT_SKILLS = new Set(['C', 'R', 'Go']);
  // Skills that are also plain words: match with exact case.
  const CASE_SENSITIVE_SKILLS = new Set(['Spring', 'Spark', 'Oracle', 'Swift', 'Chef', 'Puppet', 'Lambda', 'Excel', 'Hive', 'Apex', 'Git']);

  let skillTermCache = null;
  function skillTerms() {
    if (skillTermCache) return skillTermCache;
    skillTermCache = [];
    const push = (term, canonical) => {
      const exact = term === canonical;
      if (exact && STRICT_SKILLS.has(canonical)) {
        skillTermCache.push({ canonical, re: new RegExp('(?:^|[\\s,;/|•·(])' + escapeRegex(term) + '(?=\\s*(?:[,;/|•·)]|$))', 'm') });
        if (STRICT_CONTEXT[canonical]) skillTermCache.push({ canonical, re: new RegExp('(?<![A-Za-z0-9])' + STRICT_CONTEXT[canonical] + '(?![A-Za-z0-9])') });
        return;
      }
      const flags = exact && CASE_SENSITIVE_SKILLS.has(canonical) ? '' : 'i';
      // No letter or digit on either side. A name that does not end in "+" or "#" may not run into one
      // (so "C" never matches "C++" or "C#", and "Java" never matches "JavaScript").
      const tail = /[+#]$/.test(term) ? '' : '(?![+#])';
      skillTermCache.push({ canonical, re: new RegExp('(?<![A-Za-z0-9])' + escapeRegex(term) + '(?![A-Za-z0-9])' + tail, flags) });
    };
    SKILL_DICTIONARY.forEach(s => push(s, s));
    Object.keys(SKILL_ALIASES).forEach(a => { if (!LIST_ONLY_ALIASES.has(a)) push(a, SKILL_ALIASES[a]); });
    // JS / TS / ML / AI / SNOW: capitals only, standing alone, never inside "R&D"-style fragments.
    Object.keys(SHORT_CAPS_SKILLS).forEach(a => skillTermCache.push({
      canonical: SHORT_CAPS_SKILLS[a], re: new RegExp('(?<![A-Za-z0-9&])' + a + '(?![A-Za-z0-9&])') }));
    return skillTermCache;
  }

  // Skills found in free text, in the order they first appear, without duplicates.
  function extractSkills(text) {
    const src = String(text || '');
    const found = new Map();
    for (const t of skillTerms()) {
      const m = t.re.exec(src);
      if (!m) continue;
      const at = m.index;
      if (!found.has(t.canonical) || found.get(t.canonical) > at) found.set(t.canonical, at);
    }
    // "Spring" is implied by the more specific names, so it is not listed next to them.
    if (found.has('Spring Boot') || found.has('Spring MVC')) found.delete('Spring');
    return [...found.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
  }

  const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
    'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
    'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
  const RESUME_TITLE_WORD = /\b(?:developer|engineer|architect|analyst|consultant|administrator|admin|manager|lead|scientist|tester|programmer|designer|specialist|devops|sre|dba|qa|director|strategist|coordinator)\b/i;
  const RESUME_NOT_A_NAME = /\b(?:resume|résumé|curriculum|vitae|cv|summary|objective|profile|contact|experience|education|skills?|technical|professional|address|email|e-mail|phone|mobile|linkedin|page|references|certifications?|projects?|work|history|authorized|authorization|visa|citizen)\b/i;

  function titleCaseWord(w) {
    return w.replace(/[A-Za-z]+/g, p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  }

  function resumeLines(text) {
    return String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function looksLikeName(line) {
    if (line.length > 40 || /[0-9@:/\\|•·]/.test(line)) return false;
    if (RESUME_NOT_A_NAME.test(line) || RESUME_TITLE_WORD.test(line)) return false;
    const tokens = line.split(' ');
    if (tokens.length < 2 || tokens.length > 4) return false;
    if (extractSkills(line).length) return false;
    const allCaps = line === line.toUpperCase();
    const okToken = allCaps
      ? (t) => /^[A-Z][A-Z'’.-]*$/.test(t)
      : (t) => /^(?:[A-Z][a-z]*(?:['’-]?[A-Z][a-z]+)?|[A-Z]\.|de|van|von|bin|al|la|del|da)$/.test(t);
    return tokens.every(okToken) && tokens.filter(t => t.replace(/[^A-Za-z]/g, '').length >= 2).length >= 2;
  }

  function pickResumeName(lines) {
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const l = lines[i];
      if (looksLikeName(l)) return { name: l === l.toUpperCase() ? titleCaseWord(l) : l, index: i };
    }
    return { name: '', index: -1 };
  }

  function titleFromLine(line) {
    if (/@|https?:|www\./i.test(line) || /\d{3}[\s.)-]*\d{3}/.test(line)) return '';
    const parts = line.replace(/^(?:title|role|designation|position)\s*:\s*/i, '').split(/\s+[|–—-]\s+|\s*\|\s*|\s*•\s*/);
    const hit = parts.find(p => RESUME_TITLE_WORD.test(p) && p.trim().length >= 4 && p.trim().length <= 70);
    if (!hit) return '';
    const t = hit.trim().replace(/^[^A-Za-z0-9.#+]+|[,;:]+$/g, '');
    return t.split(' ').length > 8 ? '' : t;
  }

  function pickResumeTitle(lines, nameIndex) {
    const start = nameIndex >= 0 ? nameIndex + 1 : 0;
    for (let i = start; i < Math.min(lines.length, start + 8); i++) {
      if (/^(?:professional\s+)?(?:summary|objective|profile|experience|education|technical skills)\b/i.test(lines[i])) break;
      const t = titleFromLine(lines[i]);
      if (t) return t;
    }
    // "... as a Senior Java Developer ..." in the summary
    const m = lines.slice(0, 25).join(' ').match(/\b(?:as|is) an? ((?:(?:Senior|Sr\.?|Lead|Principal|Junior|Jr\.?)\s+)?(?:[A-Z][\w.#+/-]*\s+){0,3}(?:Developer|Engineer|Architect|Analyst|Consultant|Administrator|Tester|Scientist))\b/);
    return m ? m[1].trim() : '';
  }

  function pickResumeEmail(text) {
    const all = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const good = all.find(e => !/^(?:no-?reply|donotreply)@/i.test(e));
    return good ? good.toLowerCase() : '';
  }

  // US numbers: (555) 123-4567, 555-123-4567, 555.123.4567, +1 555 123 4567, 5551234567
  function pickResumePhone(text) {
    const re = /(?<!\d)(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;
    const m = re.exec(String(text || ''));
    return m ? m[0].trim().replace(/\s+/g, ' ') : '';
  }

  function pickResumeLocation(text) {
    const re = new RegExp("\\b([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2}),\\s*(" + US_STATES.join('|') + ')\\b(?![A-Za-z])', 'g');
    const src = String(text || '');
    let m;
    while ((m = re.exec(src))) {
      if (extractSkills(m[1]).length) continue; // "Java, OR" is not Oregon
      return `${m[1]}, ${m[2]}`;
    }
    return '';
  }

  function pickResumeYears(text) {
    const src = String(text || '');
    const pats = [
      /\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+[\w.#+/&-]+,?){0,5}?\s+(?:experience|exp)\b/i,
      /\bexperience\s+(?:of\s+|for\s+)?(?:over\s+|more than\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i,
      /\b(?:over|more than)\s+(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i,
      /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i
    ];
    for (const re of pats) {
      const m = re.exec(src);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 45) return String(Number(m[1]));
    }
    return '';
  }

  // Text of a résumé -> { name, title, email, phone, location, experienceYears, skills: [] }.
  // Anything not found is '' (or []). Pure function: nothing is saved from here.
  function parseResumeText(text) {
    const lines = resumeLines(text);
    const joined = lines.join('\n');
    const nm = pickResumeName(lines);
    return {
      name: nm.name,
      title: pickResumeTitle(lines, nm.index),
      email: pickResumeEmail(joined),
      phone: pickResumePhone(joined),
      location: pickResumeLocation(joined),
      experienceYears: pickResumeYears(joined),
      skills: extractSkills(joined)
    };
  }

  const TITLE_STOPWORDS = new Set(['sr', 'senior', 'jr', 'junior', 'lead', 'engineer', 'developer', 'consultant',
    'analyst', 'specialist', 'architect', 'manager', 'the', 'and', 'of', 'with', 'for', 'full', 'stack', 'software']);

  function titleKeywords(title) {
    return String(title || '').toLowerCase().split(/[^a-z0-9#+.]+/)
      .map(w => w.replace(/^\.+|\.+$/g, ''))
      .filter(w => w.length > 1 && !TITLE_STOPWORDS.has(w));
  }

  // ── Bench matching (v1.5.2): a 0-100 % score with reasons, strict on purpose ──
  // Weights: skills 45 + title 20 + location 15 + experience 10 + visa/engagement 10.
  // Hard exclusions (never returned, whatever the score): hotlists, bench sellers and recruiter job
  // openings; full-time / W2-only / "no C2C" posts (bench consultants are C2C); a local-only post
  // for another state without relocation; a visa the post rules out.
  const MATCH_THRESHOLD = 60;
  // Skills that appear in most posts: one of these alone proves nothing, so they count for less.
  const GENERIC_SKILLS = new Set(['ai', 'ml', 'sql', 'data', 'cloud', 'api', 'apis', 'web', 'linux', 'git', 'excel', 'agile',
    'scrum', 'rest', 'html', 'css', 'json', 'xml', 'jira', 'testing', 'automation', 'analytics', 'office', 'windows']);
  const GENERIC_WEIGHT = 0.4;
  const SKILL_TARGET = 5;   // a post rarely needs more than ~5 of a consultant's skills

  // Engagement of the post: the tags written at save time, else read from the text (older leads).
  const FULLTIME_RE = /\b(?:full[\s-]*time|fte|permanent|perm)\b/i;
  const CONTRACT_OK_RE = /\bc2c\b|\bcorp[\s-]*(?:to|2)[\s-]*corp\b|\b1099\b|\bcontract\b|\bc2h\b/i;
  const NO_C2C_RE = /\b(?:no|not|non)[\s-]*(?:c2c|corp[\s-]*to[\s-]*corp)\b|\bc2c\s*(?:is\s*)?not\s*(?:allowed|accepted|considered)\b|\bw-?2\s*(?:only|candidates?\s*only)\b|\bonly\s*w-?2\b/i;
  function leadEngagementOk(lead, hay) {
    const tags = Array.isArray(lead.engagement) ? lead.engagement : [];
    if (tags.length) {
      const contract = tags.some(t => t === 'c2c' || t === '1099' || t === 'contract' || t === 'c2h');
      const c2cWord = tags.includes('c2c') || tags.includes('1099');
      if (tags.includes('fulltime') && !contract) return { ok: false };
      if (tags.includes('w2') && !c2cWord) return { ok: false };
      return { ok: true, known: c2cWord || contract };
    }
    if (NO_C2C_RE.test(hay)) return { ok: false };
    if (FULLTIME_RE.test(hay) && !CONTRACT_OK_RE.test(hay)) return { ok: false };
    return { ok: true, known: CONTRACT_OK_RE.test(hay) };
  }

  // Visa wording in the post that rules a consultant out. An unknown consultant visa is never excluded.
  const VISA_ALIASES = { USC: /\busc\b|\bus\s*citizen|\bcitizen/i, GC: /\bgc\b|green\s*card/i, 'GC-EAD': /\bgc[\s-]*ead\b|\bead\b/i,
    H1B: /\bh-?1b?\b/i, 'H4-EAD': /\bh-?4\b/i, 'L2-EAD': /\bl-?2\b/i, OPT: /\bopt\b/i, CPT: /\bcpt\b/i, 'STEM OPT': /\bopt\b/i, TN: /\btn\b/i };
  const ONLY_GC_USC_RE = /\b(?:gc|usc|us\s*citizens?|u\.s\.\s*citizens?|green\s*card)\b[^.\n]{0,25}\bonly\b|\bonly\b[^.\n]{0,20}\b(?:gc|usc|us\s*citizens?|green\s*card)\b/i;
  // "Independent visa only" means not tied to an employer sponsor: H1B is out. OPT/CPT are left alone (unclear).
  const NO_H1B_RE = /\bno\s+h-?1b?\b|\bh-?1b?\s+(?:(?:transfers?|candidates?|visa)\s+)?(?:is\s+|are\s+)?not\s+(?:allowed|accepted|considered|open)\b|\bwithout\s+h-?1b\b|\bindependent\s+(?:visa|only)\b/i;
  function visaExcludes(visa, hay) {
    const v = String(visa || '').trim().toUpperCase();
    if (!VISA_ALIASES[v]) return false;
    if (v === 'H1B' && NO_H1B_RE.test(hay)) return true;
    const m = ONLY_GC_USC_RE.exec(hay);
    if (m && v !== 'USC' && v !== 'GC') {
      // "Only GC, USC, H4 EAD" names the consultant's own visa: not excluded
      const win = hay.slice(Math.max(0, m.index - 30), m.index + m[0].length + 40);
      return !VISA_ALIASES[v].test(win);
    }
    return false;
  }

  function leadYears(hay) {
    const m = /\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/.exec(hay);
    return m && Number(m[1]) >= 1 && Number(m[1]) <= 40 ? Number(m[1]) : 0;
  }

  // ── Skill names: one spelling for both sides (v1.6.1) ──
  // "ReactJS" and "React", "K8s" and "Kubernetes", "Dot Net" and ".NET" all become the same key.
  let skillKeyMap = null;
  function skillKeyOf(skill) {
    if (!skillKeyMap) {
      skillKeyMap = new Map();
      SKILL_DICTIONARY.forEach(s => skillKeyMap.set(s.toLowerCase(), s.toLowerCase()));
      Object.keys(SKILL_ALIASES).forEach(a => skillKeyMap.set(a, SKILL_ALIASES[a].toLowerCase()));
      Object.keys(SHORT_CAPS_SKILLS).forEach(a => skillKeyMap.set(a.toLowerCase(), SHORT_CAPS_SKILLS[a].toLowerCase()));
    }
    const k = String(skill || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return skillKeyMap.get(k) || k;
  }
  // A skill that implies another one for matching: ASP.NET and .NET Core are .NET; Spring and Spring Boot go together.
  const SKILL_IMPLIES = { '.net': ['asp.net', '.net core'], 'asp.net': ['.net'], '.net core': ['.net'],
    'spring boot': ['spring'], 'spring': ['spring boot'] };
  function skillWeight(key) { return GENERIC_SKILLS.has(key) || key === 'rest api' || key === 'machine learning' ? GENERIC_WEIGHT : 1; }

  let dictKeySet = null;
  function isDictionaryKey(key) {
    if (!dictKeySet) {
      dictKeySet = new Set();
      SKILL_DICTIONARY.forEach(s => dictKeySet.add(s.toLowerCase()));
      Object.keys(SKILL_ALIASES).forEach(a => dictKeySet.add(SKILL_ALIASES[a].toLowerCase()));
      Object.keys(SHORT_CAPS_SKILLS).forEach(a => dictKeySet.add(SHORT_CAPS_SKILLS[a].toLowerCase()));
    }
    return dictKeySet.has(key);
  }

  // The post's tech skills: [{ key, name }], read from the post text with the same dictionary as résumés.
  function postSkillList(lead) {
    const raw = [lead.requirement, lead.technologies, lead.notes, lead.headline].filter(Boolean).join(' | ');
    const seen = new Set();
    const out = [];
    for (const name of extractSkills(raw)) {
      const key = skillKeyOf(name);
      if (!seen.has(key)) { seen.add(key); out.push({ key, name }); }
    }
    return out;
  }
  function haveSkill(haveKeys, key) {
    if (haveKeys.has(key)) return true;
    return (SKILL_IMPLIES[key] || []).some(k => haveKeys.has(k));
  }

  // Score one consultant against one lead. Returns null when excluded or below the threshold.
  // With opts.explain a near miss comes back instead of null ({ blocked, blockers, percent, reasons, missing }),
  // for a later "why not" view. A match always carries reasons, missing and blockers (empty) arrays.
  function scoreMatch(lead, c, opts) {
    if (!lead || !c) return null;
    if (lead.postType === 'hotlist' || lead.postType === 'recruiter-job' || lead.benchSeller === true) return null;
    const hay = [lead.requirement, lead.technologies, lead.notes, lead.headline].filter(Boolean).join(' | ').toLowerCase();
    if (!hay) return null;
    const eng = leadEngagementOk(lead, hay);
    if (!eng.ok) return null;
    if (visaExcludes(c.visa, hay)) return null;
    const explain = Boolean(opts && opts.explain);

    const reasons = [];
    const missing = [];
    const blockers = [];

    // Skills (45): weighted share of the POST's skills the consultant has. A post with fewer than 3 readable
    // skills falls back to the old measure (the consultant's own skills found in the post, against ~5).
    const all = splitSkills(c.skills);
    const postNeeds = postSkillList(lead);
    const haveKeys = new Set(all.map(skillKeyOf));
    const postKeys = new Set(postNeeds.map(n => n.key));
    const matchedSkills = all.filter(s => {
      const k = skillKeyOf(s);
      if (haveSkill(postKeys, k)) return true;
      // skills the dictionary does not know are also looked for in the text (Go, R, C, AI are in the dictionary,
      // so they only count when the post names them as skills)
      return !isDictionaryKey(k) && k.length > 2 && containsSkill(hay, s);
    });
    const weight = s => skillWeight(skillKeyOf(s));
    const wMatched = matchedSkills.reduce((n, s) => n + weight(s), 0);
    const wAll = all.reduce((n, s) => n + weight(s), 0);
    const reqWords = new Set(titleKeywords(lead.requirement));
    const cWords = titleKeywords(c.title);
    const titleHits = cWords.filter(w => reqWords.has(w)).length;
    const titleMatch = titleHits > 0;
    // One shared skill is not a match: need two, or one plus the same role.
    if (matchedSkills.length < 2 && !(matchedSkills.length === 1 && titleMatch)) return null;
    let pts;
    let capAt = 100;
    if (postNeeds.length >= 3) {
      const wNeed = postNeeds.reduce((n, s) => n + skillWeight(s.key), 0);
      const wHave = postNeeds.filter(s => haveSkill(haveKeys, s.key)).reduce((n, s) => n + skillWeight(s.key), 0);
      const cover = wNeed > 0 ? wHave / wNeed : 0;
      pts = 45 * cover;
      const lacking = postNeeds.filter(s => !haveSkill(haveKeys, s.key) && skillWeight(s.key) === 1).map(s => s.name);
      if (lacking.length) missing.push(`skills: ${lacking.slice(0, 4).join(', ')}`);
      // Covers under half of what the post asks for: never shown as a match, whatever else fits.
      if (cover < 0.5) { capAt = MATCH_THRESHOLD - 1; blockers.push(`skills: covers ${Math.round(cover * 100)}% of the post's skills`); }
    } else {
      pts = 45 * Math.min(1, wMatched / Math.max(1, Math.min(wAll, SKILL_TARGET)));
    }
    reasons.push(matchedSkills.slice(0, 4).join(', '));

    // Title (20): share of the consultant's title keywords in the requirement title; unknown title is neutral.
    if (!cWords.length) pts += 8;
    else if (titleMatch) { pts += Math.max(12, 20 * titleHits / cWords.length); reasons.push('title match'); }
    else missing.push('title');

    // Location (15): local-only needs the state (or relocation); remote always fits.
    const mode = String(lead.workMode || '').toLowerCase();
    const remote = mode === 'remote' || (!mode && /\bremote\b/i.test(lead.location || ''));
    if (lead.localOnly === true) {
      if (!consultantFitsLocal(c, lead)) blockers.push(`location (${String(lead.localState || '').toUpperCase() || 'local only'})`);
      pts += lead.localState ? 15 : 8;
      if (lead.localState) reasons.push(`Local to ${String(lead.localState).toUpperCase()}`);
    } else if (remote) {
      pts += 15; reasons.push('Remote');
    } else {
      const want = usStateOf(lead.localState || lead.location);
      const have = usStateOf(c.location);
      if (!want || !have) pts += 9;
      else if (want === have) { pts += 15; reasons.push(`Same state (${have})`); }
      else if (RELOCATE_YES.test(String(c.relocation || '').trim())) { pts += 11; reasons.push('Open to relocate'); }
      else {
        // Onsite or hybrid in another state and the consultant will not relocate: not a match.
        blockers.push(`location (${want}, no relocation)`); missing.push(`location (${want})`);
      }
    }

    // Experience (10): years asked in the post vs the consultant's; unknown is neutral.
    const need = leadYears(hay);
    const yrs = parseFloat(c.experienceYears);
    if (!need || !(yrs > 0)) pts += 5;
    else if (yrs >= need) { pts += 10; reasons.push(`${Math.round(yrs)}+ yrs`); }
    else if (yrs >= need - 2) pts += 6;
    else { pts += 2; missing.push(`experience (needs ${need}+)`); }

    // Visa and engagement (10): 5 for a contract-friendly post, 5 for a known visa with no conflict.
    pts += eng.known ? 5 : 3;
    if (eng.known) reasons.push('C2C ok');
    pts += c.visa ? 5 : 3;

    let percent = Math.max(0, Math.min(100, Math.round(pts)));
    if (blockers.length) percent = Math.min(percent, MATCH_THRESHOLD - 1);
    percent = Math.min(percent, capAt);
    if (percent < MATCH_THRESHOLD || blockers.length) {
      if (!explain) return null;
      return { consultant: c, score: percent, percent, matchedSkills, titleMatch, reasons, missing, blockers, blocked: true };
    }
    return { consultant: c, score: percent, percent, matchedSkills, titleMatch, reasons, missing, blockers };
  }

  // Returns [{ consultant, score, percent, matchedSkills, titleMatch, reasons, missing }] best first, only
  // matches at or above MATCH_THRESHOLD. score === percent (it used to be a count of shared skills).
  function matchConsultants(lead, consultants) {
    if (!lead) return [];
    return (consultants || [])
      .filter(c => c && c.active !== false)
      .map(c => scoreMatch(lead, c))
      .filter(Boolean)
      .sort((a, b) => b.percent - a.percent);
  }

  // ── Pitch email templates ────────────────────────────────────────────────
  function firstNameOf(name) {
    const n = (name || '').trim();
    if (!n || /^recruiter/i.test(n)) return 'there';
    return n.split(/\s+/)[0];
  }

  // consultant is optional; its variables are blank when no consultant is chosen.
  function fillTemplate(text, lead, myName, consultant) {
    const c = consultant || {};
    const vars = {
      firstName: firstNameOf(lead.recruiterName),
      recruiterName: lead.recruiterName || '',
      company: lead.companyName && lead.companyName !== 'Staffing Partner' ? lead.companyName : 'your team',
      requirement: lead.requirement || 'open',
      location: lead.location && lead.location !== 'United States' ? `(${lead.location})` : '',
      technologies: lead.technologies || 'IT',
      myName: myName || '',
      consultantName: c.name || '',
      consultantTitle: c.title || '',
      consultantSkills: c.skills || '',
      consultantExperience: c.experienceYears ? `${c.experienceYears}+ years` : '',
      consultantVisa: c.visa || '',
      consultantRate: c.rate || '',
      consultantLocation: c.location || '',
      consultantAvailability: c.availability || '',
      consultantResume: c.resumeUrl || ''
    };
    return String(text || '')
      .replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m))
      .replace(/[ \t]+([,.)])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function buildComposeUrl(client, to, subject, body) {
    const e = encodeURIComponent;
    if (client === 'outlook') {
      return `https://outlook.office.com/mail/deeplink/compose?to=${e(to)}&subject=${e(subject)}&body=${e(body)}`;
    }
    if (client === 'mailto') {
      return `mailto:${e(to)}?subject=${e(subject)}&body=${e(body)}`;
    }
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${e(to)}&su=${e(subject)}&body=${e(body)}`;
  }

  // Template used by "Pitch" (consultant=false) or "Submit consultant" (consultant=true).
  // "Submit" always uses the 'consultant' template when present; for plain Pitch a plan that
  // allows one template always uses the first, whatever is stored.
  function pickTemplate(templates, activeTemplateId, tier, consultant) {
    const list = Array.isArray(templates) && templates.length ? templates : DEFAULT_TEMPLATES;
    if (consultant) {
      const c = list.find(t => t.id === 'consultant') || DEFAULT_TEMPLATES.find(t => t.id === 'consultant');
      if (c) return c;
    }
    const max = limit(tier, 'templates');
    if (max <= 1) return list[0];
    const idx = list.findIndex(t => t.id === activeTemplateId);
    return idx !== -1 && idx < max ? list[idx] : list[0];
  }

  // ── Pitch messages from the bench (template-based, offline, no AI) ───────
  // BP.pitchMessages(consultant, { lead, firstName, role, myName }) -> { connection, dm, hotlist }
  //   connection: LinkedIn connection note, never more than PITCH_CONNECTION_LIMIT characters; facts are
  //               dropped lowest-priority first, never mid-word.
  //   dm:         3-5 short lines for a 1st-degree recruiter.
  //   hotlist:    one line for posts / WhatsApp groups.
  // Empty consultant fields are omitted. With no lead/firstName the greeting is "Hi there,".
  const PITCH_CONNECTION_LIMIT = 200;

  function pitchClean(v, max) {
    const s = String(v == null ? '' : v).replace(/\{\w*\}/g, ' ').replace(/\s+/g, ' ').trim();
    return max ? pitchClip(s, max) : s;
  }

  // Cut at a word boundary, never mid-word.
  function pitchClip(s, max) {
    if (s.length <= max) return s;
    const cut = s.slice(0, max + 1);
    const sp = cut.lastIndexOf(' ');
    return (sp > 0 ? cut.slice(0, sp) : cut.slice(0, max)).replace(/[\s,;:|\-–(]+$/, '');
  }

  function pitchArticle(word) {
    const w = String(word || '').split(/\s+/)[0];
    if (!w) return 'a';
    if (/^[A-Z0-9]{2,5}$/.test(w)) return /^[AEFHILMNORSX]/.test(w) ? 'an' : 'a';
    return /^[aeiou]/i.test(w) && !/^(uni|use|eur|one)/i.test(w) ? 'an' : 'a';
  }

  function pitchExperience(v) {
    const s = pitchClean(v, 20);
    if (!s) return '';
    if (/^\d+(\.\d+)?$/.test(s)) return `${s}+ yrs`;
    if (/^\d+\s*-\s*\d+$/.test(s)) return `${s.replace(/\s+/g, '')} yrs`;
    return /[a-z]/i.test(s) ? s : `${s} yrs`;
  }

  function pitchAvailability(v) {
    const s = pitchClean(v, 40);
    if (!s) return '';
    if (/^(immediate|now|asap)/i.test(s)) return 'Available now';
    if (/^available/i.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
    return /^\d/.test(s) ? `Available in ${s}` : `Available ${s}`;
  }

  function pitchLocation(c, withReloc) {
    const loc = pitchClean(c.location, 60);
    if (!loc || !withReloc) return loc;
    const r = String(c.relocation || '').trim().toLowerCase();
    if (r === 'yes') return `${loc} (open to relocate)`;
    if (r === 'negotiable') return `${loc} (relocation negotiable)`;
    return loc;
  }

  function pitchMessages(consultant, opts) {
    const c = consultant || {};
    const o = opts || {};
    const lead = o.lead || {};
    const fn = pitchClean(o.firstName, 30) || (lead.recruiterName ? pitchClean(firstNameOf(pitchClean(lead.recruiterName, 80)), 30) : '');
    const first = fn && !/^(there|recruiter)$/i.test(fn) ? fn : 'there';
    const greet = `Hi ${first},`;
    const role = pitchClean(o.role || lead.requirement, 60);
    const me = pitchClean(o.myName, 40);
    const title = pitchClean(c.title, 80) || 'consultant';
    const exp = pitchExperience(c.experienceYears);
    const visa = pitchClean(c.visa, 20);
    const avail = pitchAvailability(c.availability);
    const rate = pitchClean(c.rate, 60);
    const eng = ((rate.match(/\b(C2C|W2|1099|C2H)\b/i) || [])[1] || '').toUpperCase();
    const skillList = splitSkills(pitchClean(c.skills));

    // Hotlist: Title | exp | visa | location | engagement | availability
    const hotlist = [title === 'consultant' ? 'Consultant' : title, exp, visa, pitchLocation(c, true), eng, avail]
      .filter(Boolean).join(' | ');

    // Connection note: pieces are dropped in this order until it fits (highest priority kept longest).
    const parts = { sign: Boolean(me), closing: true, skills: true, role: Boolean(role), eng: true, reloc: true, avail: true, exp: true, visa: true, loc: true };
    const drop = ['sign', 'closing', 'skills', 'role', 'eng', 'reloc', 'avail', 'exp', 'visa', 'loc'];
    const build = (p, ttl) => {
      const facts = [p.exp ? exp : '', p.visa ? visa : '', p.loc ? pitchLocation(c, p.reloc) : '', p.eng ? eng : '',
        p.avail ? avail : '', p.skills ? skillList.slice(0, 3).join(', ') : ''].filter(Boolean);
      let s = `${greet} I have ${pitchArticle(ttl)} ${ttl}`;
      if (p.role) s += ` for your ${role} role`;
      if (facts.length) s += `: ${facts.join(' | ')}`;
      s += '.';
      if (p.closing) s += ' Happy to share the profile.';
      if (p.sign) s += ` - ${me}`;
      return s;
    };
    let connection = build(parts, title);
    for (let i = 0; i < drop.length && connection.length > PITCH_CONNECTION_LIMIT; i++) {
      parts[drop[i]] = false;
      connection = build(parts, title);
    }
    // Only greeting + title remain: shorten the title at a word boundary.
    let max = title.length;
    while (connection.length > PITCH_CONNECTION_LIMIT && max > 1) {
      max = Math.max(1, max - Math.max(1, connection.length - PITCH_CONNECTION_LIMIT));
      connection = build(parts, pitchClip(title, max) || 'consultant');
    }
    if (connection.length > PITCH_CONNECTION_LIMIT) connection = pitchClip(connection, PITCH_CONNECTION_LIMIT);

    // Short DM: greeting, intro, key facts, skills / rate, closing.
    const a = pitchArticle(title);
    const lines = [greet];
    lines.push(role
      ? `I have ${a} ${title} on the bench who fits your ${role} requirement.`
      : `I have ${a} ${title} available on the bench.`);
    const dmFacts = [exp, visa, pitchLocation(c, true), rate ? '' : eng, avail].filter(Boolean).join(' | ');
    if (dmFacts) lines.push(dmFacts);
    const extra = [skillList.length ? `Key skills: ${skillList.slice(0, 6).join(', ')}.` : '', rate ? `Rate: ${rate}.` : ''].filter(Boolean).join(' ');
    if (extra) lines.push(extra);
    lines.push(`Can I send the profile?${me ? ` Thanks, ${me}` : ''}`);

    return { connection, dm: lines.join('\n'), hotlist };
  }

  // ══ Quick notes (v1.5, issue #10) ═══════════════════════════════════════════
  // Saved text snippets reused all day. Stored as chrome.storage.local.quickNotes:
  //   [{ id, title (<=40), text (<=2000), createdAt, updatedAt, order }]
  // Pure helpers only; the service worker (single writer) and the UI call these.
  const QUICK_NOTE_TITLE_MAX = 40;
  const QUICK_NOTE_TEXT_MAX = 2000;

  const DEFAULT_QUICK_NOTES = [
    { title: 'Intro',
      text: 'Hi {firstName}, this is {myName}. I work with a bench of vetted consultants and would love to be on your vendor list for upcoming requirements. Happy to share profiles that match what you are hiring for. Thanks!' },
    { title: 'Hotlist line',
      text: 'Available consultants: [Role] | [Skills] | [Visa] | [Location] | [Rate]. Profiles ready to submit. Please reply with your requirement and I will send a resume today.' },
    { title: 'Follow-up',
      text: 'Hi {firstName}, following up on my earlier note. Do you have any open requirements my consultants could help with? I can send matching profiles right away. Thanks, {myName}' }
  ];

  function clipStr(v, max) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max); }

  // Clips and trims user input. Title is single-line.
  function sanitizeQuickNote(input) {
    const n = input || {};
    return {
      title: clipStr(n.title, QUICK_NOTE_TITLE_MAX).replace(/\s*\n\s*/g, ' '),
      text: clipStr(n.text, QUICK_NOTE_TEXT_MAX)
    };
  }

  // -> { ok: true, note: { title, text } } or { ok: false, error }
  function validateQuickNote(input) {
    const note = sanitizeQuickNote(input);
    if (!note.title) return { ok: false, error: 'Give the note a title.' };
    if (!note.text) return { ok: false, error: 'The note text is empty.' };
    return { ok: true, note };
  }

  // Adding is blocked at the plan limit; existing notes stay usable after a downgrade.
  function canAddQuickNote(tier, count) {
    return (Number(count) || 0) < limit(tier, 'quickNotes');
  }

  // "2 of 3 on Free" or "5 notes on Pro" (unlimited)
  function quickNoteUsageText(tier, count) {
    const n = Number(count) || 0;
    const max = limit(tier, 'quickNotes');
    return Number.isFinite(max)
      ? `${n} of ${max} on ${tierLabel(tier)}`
      : `${n} note${n === 1 ? '' : 's'} on ${tierLabel(tier)}`;
  }

  function quickNoteLimitMessage(tier) {
    const t = tierOf(tier);
    return t === 'pro'
      ? 'You have reached the quick notes limit.'
      : `The ${tierLabel(t)} plan includes ${limit(t, 'quickNotes')} quick notes. Upgrade to ${t === 'free' ? 'Basic (20) or Pro (unlimited)' : 'Pro (unlimited)'} for more.`;
  }

  function newQuickNoteId() {
    return 'qn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Seed notes for a first run (only used when quickNotes is absent in storage).
  function defaultQuickNotes(now) {
    const at = now || new Date().toISOString();
    return DEFAULT_QUICK_NOTES.map((n, i) => ({
      id: 'qn-default-' + (i + 1), title: n.title, text: n.text, createdAt: at, updatedAt: at, order: i
    }));
  }

  // Sorted by order (stable), tolerant of junk. Always returns a new array.
  function sortQuickNotes(list) {
    return (Array.isArray(list) ? list : [])
      .filter(n => n && typeof n === 'object' && n.id)
      .map((n, i) => ({ n, i }))
      .sort((a, b) => ((Number(a.n.order) || 0) - (Number(b.n.order) || 0)) || (a.i - b.i))
      .map(x => x.n);
  }

  // Re-numbers order 0..n-1 following the array order.
  function renumberQuickNotes(list) {
    return list.map((n, i) => ({ ...n, order: i }));
  }

  // dir: -1 (up) or 1 (down). Returns the renumbered list (same order at the edges).
  function moveQuickNote(list, id, dir) {
    const sorted = sortQuickNotes(list);
    const i = sorted.findIndex(n => n.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= sorted.length) return renumberQuickNotes(sorted);
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    return renumberQuickNotes(sorted);
  }

  // Applies an explicit id order; ids not listed keep their relative order at the end.
  function reorderQuickNotes(list, ids) {
    const sorted = sortQuickNotes(list);
    const byId = new Map(sorted.map(n => [n.id, n]));
    const out = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); }
    }
    for (const n of sorted) if (byId.has(n.id)) out.push(n);
    return renumberQuickNotes(out);
  }

  // Fills only the placeholders we actually know; anything unknown stays visible as {token}.
  // ctx: { recruiterName, firstName, company, myName }
  function fillQuickNote(text, ctx) {
    const c = ctx || {};
    const recruiter = String(c.recruiterName || '').trim();
    const known = /^recruiter/i.test(recruiter) ? '' : recruiter;
    const vars = {
      firstName: String(c.firstName || (known ? firstNameOf(known) : '')).trim(),
      recruiterName: known,
      company: String(c.company || '').trim(),
      myName: String(c.myName || '').trim()
    };
    return String(text == null ? '' : text).replace(/\{(\w+)\}/g, (m, key) => (vars[key] ? vars[key] : m));
  }

  // Resolves to the worker's response, or {} if the extension was reloaded / unreachable.
  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  // ── Vendors view helpers (v1.5) ──────────────────────────────────────────
  // Pure functions behind the dashboard "Vendors" view. They never touch storage or the DOM.
  // `leads` and `companies` are the arrays saved by the service worker (see lib/migrations.js).

  // Latest of a lead's lastContactDate (YYYY-MM-DD) and savedAt (ISO), as epoch ms; 0 when neither is valid.
  function leadActivityTime(lead) {
    let best = 0;
    for (const v of [lead && lead.lastContactDate, lead && lead.savedAt]) {
      const t = typeof v === 'string' && v ? Date.parse(v) : NaN;
      if (!isNaN(t) && t > best) best = t;
    }
    return best;
  }

  // One row per company: { company, leads, count, bounced, lastActivity }.
  // Leads are indexed by companyId once (O(leads + companies)); rows keep the order of `companies`.
  function companyStats(companies, leads) {
    const byCompany = new Map();
    for (const l of leads || []) {
      const id = l && l.companyId;
      if (typeof id !== 'string' || !id) continue;
      let arr = byCompany.get(id);
      if (!arr) { arr = []; byCompany.set(id, arr); }
      arr.push(l);
    }
    return (companies || []).map((company) => {
      const own = byCompany.get(company.id) || [];
      let last = 0, bounced = 0;
      for (const l of own) {
        const t = leadActivityTime(l);
        if (t > last) last = t;
        if (l.bounced) bounced++;
      }
      return { company, leads: own, count: own.length, bounced, lastActivity: last };
    });
  }

  // Case-insensitive match on name, domain and aliases. An empty query matches everything.
  function companyMatchesQuery(company, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    if (String(company.name || '').toLowerCase().includes(q)) return true;
    if (String(company.domain || company.id || '').toLowerCase().includes(q)) return true;
    return (company.aliases || []).some((a) => String(a).toLowerCase().includes(q));
  }

  // opts: { query, label ('' = any, else a label key), showEmpty (default false) }
  function filterCompanyRows(rows, opts) {
    const o = opts || {};
    return (rows || []).filter((r) => {
      if (!o.showEmpty && r.count === 0) return false;
      if (o.label && (r.company.label || 'none') !== o.label) return false;
      return companyMatchesQuery(r.company, o.query);
    });
  }

  // key: 'name' (A-Z) | 'recruiters' (most first) | 'activity' (newest first). Ties fall back to name.
  // Returns a new array.
  function sortCompanyRows(rows, key) {
    const byName = (a, b) => String(a.company.name || '').localeCompare(String(b.company.name || ''), undefined, { sensitivity: 'base' });
    const cmp = key === 'recruiters' ? (a, b) => b.count - a.count || byName(a, b)
      : key === 'activity' ? (a, b) => b.lastActivity - a.lastActivity || byName(a, b)
      : byName;
    return (rows || []).slice().sort(cmp);
  }

  // ── Rate and margin calculator (pure math, USD per hour) ────────────────
  // Margin per hour = bill - pay x (1 + burden, W2 only) - bill x fee% - fixed.
  // Values stay unrounded here; round to cents only when showing them.
  const RATE_TYPES = ['W2', '1099', 'C2C'];
  const RATE_DEFAULTS = { type: 'C2C', pay: 0, bill: 0, burdenPct: 15, feePct: 0, fixed: 0, hours: 160, targetPct: 20 };

  function rateNum(v, fallback) {
    if (typeof v === 'string') v = v.replace(/[$,%\s]/g, '');
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function rateInputs(input) {
    const i = input || {};
    const type = RATE_TYPES.includes(String(i.type).toUpperCase()) ? String(i.type).toUpperCase() : 'C2C';
    return {
      type,
      pay: Math.max(0, rateNum(i.pay, 0)),
      bill: Math.max(0, rateNum(i.bill, 0)),
      burden: type === 'W2' ? Math.max(0, rateNum(i.burdenPct, RATE_DEFAULTS.burdenPct)) / 100 : 0,
      fee: Math.max(0, rateNum(i.feePct, 0)) / 100,
      fixed: Math.max(0, rateNum(i.fixed, 0)),
      hours: Math.max(0, rateNum(i.hours, RATE_DEFAULTS.hours)),
      target: rateNum(i.targetPct, RATE_DEFAULTS.targetPct) / 100
    };
  }

  // Returns { valid, marginHr, marginPct, monthly, payCost, feeCost }; valid is false when the bill rate is empty or zero.
  function rateMargin(input) {
    const r = rateInputs(input);
    if (!(r.bill > 0)) return { valid: false, marginHr: 0, marginPct: 0, monthly: 0, payCost: 0, feeCost: 0 };
    const payCost = r.pay * (1 + r.burden);
    const feeCost = r.bill * r.fee;
    const marginHr = r.bill - payCost - feeCost - r.fixed;
    return { valid: true, marginHr, marginPct: (marginHr / r.bill) * 100, monthly: marginHr * r.hours, payCost, feeCost };
  }

  // Highest pay rate that still gives the target margin % of the bill rate. Null when the bill rate is empty or zero,
  // or when the target cannot be reached even at a pay rate of zero.
  function maxPayForMargin(input) {
    const r = rateInputs(input);
    if (!(r.bill > 0) || r.target >= 1) return null;
    const pay = (r.bill * (1 - r.fee - r.target) - r.fixed) / (1 + r.burden);
    return pay > 0 ? pay : null;
  }

  // Pulls an hourly rate out of free text like "$65/hr", "65", "65 C2C", "$60-70/hr" (takes the low end).
  // Ignores annual or monthly figures and anything unparseable. Returns a number or null.
  function parseRate(text) {
    const t = String(text === null || text === undefined ? '' : text).toLowerCase();
    if (!t.trim()) return null;
    if (/(\/\s*(yr|year|annum|mo|month)|\bper\s*(year|annum|month)|\d\s*k\b|\blpa\b|annual)/.test(t)) return null;
    const m = /(\d{1,3}(?:\.\d{1,2})?)(?![\d,])/.exec(t.replace(/(\d),(?=\d{3})/g, '$1'));
    if (!m) return null;
    const n = Number(m[1]);
    return n > 0 && n < 1000 ? n : null;
  }

  // ── Who owns an email? (v1.6.1) ──────────────────────────────────────────
  // Bench sellers re-post other vendors' requirements in C2C groups, so the person who posted is not
  // always the person whose email is in the post. These pure helpers decide, from names and companies
  // only, whether the poster is plausibly the owner of an email. Nothing here reads the DOM.
  const NAME_TITLE_WORDS = new Set(['mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'ii', 'iii', 'phd', 'pmp', 'mba']);
  // Mailbox words: an address made only of these (hr@, jobs@, recruiting@) belongs to a team, not a person.
  const GENERIC_LOCAL_WORDS = new Set(['hr', 'jobs', 'job', 'careers', 'career', 'recruiter', 'recruiters', 'recruiting',
    'recruitment', 'talent', 'hiring', 'staffing', 'resumes', 'resume', 'cv', 'info', 'admin', 'sales', 'bench', 'team',
    'hello', 'contact', 'support', 'office', 'mail', 'apply', 'applications', 'bd', 'vendor', 'vendors', 'requirements',
    'req', 'reqs', 'ta', 'benchsales', 'marketing', 'usa', 'india', 'it', 'consultant', 'consultants', 'c2c', 'ops',
    'payroll', 'accounts', 'billing', 'noreply', 'donotreply', 'us', 'professionals', 'candidates', 'submissions']);
  // Words that carry no brand in a company name ("TEKSOLVE IT SOLUTIONS LLC" is just "teksolve").
  const COMPANY_NOISE_WORDS = new Set(['inc', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
    'solutions', 'solution', 'technologies', 'technology', 'tech', 'it', 'group', 'services', 'service', 'consulting',
    'consultants', 'systems', 'global', 'usa', 'us', 'india', 'pvt', 'private', 'staffing', 'software', 'infotech',
    'info', 'labs', 'international', 'enterprises', 'partners', 'talent', 'and', 'the', 'of']);
  const COMPANY_NOISE_SUFFIXES = ['solutions', 'solution', 'technologies', 'technology', 'consulting', 'services', 'systems',
    'software', 'infotech', 'staffing', 'global', 'group', 'corp', 'tech', 'inc', 'llc', 'ltd', 'usa'];

  function nameTokens(name) {
    let s = String(name || '');
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_) { /* old engines keep the accents */ }
    return s.toLowerCase().split(/[^a-z]+/).filter(t => t && !NAME_TITLE_WORDS.has(t));
  }

  // "Mdayaz.Ahmad+jobs12@nityo.com" -> ['mdayaz', 'ahmad']
  function emailLocalParts(email) {
    const s = String(email || '').trim().toLowerCase();
    const at = s.lastIndexOf('@');
    const local = (at === -1 ? s : s.slice(0, at)).split('+')[0];
    return local.split(/[._\-]+/).map(p => p.replace(/[^a-z]/g, '')).filter(Boolean);
  }

  // Does `part` (one piece of an email local part) stand for the name token `tok`?
  // Equal, a nickname-style prefix ("ravi" of "ravindra") or the other way round ("krishnan" for "krishna").
  function partMatchesToken(part, tok) {
    if (!part || !tok) return false;
    if (part === tok) return true;
    if (part.length === 1) return part === tok[0];
    if (part.length >= 3 && tok.length > part.length && tok.startsWith(part)) return true;
    if (tok.length >= 4 && part.length > tok.length && part.startsWith(tok)) return true;
    return false;
  }

  // True when the email's local part reads as this person's name: first, last, first+last, f+last,
  // last+f, first.last (any order), digits and separators ignored, a team word such as "hr" tolerated.
  function emailMatchesName(email, name) {
    const tokens = nameTokens(name);
    if (!tokens.length) return false;
    let parts = emailLocalParts(email);
    if (!parts.length) return false;
    const trimmed = parts.filter(p => !GENERIC_LOCAL_WORDS.has(p));
    if (trimmed.length) parts = trimmed;
    else return false;   // only team words: that is a shared mailbox, not this person
    const joined = parts.join('');

    const cand = new Set();
    for (const t of tokens) if (t.length >= 2) cand.add(t);
    const use = tokens.slice(0, 4);
    if (use.length >= 2) cand.add(use.map(t => t[0]).join(''));   // initials in name order: "ps" for Priya Sharma
    for (let i = 0; i < use.length; i++) {
      for (let j = 0; j < use.length; j++) {
        if (i === j) continue;
        cand.add(use[i] + use[j]);
        cand.add(use[i][0] + use[j]);
        cand.add(use[i] + use[j][0]);
      }
    }
    if (cand.has(joined)) return true;
    if (parts.length === 1) return tokens.some(t => t.length >= 3 && partMatchesToken(parts[0], t));
    return parts.every(p => tokens.some(t => partMatchesToken(p, t)));
  }

  // Loose version for cleanup: ANY piece of the address (3+ letters) resembling any name token.
  function emailNameOverlap(email, name) {
    const tokens = nameTokens(name);
    return emailLocalParts(email).some(p => p.length >= 3 && tokens.some(t => t.length >= 3 && partMatchesToken(p, t)));
  }

  // An address that looks like a person (mdayaz.ahmad@, nayak@) and not a team box (hr@, jobs@, recruiting@).
  function emailLooksPersonal(email) {
    const parts = emailLocalParts(email).filter(p => !GENERIC_LOCAL_WORDS.has(p));
    return parts.length > 0 && parts.every(p => p.length >= 2) && parts.join('').length >= 3;
  }

  // Registrable label of a domain: "mail.nityo.com" -> "nityo", "acme.co.uk" -> "acme".
  function domainBrand(domain) {
    const labels = String(domain || '').trim().toLowerCase().split('.').filter(Boolean);
    if (labels.length < 2) return labels[0] || '';
    let i = labels.length - 2;
    if (i >= 1 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'].includes(labels[i]) && labels[labels.length - 1].length === 2) i--;
    return labels[i];
  }

  function brandKey(brand) {
    let b = String(brand || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let n = 0; n < 3; n++) {
      const suf = COMPANY_NOISE_SUFFIXES.find(s => b.length - s.length >= 3 && b.endsWith(s));
      if (!suf) break;
      b = b.slice(0, -suf.length);
    }
    return b;
  }

  function companyKeys(company) {
    const tokens = String(company || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !COMPANY_NOISE_WORDS.has(t));
    if (!tokens.length) return [];
    const keys = [tokens.join(''), tokens[0]];
    if (tokens.length > 1) keys.push(tokens[0] + tokens[1]);
    return [...new Set(keys.filter(k => k.length >= 3))];
  }

  // Does this email domain belong to this company name? Free-mail never matches.
  function domainMatchesCompany(domain, company) {
    if (!domain || isFreeMailDomain(domain)) return false;
    const brand = brandKey(domainBrand(domain));
    if (brand.length < 3) return false;
    return companyKeys(company).some(k => k === brand || (Math.min(k.length, brand.length) >= 4 && (k.startsWith(brand) || brand.startsWith(k))));
  }

  // "US IT Bench Sales Recruiter at TEKSOLVE IT SOLUTIONS LLC | Hiring" -> "TEKSOLVE IT SOLUTIONS LLC"
  function companyFromHeadline(headline) {
    const s = String(headline || '');
    let last = '';
    const re = /(?:\bat\b|@)\s+([^|•·,;()]+)/gi;
    let m;
    while ((m = re.exec(s))) last = m[1].trim();
    return last.length > 1 ? last.slice(0, 120) : '';
  }

  // The decision: is this email plausibly the poster's own?
  //   { email, authorName, authorHeadline, authorCompany, sigName }
  // Owned when the address reads as the poster's name, or (business domains only) the domain's brand
  // matches the poster's company (from authorCompany or "... at X" in the headline). A signature name
  // next to the email that fits the address but not the poster means the email is somebody else's.
  function emailOwnedByAuthor(input) {
    const i = input || {};
    const email = String(i.email || '').trim().toLowerCase();
    if (!email) return false;
    const authorOk = emailMatchesName(email, i.authorName);
    if (i.sigName && !authorOk && emailMatchesName(email, i.sigName)) return false;
    if (authorOk) return true;
    const domain = emailDomain(email);
    const business = Boolean(domain) && !isFreeMailDomain(domain);
    const companies = [i.authorCompany, companyFromHeadline(i.authorHeadline)].filter(Boolean);
    if (business && companies.some(c => domainMatchesCompany(domain, c))) return true;

    // The poster signed right next to the email ("Ravi Kumar / rk123@gmail.com"): their own address, even
    // when it doesn't read as their name. Not when the address spells out someone else's full name, or is
    // another company's domain: then the poster's sign-off only sits near a re-shared email.
    if (samePersonName(i.sigName, i.authorName)) {
      if (emailNamesSomeoneElse(email, i.authorName)) return false;
      if (business && companies.length) return false;
      return true;
    }
    return false;
  }

  // Both names are the same person: the shorter one (2+ name parts) is wholly inside the longer one.
  function samePersonName(a, b) {
    const ta = nameTokens(a).filter(t => t.length >= 2);
    const tb = nameTokens(b).filter(t => t.length >= 2);
    if (!ta.length || !tb.length) return false;
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    return short.length >= 2 && short.every(t => long.includes(t));
  }

  // "mdayaz.ahmad@" reads as a full name (two 3+ letter parts) with nothing in common with this person.
  function emailNamesSomeoneElse(email, name) {
    const parts = emailLocalParts(email).filter(p => !GENERIC_LOCAL_WORDS.has(p) && p.length >= 3);
    return parts.length >= 2 && !emailNameOverlap(email, name);
  }

  // "mdayaz.ahmad@nityo.com" -> "Mdayaz Ahmad"
  function nameFromEmail(email) {
    const username = String(email || '').split('@')[0];
    if (!username) return 'Recruiter Lead';
    const parts = username.split(/[._\-]/).filter(p => p.length > 0 && !/^\d+$/.test(p));
    if (parts.length > 0) return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  // "nityo.com" -> "Nityo" (null for free-mail / invalid)
  function companyNameFromDomain(domain) {
    const d = String(domain || '').trim().toLowerCase();
    if (!d || isFreeMailDomain(d)) return '';
    const b = domainBrand(d);
    return b ? b.charAt(0).toUpperCase() + b.slice(1) : '';
  }

  // Who the saved contact is, given a post and its poster. Pure so it is unit-tested; content.js feeds it
  // what it read from the page. `author` = { name, headline, company, linkedinUrl, sigName, sigTitle, sigCompany, sigPhone,
  // posterHeadline, posterCompany }. `extractPhone(text)` finds a phone number in a piece of text.
  // -> { owned, recruiterName, companyName, designation, headline, phone, profileUrl, sharedBy|null }
  function attributeEmailContact(input) {
    const i = input || {};
    const email = String(i.email || '').trim();
    const author = i.author || {};
    const text = String(i.postText || '');
    const phoneOf = typeof i.extractPhone === 'function' ? i.extractPhone : () => '';
    const domain = emailDomain(email);
    const multi = Boolean(i.multi);
    const profileOk = /linkedin\.com\/(?:in|company)\//i.test(author.linkedinUrl || '');
    const owned = !multi && emailOwnedByAuthor({
      email,
      authorName: author.name,
      authorHeadline: author.posterHeadline !== undefined ? author.posterHeadline : author.headline,
      authorCompany: author.posterCompany,
      sigName: author.sigName
    });
    const sigLooksLikeName = (n) => root.BP && typeof root.BP.looksLikePersonName === 'function' ? root.BP.looksLikePersonName(n) : /^\S+\s+\S+/.test(n);

    if (owned) {
      return { owned: true, sharedBy: null, profileUrl: profileOk ? author.linkedinUrl : '' };
    }

    // The email belongs to someone else (a re-post, a vendor list, a group thread): never the poster's details.
    let recruiterName = '';
    const sig = cleanPersonName(author.sigName);
    const sigIsPoster = sig && nameTokens(author.name).length && nameTokens(sig).every(t => nameTokens(author.name).includes(t));
    if (sig && !sigIsPoster && sigLooksLikeName(sig)) recruiterName = sig;
    if (!recruiterName) recruiterName = nameFromEmail(email);

    const companyName = companyNameFromDomain(domain) || author.sigCompany || 'Staffing Partner';
    const sigTitle = String(author.sigTitle || '').trim();

    // Phone: only one printed on the same line as this email (the poster's own number is often elsewhere).
    let phone = author.sigPhone || '';
    if (!phone) {
      const lower = email.toLowerCase();
      const line = text.split(/\r?\n/).find(l => l.toLowerCase().includes(lower));
      if (line) phone = phoneOf(line) || '';
    }

    let sharedBy = null;
    const posterName = cleanPersonName(author.name);
    if (!multi && posterName && posterName !== 'Recruiter Lead') {
      sharedBy = {
        name: posterName,
        headline: String(author.posterHeadline !== undefined ? author.posterHeadline : author.headline || '').trim().slice(0, 120),
        url: profileOk ? author.linkedinUrl : ''
      };
    }
    return {
      owned: false,
      recruiterName,
      companyName,
      sigTitle,
      phone: phone || '—',
      profileUrl: '',
      sharedBy
    };
  }

  // "X reposted this", "Y likes this", "Z commented on this": a header line about someone reacting to the post,
  // never the author. content.js skips profile links that sit inside such a line.
  // The feed also writes it without "this": "Riya V commented", "Asha and 2 others reacted" (22 Oct: the commenter was
  // taken for the author, so the real recruiter's post failed the recruiter check and was dropped).
  const SOCIAL_CONTEXT_RE = /\b(?:likes?|loves?|celebrates?|supports?|finds?|reposted|commented|replied|follows?|shared|reacted|is hiring|are hiring|was mentioned|mentioned)\b[^\n]{0,40}\b(?:this|in this|on this)\b|\breposted this\b|\bcommented on this\b|^[^\n]{1,80}?\s(?:commented|reposted|replied|reacted)\s*$/im;

  // A re-shared post nests the ORIGINAL post inside the re-poster's card. When the email sits in that
  // inner block, the inner block's actor is the author to look at, not the person who re-shared it.
  // `rootEl` only needs querySelectorAll() and textContent (so tests can pass plain objects).
  const RESHARE_SELECTOR = '.update-components-mini-update-v2, .feed-shared-update-v2__reshare, .update-components-reshare, .feed-shared-mini-update-v2, [class*="reshare"]';
  function pickReshareScope(rootEl, email) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return rootEl;
    const e = String(email || '').toLowerCase();
    if (!e) return rootEl;
    let inner = [];
    try { inner = Array.from(rootEl.querySelectorAll(RESHARE_SELECTOR)); } catch (_) { return rootEl; }
    for (const el of inner) {
      if (el === rootEl) continue;
      if (String(el.textContent || '').toLowerCase().includes(e)) return el;
    }
    return rootEl;
  }

  // Whitelist for lead.sharedBy: short strings, LinkedIn profile URL only. null when there is nothing usable.
  function sanitizeSharedBy(value) {
    if (!value || typeof value !== 'object') return null;
    const clipS = (v, n) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, n);
    const name = clipS(value.name, 80);
    if (!name) return null;
    let url = '';
    try {
      const u = new URL(String(value.url || ''));
      if (u.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/(?:in|company)\//i.test(u.pathname)) {
        url = (u.origin + u.pathname).slice(0, 300);
      }
    } catch (_) { /* not a URL */ }
    return { name, headline: clipS(value.headline, 120), url };
  }

  // ── Text clean-up: HTML entities that leaked into post text ("Python &amp; SQL", "Python amp; SQL") ──
  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(text) {
    let s = String(text === undefined || text === null ? '' : text);
    if (!/&|\bamp;/i.test(s)) return s;
    for (let i = 0; i < 2; i++) {   // twice: "&amp;amp;" is double-escaped
      s = s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e) => {
        if (e[0] === '#') {
          const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
        }
        const v = NAMED_ENTITIES[e.toLowerCase()];
        return v === undefined ? m : v;
      });
    }
    // The "&" itself was lost: " amp; " between two words is an ampersand.
    return s.replace(/(^|[\s(\/])amp;(?=\s|$)/gi, '$1&');
  }

  // Does the post read like someone asking for candidates? A coarse gate only (BP.classifyPost tells requirement from hotlist).
  const HIRING_INTENT = /\b(?:hiring|we\s+are\s+looking|looking\s+for|requirements?|job\s+opening|open\s+position|c2c|corp[\s-]*to[\s-]*corp|w2|1099|share\s+(?:your\s+|the\s+)?(?:updated\s+)?(?:resume|profile|cv)s?|(?:send|forward|email|mail|drop)\s+(?:your\s+|me\s+|the\s+)?(?:updated\s+|latest\s+)?(?:resume|profile|cv)s?|(?:resume|profile|cv)s?\s+(?:to|at)|interested\s+(?:candidates|consultants|folks|professionals)|consultants?|contract\s+(?:role|position|to\s+hire)|immediate\s+(?:need|joiner)|job\s+description|must[\s-]*have\s+skills|job\s+role|required\s+skill(?:s|\s*set)?|skill\s*set\s+required)\b/i;
  function hasHiringIntent(text) {
    return HIRING_INTENT.test(decodeEntities(text));
  }

  // ── The signed-in member's own details: never captured as a lead ──
  // Identity = the profile slug(s) (detected from the page, cached locally) plus what Settings > My profile already holds.
  function slugFromProfileUrl(url) {
    const c = canonicalProfileUrl(url);
    if (!c) return '';
    try { return profileSlugFromPath(new URL(c).pathname); } catch (_) { return ''; }
  }
  function ownIdentity(myProfile, ownSlug) {
    const p = myProfile && typeof myProfile === 'object' ? myProfile : {};
    const slugs = new Set();
    const emails = new Set();
    const s1 = slugFromProfileUrl(p.linkedin);
    if (s1) slugs.add(s1);
    const s2 = String(ownSlug || '').trim().toLowerCase();
    if (/^[^\s\/?#]{1,100}$/.test(s2) && s2 !== 'me') slugs.add(s2);
    const e = normalizeEmail(p.email);
    if (e) emails.add(e);
    return { slugs, emails, empty: !slugs.size && !emails.size };
  }
  function isOwnProfileUrl(url, own) {
    const s = slugFromProfileUrl(url);
    return Boolean(s && own && own.slugs && own.slugs.has(s));
  }
  function isOwnEmail(email, own) {
    const e = normalizeEmail(email);
    return Boolean(e && own && own.emails && own.emails.has(e));
  }
  // A lead is "you" when its profile URL or its email is yours.
  function isOwnLead(lead, own) {
    if (!lead || !own || own.empty) return false;
    return isOwnProfileUrl(lead.linkedinProfile, own) || isOwnEmail(lead.email, own);
  }
  // The leads in allLeads that are the user. `keep` = emails the user chose to keep after an undo.
  function findOwnLeads(allLeads, own, keep) {
    const kept = new Set((Array.isArray(keep) ? keep : []).map(e => String(e || '').toLowerCase()));
    return (Array.isArray(allLeads) ? allLeads : []).filter(l => l && isOwnLead(l, own) && !kept.has(String(l.email || '').toLowerCase()));
  }

  root.BP = {
    decodeEntities, hasHiringIntent, slugFromProfileUrl, ownIdentity, isOwnProfileUrl, isOwnEmail, isOwnLead, findOwnLeads,
    nameTokensOf: nameTokens, emailOwnedByAuthor, emailMatchesName, emailNameOverlap, emailLooksPersonal, emailLocalParts,
    domainMatchesCompany, companyFromHeadline, nameFromEmail, companyNameFromDomain, attributeEmailContact,
    sanitizeSharedBy, SOCIAL_CONTEXT_RE, pickReshareScope,
    CFG,
    STATUSES,
    STATUS_EMOJI,
    normalizeStatus,
    DEFAULT_DESIGNATIONS,
    DEFAULT_BLACKLIST,
    FREE_EMAIL_DOMAINS,
    COMPANY_LABELS,
    COMPANY_LABEL_KEYS,
    FREE_MAIL_DOMAINS,
    emailDomain,
    isFreeMailDomain,
    companyIdForEmail,
    pickCompanyName,
    DEFAULT_TEMPLATES,
    MAX_TEMPLATES,
    MAX_CONSULTANTS,
    TIERS,
    TIER_ORDER,
    FEATURE_LABELS,
    REVEAL_EXPLAINER,
    tierOf,
    limit,
    can,
    minTierFor,
    tierLabel,
    extendOffer,
    FOLLOWUP_PLAN_NOTE,
    EXTEND_WINDOW_DAYS,
    tierRank,
    licenseTier,
    revealsText,
    maskEmail,
    maskPhone,
    PHONE_TYPES,
    PHONE_TYPE_LABELS,
    normalizePhoneType,
    phoneExtAfter,
    splitPhoneExt,
    phoneLabel,
    whatsappUrl,
    TZ,
    tierFeatureList,
    VISA_TYPES,
    splitSkills,
    skillKeyOf,
    RESUME_MAX_BYTES,
    checkResumeFile, resumeKind, resumeMime, resumeRecordType, RESUME_PDF_TYPE, RESUME_DOCX_TYPE,
    SKILL_DICTIONARY,
    extractSkills,
    parseResumeText,
    containsSkill,
    matchConsultants,
    scoreMatch,
    MATCH_THRESHOLD,
    todayStr,
    addDays,
    daysUntil,
    monthKey,
    escapeHtml,
    csvCell,
    safeHttpUrl,
    cleanPersonName, displayTitle, shownRecruiterName, shownCompanyName,
    normalizeEmail,
    leadPostKey,
    dedupeLeads, pageLeadKey, isRichLead, mergeRicherLead, collapseLeadsByEmail,
    duplicateSignature,
    findDuplicateGroups,
    mergeLeadRecords,
    undoLeadMerge,
    MISSING_FIELDS,
    missingDataCounts,
    leadMissing,
    cleanLines,
    profileSlugFromPath,
    canonicalProfileUrl,
    parseDurationMonths,
    formatTenure,
    parseConnectionDegree,
    nameFromPageTitle,
    parseCurrentCompanyLabel,
    pickCurrentCompany,
    sameCompany,
    parseTopCard,
    parseExperienceLines,
    phoneTypeFromLabel,
    parsePhoneLine,
    parseContactInfoText,
    firstNameOf,
    fillTemplate,
    buildComposeUrl,
    pickTemplate,
    pitchMessages,
    PITCH_CONNECTION_LIMIT,
    // quick notes (issue #10)
    QUICK_NOTE_TITLE_MAX, QUICK_NOTE_TEXT_MAX, DEFAULT_QUICK_NOTES,
    sanitizeQuickNote, validateQuickNote, canAddQuickNote, quickNoteUsageText, quickNoteLimitMessage,
    newQuickNoteId, defaultQuickNotes, sortQuickNotes, renumberQuickNotes, moveQuickNote, reorderQuickNotes, fillQuickNote,
    rateMargin,
    maxPayForMargin,
    parseRate,
    RATE_TYPES,
    RATE_DEFAULTS,
    send
  };

  // Vendors view helpers (block above).
  Object.assign(root.BP, { leadActivityTime, companyStats, companyMatchesQuery, filterCompanyRows, sortCompanyRows });

  // ── US states, local-only matching and job applications (issue #44) ───────
  const STATE_BY_NAME = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA', 'colorado': 'CO',
    'connecticut': 'CT', 'delaware': 'DE', 'district of columbia': 'DC', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS', 'kentucky': 'KY',
    'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD', 'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN',
    'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH',
    'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
    'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI',
    'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
    'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
  };
  // Well-known tech hubs, so "Dallas" or "Bay Area" alone still gives a state. Ambiguous names
  // (Arlington, Cambridge, Wilmington, Rochester) are left out on purpose.
  const STATE_BY_CITY = {
    'new york city': 'NY', 'nyc': 'NY', 'brooklyn': 'NY', 'buffalo': 'NY', 'albany': 'NY', 'jersey city': 'NJ', 'newark': 'NJ',
    'edison': 'NJ', 'princeton': 'NJ', 'iselin': 'NJ', 'piscataway': 'NJ', 'philadelphia': 'PA', 'pittsburgh': 'PA',
    'boston': 'MA', 'hartford': 'CT', 'stamford': 'CT', 'providence': 'RI', 'baltimore': 'MD', 'richmond': 'VA',
    'mclean': 'VA', 'reston': 'VA', 'tysons': 'VA', 'herndon': 'VA', 'ashburn': 'VA', 'mechanicsville': 'VA',
    'charlotte': 'NC', 'raleigh': 'NC', 'durham': 'NC', 'cary': 'NC', 'atlanta': 'GA', 'alpharetta': 'GA',
    'tampa': 'FL', 'miami': 'FL', 'orlando': 'FL', 'jacksonville': 'FL', 'nashville': 'TN', 'memphis': 'TN',
    'birmingham': 'AL', 'new orleans': 'LA', 'little rock': 'AR', 'louisville': 'KY', 'columbus': 'OH', 'cleveland': 'OH',
    'cincinnati': 'OH', 'detroit': 'MI', 'indianapolis': 'IN', 'chicago': 'IL', 'schaumburg': 'IL', 'milwaukee': 'WI',
    'madison': 'WI', 'minneapolis': 'MN', 'des moines': 'IA', 'omaha': 'NE', 'kansas city': 'MO', 'st. louis': 'MO',
    'st louis': 'MO', 'oklahoma city': 'OK', 'austin': 'TX', 'dallas': 'TX', 'plano': 'TX', 'irving': 'TX',
    'frisco': 'TX', 'houston': 'TX', 'san antonio': 'TX', 'fort worth': 'TX', 'denver': 'CO', 'salt lake city': 'UT',
    'phoenix': 'AZ', 'tempe': 'AZ', 'scottsdale': 'AZ', 'las vegas': 'NV', 'albuquerque': 'NM', 'boise': 'ID',
    'seattle': 'WA', 'bellevue': 'WA', 'redmond': 'WA', 'kirkland': 'WA', 'portland': 'OR', 'san francisco': 'CA',
    'bay area': 'CA', 'san jose': 'CA', 'sunnyvale': 'CA', 'santa clara': 'CA', 'mountain view': 'CA', 'palo alto': 'CA',
    'fremont': 'CA', 'los angeles': 'CA', 'san diego': 'CA', 'sacramento': 'CA', 'irvine': 'CA', 'honolulu': 'HI',
    'anchorage': 'AK'
  };
  const STATE_NAME_RE = new RegExp('\\b(' + Object.keys(STATE_BY_NAME).sort((a, b) => b.length - a.length).join('|') + ')\\b', 'i');
  const STATE_CITY_RE = new RegExp('\\b(' + Object.keys(STATE_BY_CITY).sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.]/g, '\\.')).join('|') + ')(?![A-Za-z])', 'i');
  const STATE_CODE_SET = new Set(US_STATES);

  // "Bellevue, WA" / "Dallas TX" / "Texas" / "Bay Area" / "TX" -> two-letter code, or '' when no US state is found.
  // Meant for location fields and short phrases; it takes the first state it finds.
  function usStateOf(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (/^[A-Z]{2}$/.test(s)) return STATE_CODE_SET.has(s) ? s : '';
    if (/\bWashington,?\s+D\.?C\.?(?![A-Za-z])|(?:^|[\s,(])D\.C\.(?![A-Za-z])/i.test(s)) return 'DC';
    // "City, ST" (any comma-separated uppercase code) and "(TX)"
    const re = /(?:,|\()\s*([A-Z]{2})\b(?![A-Za-z])/g;
    let m;
    while ((m = re.exec(s))) if (STATE_CODE_SET.has(m[1])) return m[1];
    // "Dallas TX 75201" - a bare code only at the end of the place name
    const tail = /\b[A-Z][a-z][A-Za-z.'-]*\s+([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:\([^)]*\))?\s*$/.exec(s);
    if (tail && STATE_CODE_SET.has(tail[1])) return tail[1];
    const name = STATE_NAME_RE.exec(s);
    if (name) return STATE_BY_NAME[name[1].toLowerCase()];
    const city = STATE_CITY_RE.exec(s);
    if (city) return STATE_BY_CITY[city[1].toLowerCase()];
    return '';
  }

  // A local-only requirement (lead.localOnly + lead.localState) needs a consultant who is already in that state
  // or says they will relocate. Anything else about the lead matches as before.
  const RELOCATE_YES = /^(?:yes|y|true|willing|open|ready)\b|\bwilling\b|\bopen\s+to\s+relocat/i;
  function consultantFitsLocal(consultant, lead) {
    if (!lead || !lead.localOnly) return true;
    const want = String(lead.localState || '').toUpperCase();
    if (!want) return true;   // local-only, but the state could not be read: do not hide anyone
    const c = consultant || {};
    if (RELOCATE_YES.test(String(c.relocation || '').trim())) return true;
    return usStateOf(c.location) === want;
  }

  // Subject and body of an application email for a job opening. Pure; the drawer opens it in the
  // user's mail client and never sends it. Empty profile fields are left out, not shown as placeholders.
  function buildJobApplication(job, profile) {
    const j = job || {};
    const p = profile || {};
    const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 300);
    const name = clean(p.name, 80);
    const title = clean(j.title, 100) || 'open position';
    const first = j.contactName && !/^recruiter/i.test(String(j.contactName)) ? String(j.contactName).trim().split(/\s+/)[0] : '';
    const lines = [first ? `Hi ${first},` : 'Hi,', ''];
    const company = clean(j.company, 80);
    lines.push(`I came across your ${title} opening${company ? ' at ' + company : ''} and would like to apply.`);
    const mine = clean(p.title, 100);
    if (mine) lines.push(`I am a ${mine}.`);
    const summary = clean(p.summary, 500);
    if (summary) lines.push('', summary);
    const contact = [];
    const phone = clean(p.phone, 40);
    const linkedin = clean(p.linkedin, 200);
    if (phone) contact.push(`Phone: ${phone}`);
    if (linkedin) contact.push(`LinkedIn: ${linkedin}`);
    if (contact.length) lines.push('', ...contact);
    lines.push('', 'My résumé is attached.', '', 'Thank you,');
    if (name) lines.push(name);
    return { subject: `Application: ${title} – ${name || 'your name'}`, body: lines.join('\n') };
  }

  Object.assign(root.BP, { US_STATE_CODES: US_STATES.slice(), US_STATE_BY_NAME: STATE_BY_NAME, usStateOf, consultantFitsLocal, buildJobApplication });
})(typeof self !== 'undefined' ? self : globalThis);

// Lets node tests load the pure helpers (no chrome APIs are touched at load time).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof self !== 'undefined' ? self : globalThis).BP;
}
