// lib/email-extract.js - find email addresses in text a recruiter can see on screen.
//
//   BP.extractEmails(text)     -> unique, lower-case addresses found in the text, in order
//   BP.cleanEmail(raw)         -> one cleaned address or null (also used for mailto: links)
//   BP.inCommentOrMessagingZone(el) -> true when a DOM element sits inside a comment thread or a
//                                      messaging overlay (those emails are never the post's contact)
//
// Accepted forms: john@abc.com, john [at] abc [dot] com, john(at)abc(dot)com, and the plain-word form
// "john.smith at abc dot com" (both words) or "email me at john at abc.com" (an email cue before it).
// Plain English is not an email: "Java developer at google.com" and "2:30 pm EST at abc.com" are rejected.
// Pure: no DOM access (the zone helper only calls el.closest), no storage, no clock.

(function (root) {
  'use strict';

  if (!root.BP && typeof require === 'function') require('./shared.js');
  const BP = root.BP = root.BP || {};

  const INVALID_FILE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff|woff|woff2|ttf|eot|css|js|map|mp4|mp3|pdf|zip|gz)$/i;

  // Common English words (and time zones) that show up before " at " in ordinary sentences.
  const STOP_LOCALS = new Set([
    'me', 'us', 'we', 'you', 'them', 'him', 'her', 'it', 'they', 'is', 'am', 'are', 'be', 'at', 'on', 'in', 'to', 'of', 'or', 'and', 'the', 'a', 'an',
    'for', 'by', 'from', 'with', 'who', 'what', 'when', 'where', 'how', 'now', 'here', 'there', 'then', 'also', 'only', 'any', 'all',
    'available', 'needed', 'need', 'required', 'hiring', 'looking', 'open', 'based', 'located', 'work', 'working', 'remote', 'onsite', 'hybrid',
    'developer', 'developers', 'engineer', 'engineers', 'analyst', 'architect', 'consultant', 'consultants', 'manager', 'lead', 'admin', 'administrator',
    'tester', 'recruiter', 'recruiters', 'candidate', 'candidates', 'resume', 'resumes', 'profile', 'profiles', 'position', 'positions', 'role', 'roles',
    'requirement', 'requirements', 'job', 'jobs', 'opening', 'openings', 'client', 'vendor', 'team', 'company', 'office', 'today', 'tomorrow', 'monday', 'tuesday',
    'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'am', 'pm', 'est', 'edt', 'cst', 'cdt', 'mst', 'mdt', 'pst', 'pdt', 'ist', 'gmt', 'utc', 'et', 'ct', 'mt', 'pt',
    'rate', 'visa', 'location', 'duration', 'contract', 'fulltime', 'email', 'mail', 'phone', 'call', 'text', 'contact', 'reach', 'send', 'share',
    'google', 'amazon', 'microsoft', 'java', 'python', 'net', 'aws', 'azure', 'sap', 'sql'
  ]);

  const GLUE_WORDS = 'phone|mobile|contact|cell|email|e-?mail|tel|ph|call|location|skype|whatsapp|linkedin|website|mob|direct|fax|ext';
  const TLD_GLUE_RE = new RegExp('^([a-z]{2,24}?)(?:' + GLUE_WORDS + ')$', 'i');
  const EMAIL_CUE_RE = /\b(?:e-?mail|mail|send|reach|contact|resumes?\s+to|profiles?\s+to|share\s+(?:\w+\s+)?to|forward)\b/i;
  const WELL_KNOWN_TLDS = new Set(['com', 'net', 'org', 'io', 'info', 'biz', 'edu', 'gov', 'dev', 'tech', 'app', 'cloud', 'solutions', 'group', 'llc', 'inc',
    'ai', 'co', 'us', 'consulting', 'systems', 'global', 'services', 'software', 'online', 'xyz']);

  const LOCAL_CH = "A-Za-z0-9.!#$%&'*+/=?^_`{|}~-";
  // Real @ addresses. The domain takes any letters, so a glued word ("abc.comPhone") is trimmed afterwards.
  const AT_RE = new RegExp('([' + LOCAL_CH + ']+)@([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z][A-Za-z0-9-]*)', 'g');
  // "john.smith at abc dot com": the word "at" plus at least one word "dot"
  const WORD_BOTH_RE = /([A-Za-z0-9._%+-]+)\s+at\s+([A-Za-z0-9-]+(?:\s+dot\s+[A-Za-z0-9-]+)+)(?![A-Za-z0-9-])/gi;
  // "send to john at abc.com": the word "at" and a real dotted domain; accepted only after an email cue
  const WORD_CUE_RE = /([A-Za-z0-9._%+-]+)\s+at\s+((?:[A-Za-z0-9-]+\.)+[A-Za-z][A-Za-z0-9-]*)/gi;

  function knownTld(tld) {
    return /^[a-z]{2}$/.test(tld) || WELL_KNOWN_TLDS.has(tld);
  }

  // "abc.comPhone" / "abc.com972" -> "abc.com". Splits only at a lower->UPPER boundary, a known glue word
  // after a known TLD, or digits after letters, so real TLDs are never cut.
  function trimDomain(domain) {
    const labels = domain.split('.');
    let last = labels.pop();
    let m;
    if ((m = /^([a-z]{2,24})(?=[A-Z0-9])/.exec(last))) {
      last = m[1];
    } else if ((m = TLD_GLUE_RE.exec(last)) && knownTld(m[1].toLowerCase())) {
      last = m[1];
    } else {
      last = last.replace(/^([A-Za-z]{2,24})[0-9-].*$/, '$1');
    }
    labels.push(last);
    return labels.join('.');
  }

  const RFC_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  // Validates and lower-cases one candidate. wordForm: the address came from plain words (stricter).
  function finish(local, domain, wordForm) {
    local = String(local).replace(/^[^A-Za-z0-9]+|[.\-+_]+$/g, '');
    domain = trimDomain(String(domain).replace(/[.\-]+$/, ''));
    const email = (local + '@' + domain).toLowerCase();
    if (!RFC_RE.test(email) || INVALID_FILE_EXTENSIONS.test(email)) return null;
    const tld = domain.split('.').pop().toLowerCase();
    if (!/^[a-z]{2,24}$/.test(tld) || domain.length < 4) return null;
    if (wordForm) {
      const l = local.toLowerCase();
      if (STOP_LOCALS.has(l) || !/[a-z]/.test(l) || /^\d+(?:am|pm|st|nd|rd|th)$/.test(l)) return null;
      if (!knownTld(tld)) return null;
    }
    return email;
  }

  function normalizeObfuscation(text) {
    return String(text)
      .replace(/\s*[\[(\{]\s*at\s*[\]\)\}]\s*/gi, '@')
      .replace(/\s*\[\s*@\s*\]\s*/g, '@')
      .replace(/\s*[\[(\{]\s*dot\s*[\]\)\}]\s*/gi, '.')
      .replace(/\s*\[\s*\.\s*\]\s*/g, '.');
  }

  // One raw candidate (a mailto: href, "x [at] y [dot] com", "x@y.com").
  function cleanEmail(raw) {
    if (!raw) return null;
    let s = String(raw).trim().replace(/^mailto:/i, '');
    s = normalizeObfuscation(s);
    s = s.replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.');
    s = s.replace(/[?,;:'"()<>{}\[\]\s\\]/g, '');
    const at = s.lastIndexOf('@');
    if (at < 1) return null;
    return finish(s.slice(0, at), s.slice(at + 1), false);
  }

  function extractEmails(text) {
    if (!text) return [];
    const src = normalizeObfuscation(String(text).replace(/ /g, ' '));
    const out = [];
    const add = (e) => { if (e && !out.includes(e)) out.push(e); };

    let m;
    AT_RE.lastIndex = 0;
    while ((m = AT_RE.exec(src))) add(finish(m[1], m[2], false));

    WORD_BOTH_RE.lastIndex = 0;
    while ((m = WORD_BOTH_RE.exec(src))) add(finish(m[1], m[2].replace(/\s+dot\s+/gi, '.'), true));

    WORD_CUE_RE.lastIndex = 0;
    while ((m = WORD_CUE_RE.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 30), m.index + m[1].length);
      if (EMAIL_CUE_RE.test(before)) add(finish(m[1], m[2], true));
    }
    return out;
  }

  // Comment threads and messaging overlays: an address there belongs to a commenter or a chat, not to the post.
  const EXCLUDED_ZONES = [
    '[class*="comments-"]', '[class*="comments_"]', '[class*="comment-item"]', 'article[data-id*="comment"]', '[data-urn*="comment"]',
    '.msg-overlay', '#msg-overlay', '[class*="msg-"]'
  ].join(', ');
  function inCommentOrMessagingZone(el) {
    try { return Boolean(el && el.closest && el.closest(EXCLUDED_ZONES)); } catch (_) { return false; }
  }

  Object.assign(BP, { extractEmails, cleanEmail, inCommentOrMessagingZone, EMAIL_EXCLUDED_ZONES: EXCLUDED_ZONES });
})(typeof self !== 'undefined' ? self : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof self !== 'undefined' ? self : globalThis).BP;
}
