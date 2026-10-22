// lib/requirement.js - v1.7 requirement fields read from a LinkedIn post, for the duplicate / RTR guard.
// Best effort and never invented: a field that the post does not state is simply absent.
//
//   BP.parseRequirementFields(text, { now }) -> {
//     endClient, jobId, rate: { min, max, unit, terms, text }, visaAllowed: [], visaNotAllowed: [], visaNote,
//     duration, deadline (ISO date, only when clear), deadlineText, endClientHidden, sources: { <field>: 'post' } }
//   BP.sanitizeRequirementFields(lead)  the valid subset the service worker saves
//   BP.normalizeCompanyKey(name)   comparison key: case, punctuation, Inc / LLC / Corp, "via" chains removed
//   BP.isUnknownClientName(name)   "Confidential", "TBD", "a leading bank" ...
//
// Pure and deterministic: no DOM, no storage. The clock is only read through `opts.now` (ms), used to turn
// "Friday" or "10/12" into a date. Needs lib/shared.js and lib/classify.js (negation rules for rate terms).

(function (root) {
  'use strict';
  if (!root.BP && typeof require === 'function') require('./shared.js');
  if (!(root.BP && root.BP.extractPostTags) && typeof require === 'function') require('./classify.js');
  const BP = root.BP;

  const DAY = 86400000;

  function cleanText(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/[*`]+/g, '').replace(/[   ]/g, ' ');
  }
  // One-line posts: a value must stop at a pipe, bullet, sentence end or the next known label.
  const ABBREV = /(?:^|[\s(])(?:sr|jr|st|mr|mrs|ms|dr|no|vs|inc|corp|ltd|co|u\.s|a\.m|p\.m|e\.g|i\.e|approx|min|max|yrs|exp|[A-Za-z])$/i;
  const LABEL_BREAK = /(?<!(?:end|direct|final)\s)(?<=\S)\s+(?=(?:(?:end|direct|final)\s+client|client|job\s*(?:id|code)|position\s+id|req(?:uisition)?\s*(?:id|#)|jd\s*#|rate|pay\s+rate|salary|visa|work\s+auth\w*|duration|contract\s+duration|location|submit|submission|deadline|closing)\s*[:#])/gi;
  function segmentsOf(line) {
    const out = [];
    for (const part of line.split(/\s+[|\u2022\u25cf\u00b7]\s+|\s*\u2022\s*/)) {
      for (const piece of part.split(LABEL_BREAK)) {
        let start = 0;
        const re = /\.\s+(?=[A-Z$(0-9])/g;
        let m;
        while ((m = re.exec(piece))) {
          if (ABBREV.test(piece.slice(start, m.index))) continue;
          out.push(piece.slice(start, m.index + 1).trim());
          start = m.index + m[0].length;
        }
        out.push(piece.slice(start).trim());
      }
    }
    return out.filter(Boolean);
  }

  function linesOf(text) {
    return cleanText(text).split('\n').map(l => l.replace(/^[\s•●▪‣\-–—>→➤✅✔►⭐📌📍]+(?=[A-Za-z$])/u, '').trim()).filter(Boolean).flatMap(segmentsOf);
  }

  // ── Company name comparison ────────────────────────────────────────────────
  const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
    'plc', 'pvt', 'private', 'gmbh', 'sa', 'ag', 'pllc']);
  const CHAIN_SPLIT = /\s+(?:via|through|thru|c\/o|care\s+of)\s+|\s+(?:->|→)\s+/i;

  // "Toyota (via Infosys)" -> "Toyota"; "Infosys via TCS" -> "Infosys". The end client is always the first part.
  function headOfChain(name) {
    let s = String(name || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\(\s*(?:via|through|thru|c\/o)\b[^)]*\)?/i, ' ');
    return s.split(CHAIN_SPLIT)[0].trim();
  }

  // Display form: first part of a "via" chain, trailing Inc / LLC / Corp dropped, original case kept.
  function stripCompanySuffix(name) {
    const words = headOfChain(name).replace(/[,;]+\s*$/, '').split(/\s+/).filter(Boolean);
    let end = words.length;
    while (end > 1 && SUFFIXES.has(words[end - 1].toLowerCase().replace(/[.,]/g, ''))) end--;
    return words.slice(0, end).join(' ').replace(/[,\s]+$/, '');
  }

  // Comparison key: lower case, accents, "&" -> "and", punctuation, "the", legal suffixes and "via" chains removed.
  function normalizeCompanyKey(name) {
    let s = headOfChain(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    s = s.replace(/&/g, ' and ').replace(/\bl\.l\.c\b/g, 'llc').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    let words = s.split(' ').filter(Boolean);
    if (words[0] === 'the' && words.length > 1) words = words.slice(1);
    let end = words.length;
    while (end > 1 && SUFFIXES.has(words[end - 1])) end--;
    return words.slice(0, end).join(' ');
  }

  const UNKNOWN_CLIENT = /^(?:confidential|undisclosed|not\s+(?:disclosed|shared|mentioned|specified)|tbd|tba|n\/?a|na|none|nil|unknown|will\s+(?:be\s+)?(?:share|shared|disclose|disclosed|provide|provided)|to\s+be\s+(?:shared|disclosed|announced|decided|determined)|shared\s+(?:on|upon|after|later)|upon\s+|on\s+request|client\s+name|direct\s+client|end\s+client|fortune\s*\d|top[\s-]tier|top\s+\d|tier\s*\d|(?:a|an|one\s+of)\s+(?:the\s+)?(?:leading|large|top|major|big|well[\s-]known|reputed|reputable|global|fortune|premier|prestigious)|(?:leading|large|major|big|well[\s-]known|reputed|global|premier|prestigious)\s+)/i;
  function isUnknownClientName(name) {
    const s = String(name || '').trim();
    return !s || !/[A-Za-z]/.test(s) || UNKNOWN_CLIENT.test(s) || /\bconfidential\b|\bundisclosed\b/i.test(s);
  }

  // ── End client ─────────────────────────────────────────────────────────────
  // "Client: X", "End client: X", "Direct client: X", "Client - X". A hyphen needs spaces around it ("client-facing" is prose).
  const CLIENT_LABEL = /(?:^|[^A-Za-z])((?:end|direct|final)[\s-]*client|client(?:\s+name)?)\s*(?:[:–—]|\s[-]\s)\s*([^\n]+)/i;
  function endClientOf(lines) {
    for (const line of lines) {
      const m = CLIENT_LABEL.exec(line);
      if (!m) continue;
      let v = m[2];
      v = v.split(/\s+[|•]\s+|\s*;\s*|\s{3,}/)[0];
      v = v.replace(/\s*\((?!\s*(?:via|through|thru)\b)[^)]*\)?\s*$/i, '');   // "(Plano, TX)" or "(Hybrid)"
      v = headOfChain(v);
      v = v.replace(/^[\s"'“‘]+|[\s"'”’.,:;]+$/g, '');
      v = v.replace(/,\s*[A-Z]{2}\b.*$/, '').replace(/\s+-\s+.*$/, '');        // "Toyota, Plano TX", "Toyota - Plano"
      v = stripCompanySuffix(v);
      if (!v || v.length < 2 || v.length > 60 || v.split(/\s+/).length > 6) continue;
      if (isUnknownClientName(v)) return { unknown: true };
      if (/^(?:interview|location|round|manager|contact|visit|call|name|lead|team|side|facing|onboarding)\b/i.test(v)) continue;
      return { name: v };
    }
    return null;
  }

  // ── Job ID ─────────────────────────────────────────────────────────────────
  // Strong labels: "Job ID", "Req #", "Requisition 12", "JD#", "Position ID". Weak labels (bare "Ref", "Req", "Job #") need a longer value.
  const JOB_LABEL = /(?:^|[^A-Za-z])(?:(job|position|opening|requisition|requirement|req|ref(?:erence)?|jd|ticket)\s*(?:id|code|no\.?|number|num|#)|(requisition|req|ref(?:erence)?|jd|job)\s*(?:[:#]|\s-\s)|(requisition)\s+(?=[A-Za-z0-9\-_/.]*\d))\s*(?:[:#–—-]\s*)?(?:no\.?\s*)?([A-Za-z0-9][A-Za-z0-9\-_/.]{1,28})/i;
  const PHONEISH = /^(?:\+?1?[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}$/;
  const DATEISH = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/;
  function jobIdOf(lines) {
    for (const line of lines) {
      const m = JOB_LABEL.exec(line);
      if (!m) continue;
      const bare = Boolean(m[2] || m[3]);   // label had no "id/no/#" word
      let v = m[4].replace(/[.\-_/]+$/, '');
      if (!/\d/.test(v)) continue;                                  // a real id has a digit ("Ref: Java" is not one)
      if (v.length < (bare ? 4 : 3) || v.length > 24) continue;
      if (/^\d{10,11}$/.test(v) || PHONEISH.test(v)) continue;     // never a phone number (bug B6)
      if (DATEISH.test(v)) continue;
      // The label sits inside a sentence about experience / years, or the "id" is the start of a phone line.
      if (/\b(?:years?|yrs?|months?|exp)\b/i.test(line.slice(m.index, m.index + m[0].length + 12))) continue;
      if (/\b(?:phone|cell|mobile|call|tel|fax|whatsapp|contact)\b[^A-Za-z]{0,6}$/i.test(line.slice(0, m.index + 1))) continue;
      return v;
    }
    return '';
  }

  // ── Rate ───────────────────────────────────────────────────────────────────
  const UNIT_WORDS = { hr: 'hr', hour: 'hr', hrs: 'hr', hours: 'hr', h: 'hr', day: 'day', week: 'week', wk: 'week', month: 'month', mo: 'month',
    yr: 'year', year: 'year', annum: 'year', annual: 'year', pa: 'year', yearly: 'year' };
  const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d{1,2})?)';
  const UNIT_AFTER = '(?:\\s*(?:\\/|per\\s+|an?\\s+|\\s)\\s*(hrs?|hours?|h|day|week|wk|month|mo|yrs?|year|annum|pa)\\b|\\s*(annual|yearly)\\b)?';
  const RATE_RANGE = new RegExp('(\\$)?\\s*' + NUM + '\\s*(k)?\\s*(?:-|\\u2013|\\u2014|to)\\s*(\\$)?\\s*' + NUM + '\\s*(k)?' + UNIT_AFTER, 'i');
  const RATE_SINGLE = new RegExp('(\\$)\\s*' + NUM + '\\s*(k)?' + UNIT_AFTER, 'i');
  const RATE_SINGLE_BARE = new RegExp('(^|[^\\w$.])' + NUM + '\\s*(k)?' + UNIT_AFTER, 'i');
  const RATE_LABEL = /(?:^|[^A-Za-z])(?:(?:pay|bill|hourly|contract|max|target|budget(?:ed)?)\s+)?(?:rate|rates|salary|compensation|pay|budget|ctc)\s*(?:[:–—=]|\s-\s|\bis\b|\bup\s+to\b)\s*([^\n]*)/i;
  const DOE = /^\W*(?:doe|d\.o\.e|depends\s+on\s+experience|open|negotiable|market|best|as\s+per\s+market|competitive|flexible|tbd|to\s+be\s+discussed)\b/i;

  function numOf(s) { return Number(String(s).replace(/,/g, '')); }

  // Rate terms read next to the rate: "C2C", "W2", "1099". A negated one ("No C2C") is not a term.
  function rateTerms(snippet) {
    const eng = BP.extractPostTags(snippet).engagement || [];
    return eng.filter(k => k === 'c2c' || k === 'w2' || k === '1099').map(k => (k === 'c2c' ? 'C2C' : k === 'w2' ? 'W2' : '1099')).join(' / ');
  }

  function rateFromMatch(m, rangeForm, lineRest, allowBareUnit) {
    let lo, hi, k1, k2, dollar, unitRaw;
    if (rangeForm) {
      dollar = Boolean(m[1] || m[4]); k1 = Boolean(m[3]); k2 = Boolean(m[6]);
      lo = numOf(m[2]); hi = numOf(m[5]); unitRaw = m[7] || m[8] || '';
    } else {
      dollar = Boolean(m[1]); k1 = Boolean(m[3]); k2 = k1;
      lo = hi = numOf(m[2]); unitRaw = m[4] || m[5] || '';
    }
    if (k1 || k2) { if (k1 || (k2 && lo < 1000)) lo *= 1000; if (k2) hi *= 1000; }
    if (!(lo > 0) || !(hi > 0) || lo > hi) return null;
    let unit = UNIT_WORDS[String(unitRaw).toLowerCase()] || '';
    if (!unit) {
      if (hi >= 20000) unit = 'year';
      else if (dollar && hi <= 250) unit = 'hr';   // "$65" in a contract post is hourly
      else if (allowBareUnit && hi >= 10 && hi <= 250) unit = 'hr';
    }
    if (unit === 'hr' && (lo < 8 || hi > 600)) return null;
    if (unit === 'year' && hi < 15000) return null;
    if (!unit && !dollar) return null;
    return { min: lo, max: hi, unit };
  }

  function rateOf(lines) {
    // 1. A labelled line: "Rate: $65/hr on C2C", "Pay Rate - 60-65 C2C".
    for (const line of lines) {
      const lm = RATE_LABEL.exec(line);
      if (!lm) continue;
      const rest = lm[1];
      if (DOE.test(rest) && !/\d/.test(rest.slice(0, 12))) return { min: null, max: null, unit: '', terms: rateTerms(rest), text: rest.replace(/\s+/g, ' ').trim().slice(0, 40) };
      for (const [re, range] of [[RATE_RANGE, true], [RATE_SINGLE, false], [RATE_SINGLE_BARE, false]]) {
        const m = re.exec(range ? rest : (re === RATE_SINGLE_BARE ? ' ' + rest : rest));
        if (!m) continue;
        const r = rateFromMatch(re === RATE_SINGLE_BARE ? [m[0], undefined, m[2], m[3], m[4], m[5]] : m, range, rest, true);
        if (!r) continue;
        const after = rest.slice(m.index + m[0].length, m.index + m[0].length + 40);
        const before = rest.slice(0, m.index + m[0].length);
        const terms = rateTerms(before + ' ' + after);
        const text = (before + after.split(/[|\n;]/)[0]).replace(/\s+/g, ' ').replace(/[.,;\s]+$/, '').trim().slice(0, 60);
        return { ...r, terms, text };
      }
    }
    // 2. Anywhere: a dollar amount that says per hour ("$55-60/hr", "$70 per hour C2C").
    for (const line of lines) {
      for (const re of [RATE_RANGE, RATE_SINGLE]) {
        const m = re.exec(line);
        if (!m) continue;
        const range = re === RATE_RANGE;
        const unitRaw = range ? (m[7] || m[8]) : (m[4] || m[5]);
        const dollar = range ? (m[1] || m[4]) : m[1];
        if (!dollar || !unitRaw) continue;
        const r = rateFromMatch(m, range, line, false);
        if (!r) continue;
        const after = line.slice(m.index + m[0].length, m.index + m[0].length + 40);
        const terms = rateTerms(line.slice(Math.max(0, m.index - 30), m.index + m[0].length) + ' ' + after);
        const text = (m[0] + after.split(/[|\n;,]/)[0]).replace(/\s+/g, ' ').replace(/[.,;\s]+$/, '').trim().slice(0, 60);
        return { ...r, terms, text };
      }
    }
    return null;
  }

  // ── Visa ───────────────────────────────────────────────────────────────────
  // Order matters: longer names first so "GC EAD" is not read as "GC" and "STEM OPT" not as "OPT".
  const VISA_TOKENS = [
    ['GC-EAD', 'gc[\\s-]*ead|green[\\s-]*card[\\s-]*ead'],
    ['H4-EAD', 'h-?4(?:[\\s-]*ead)?'],
    ['L2-EAD', 'l-?2(?:[\\s-]*ead)?'],
    ['STEM OPT', 'stem[\\s-]*opt'],
    ['OPT', 'opt(?:[\\s-]*ead)?'],
    ['CPT', 'cpt'],
    ['H1B', 'h-?1-?b|h-?1(?![\\d])'],
    ['USC', 'usc|u\\.s\\.?\\s*citizen(?:ship)?s?|us[\\s-]*citizen(?:ship)?s?|citizen(?:ship)?s?'],
    ['GC', 'gc|green[\\s-]*cards?'],
    ['TN', 'tn(?:\\s+visa)?'],
    ['EAD', 'ead']
  ];
  const TOKEN_ALT = VISA_TOKENS.map(([, re]) => '(?:' + re + ')').join('|');
  const RUN_RE = new RegExp('(?<![A-Za-z0-9])(?:' + TOKEN_ALT + ')(?![A-Za-z0-9])(?:\\s*(?:[,/&+|]|\\band\\b|\\bor\\b)\\s*(?:' + TOKEN_ALT + ')(?![A-Za-z0-9]))*', 'gi');
  const ONE_RES = VISA_TOKENS.map(([code, re]) => [code, new RegExp('^(?:' + re + ')$', 'i')]);
  const TOKEN_G = new RegExp('(?<![A-Za-z0-9])(?:' + TOKEN_ALT + ')(?![A-Za-z0-9])', 'gi');
  const VISA_LABEL = /\b(?:visa|work\s*auth\w*|authori[sz]ation|eligib\w*|citizenship|immigration|status)\b/i;
  const NEG_VISA_BEFORE = /\b(?:no|not|non|without|except|excluding?|exclude|cannot|can'?t|unable|nobody|none)\W+(?:(?:any|the|for|on|of|accepting|accept|considering|consider|allowing|allow|open\s+to|candidates?\s+on|candidates?\s+with|with|visa|visas)\W+)*$/i;
  const NEG_VISA_AFTER = /^\W*(?:(?:visa|visas|candidates?|profiles?|transfers?|consultants?|resumes?)\W+)*(?:(?:is|are|will|can|do|does)\W+)?(?:not|n'?t|never|no)\W+(?:be\W+)?(?:allowed|accepted|acceptable|considered|eligible|open|ok|okay|permitted|available|entertained|welcome|work|apply)\b/i;
  const ONLY_AFTER = /^\W*(?:visa\W+|candidates?\W+|profiles?\W+|consultants?\W+|holders?\W+|resumes?\W+)*only\b/i;
  const ONLY_BEFORE = /\bonly\W+(?:(?:for|to|with|on|from)\W+)*(?:(?:the|a)\W+)?$/i;
  const OK_AFTER = /^\W*(?:visa\W+|candidates?\W+|profiles?\W+|consultants?\W+|holders?\W+)*(?:are\s+|is\s+|will\s+be\s+)?(?:ok|okay|accepted|allowed|welcome|considered|eligible|fine|preferred|can\s+apply|apply)\b/i;
  const OK_BEFORE = /\b(?:open\s+to|accept(?:ing|s)?|allow(?:ing|s)?|consider(?:ing|s)?|welcome|eligible|preferred|prefer|only)\W+(?:(?:for|to|with|on|from|the|any|all)\W+)*$/i;
  const INDEPENDENT = /\bindependent\s+(?:visa|only)\b/i;
  const ANY_VISA = /\b(?:any|all)\s+visas?\b(?:\W+(?:ok|okay|accepted|allowed|welcome))?/i;

  function codesOf(run) {
    const out = [];
    TOKEN_G.lastIndex = 0;
    let m;
    while ((m = TOKEN_G.exec(run))) {
      const code = (ONE_RES.find(([, re]) => re.test(m[0].trim())) || [])[0];
      if (code && !out.includes(code)) out.push(code);
    }
    return out;
  }
  function visaNoteOf(line) { return line.replace(/\s+/g, ' ').trim().slice(0, 100); }

  function visaOf(lines) {
    const allowed = [];
    const notAllowed = [];
    const noteParts = [];
    const add = (list, codes) => codes.forEach(c => { if (!list.includes(c)) list.push(c); });
    for (const line of lines) {
      if (line.length > 400) continue;
      let used = false;
      const labelled = VISA_LABEL.test(line);
      if (INDEPENDENT.test(line)) { add(notAllowed, ['H1B']); used = true; }
      RUN_RE.lastIndex = 0;
      let m;
      while ((m = RUN_RE.exec(line))) {
        let codes = codesOf(m[0]);
        // "TN" is also Tennessee: only a visa when the line talks about visas or sits in a list with another visa.
        if (codes.includes('TN') && !(labelled || codes.length > 1 || /\btn\s+visa\b/i.test(m[0])) ) codes = codes.filter(c => c !== 'TN');
        if (/^tn\b/i.test(m[0]) && /[A-Z][a-z]+,\s*$/.test(line.slice(Math.max(0, m.index - 24), m.index)) && !/\bvisa\b/i.test(m[0])) codes = codes.filter(c => c !== 'TN');
        if (!codes.length) continue;
        // A comma ends what a negation or "ok" is attached to: "No OPT/CPT, H1B ok" is two parts. A negated part
        // passes its "no" on to a following bare part ("No OPT, CPT") but not to one with its own positive word.
        const runEnd = m.index + m[0].length;
        const runAfter = line.slice(runEnd, runEnd + 45);
        let offset = m.index;
        let prevNeg = false;
        for (const part of m[0].split(/(?<=,)/)) {
          const text = part.replace(/,\s*$/, '').trim();
          const pcodes = codesOf(text).filter(c => codes.includes(c));
          const start = offset;
          offset += part.length;
          if (!pcodes.length) continue;
          const isLast = offset >= runEnd;
          const before = line.slice(Math.max(0, start - 40), start);
          const after = isLast ? runAfter : '';
          const positive = ONLY_AFTER.test(after) || OK_AFTER.test(after);
          // "H1B, OPT not accepted": a negative word after the whole run covers a part that has no positive word of its own.
          const neg = NEG_VISA_BEFORE.test(before) || NEG_VISA_AFTER.test(isLast ? after : runAfter) && !positive
            || (prevNeg && !positive);
          prevNeg = neg;
          const only = !neg && (ONLY_AFTER.test(after) || ONLY_BEFORE.test(before));
          const ok = !neg && (only || OK_AFTER.test(after) || OK_BEFORE.test(before) || labelled || codes.length >= 2);
          if (neg) { add(notAllowed, pcodes); used = true; }
          else if (ok) { add(allowed, pcodes); used = true; }
        }
      }
      if (ANY_VISA.test(line) && !/\bno\s+any\b/i.test(line) && (labelled || /\bany\s+visa\b/i.test(line))) used = true;
      if (used) noteParts.push(visaNoteOf(line));
    }
    const note = noteParts.join(' ').slice(0, 120);
    const allowedFinal = allowed.filter(c => !notAllowed.includes(c));
    return { visaAllowed: allowedFinal, visaNotAllowed: notAllowed, visaNote: note };
  }

  // ── Duration ───────────────────────────────────────────────────────────────
  const DUR_LABEL = /(?:^|[^A-Za-z])(?:contract\s+)?(?:duration|length|term|project\s+length|contract\s+length|tenure)\s*(?:[:–—]|\s-\s)\s*([^\n|;•]+)/i;
  const DUR_VALUE = /\d|long[\s-]*term|short[\s-]*term|ongoing|extension|extendable|perm|temp|month|year|annual|c2h|contract[\s-]*to/i;
  const DUR_AMOUNT = /\b(\d{1,2}\+?(?:\s*(?:-|–|to)\s*\d{1,2}\+?)?\s*(?:\+\s*)?(?:months?|mos?|years?|yrs?)(?:\s*\+)?)(?!\s*(?:of\s+)?(?:exp|experience))/i;
  const LONG_TERM = /\blong[\s-]*term\b/i;
  function durationOf(lines) {
    for (const line of lines) {
      const m = DUR_LABEL.exec(line);
      if (!m) continue;
      const v = m[1].replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim();
      if (v && v.length <= 40 && DUR_VALUE.test(v) && !/\bexp(?:erience)?\b/i.test(v)) return v;
    }
    for (const line of lines) {
      if (/\b(?:exp(?:erience)?|years?\s+of|yrs?\s+of|relevant|minimum|min\.?|at\s+least)\b/i.test(line) && !/\b(?:contract|extension|extendable|long[\s-]*term)\b/i.test(line)) continue;
      const am = DUR_AMOUNT.exec(line);
      if (am && (/\b(?:contract|duration|extension|extendable|project|assignment|renew\w*|possible)\b/i.test(line) || /\+\s*months?\b/i.test(am[0]))) return am[1].replace(/\s+/g, ' ').trim();
      if (LONG_TERM.test(line) && /\b(?:contract|project|duration|assignment|role|engagement)\b/i.test(line)) return 'Long term';
    }
    return '';
  }

  // ── Deadline ───────────────────────────────────────────────────────────────
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DEADLINE_CUE = /\b(?:submit(?:ted|ting)?|submissions?|deadline|due|closing|closes|close\s+date|last\s+date|need(?:ed)?\s+(?:by|on)|(?:send|share)\s+(?:profiles?|resumes?)|respond|response|profiles?\s+(?:by|before))\b/i;
  const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DATE_NUM = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
  const DATE_MD = new RegExp('\\b' + MON_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i');
  const DATE_DM = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MON_RE + '\\.?(?:,?\\s+(\\d{4}))?\\b', 'i');
  const WEEKDAY_RE = /\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat|sun)(?:day)?\b/i;
  const REL_RE = /\b(today|tonight|tomorrow|eod|cob|eob)\b/i;
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoOf = (y, mo, d) => {
    const t = Date.UTC(y, mo - 1, d);
    const dt = new Date(t);
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${pad2(mo)}-${pad2(d)}` : '';
  };

  // A written date without a year takes the first year that puts it no earlier than ~30 days before `now`.
  function resolveYearless(mo, d, now) {
    if (!Number.isFinite(now)) return '';
    const y0 = new Date(now).getUTCFullYear();
    for (const y of [y0, y0 + 1]) {
      const iso = isoOf(y, mo, d);
      if (iso && Date.parse(iso + 'T00:00:00Z') >= now - 30 * DAY) return iso;
    }
    return '';
  }

  function deadlineOf(lines, now) {
    for (const line of lines) {
      const cue = DEADLINE_CUE.exec(line);
      if (!cue) continue;
      const rest = line.slice(cue.index, cue.index + 90);
      let chunk = '', iso = '';
      let m = DATE_NUM.exec(rest);
      if (m) {
        const mo = Number(m[1]), d = Number(m[2]);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          chunk = m[0];
          if (m[3]) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); iso = isoOf(y, mo, d); }
          else iso = resolveYearless(mo, d, now);
        } else m = null;
      }
      if (!chunk) {
        const mm = DATE_MD.exec(rest);
        const dm = !mm && DATE_DM.exec(rest);
        const hit = mm || dm;
        if (hit) {
          const monIdx = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
          const mo = mm ? monIdx(mm[1]) : monIdx(dm[2]);
          const d = Number(mm ? mm[2] : dm[1]);
          const yr = mm ? mm[3] : dm[3];
          chunk = hit[0];
          iso = yr ? isoOf(Number(yr), mo, d) : resolveYearless(mo, d, now);
        }
      }
      if (!chunk) {
        const wd = WEEKDAY_RE.exec(rest);
        const rel = REL_RE.exec(rest);
        if (wd) {
          chunk = wd[0];
          if (Number.isFinite(now)) {
            const idx = WEEKDAYS.findIndex(w => w.startsWith(wd[1].toLowerCase().slice(0, 3)));
            const today = new Date(now);
            const delta = (idx - today.getUTCDay() + 7) % 7;
            const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + delta));
            iso = isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
          }
        } else if (rel) {
          chunk = rel[0];
          if (Number.isFinite(now) && /^(?:today|tonight|eod|cob|eob)$/i.test(rel[1])) { const t = new Date(now); iso = isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
          else if (Number.isFinite(now) && /^tomorrow$/i.test(rel[1])) { const t = new Date(now + DAY); iso = isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
        }
      }
      if (!chunk) continue;
      // The text shown to the user: from the cue to the end of the date, e.g. "Submit by EOD Friday".
      const end = rest.toLowerCase().indexOf(chunk.toLowerCase()) + chunk.length;
      const text = (rest.slice(0, end) + rest.slice(end, end + 12).replace(/[.,;|].*$/, '')).replace(/\s+/g, ' ').replace(/[.,;:\s]+$/, '').trim().slice(0, 60);
      return { deadline: iso, deadlineText: text };
    }
    return null;
  }

  // ── Everything ─────────────────────────────────────────────────────────────
  function parseRequirementFields(text, opts) {
    const lines = linesOf(text);
    const now = opts && Number.isFinite(opts.now) ? opts.now : NaN;
    const out = {};
    const sources = {};
    const set = (k, v) => { out[k] = v; sources[k] = 'post'; };

    const client = endClientOf(lines);
    if (client && client.name) set('endClient', client.name);
    const jobId = jobIdOf(lines);
    if (jobId) set('jobId', jobId);
    const rate = rateOf(lines);
    if (rate) set('rate', rate);
    const visa = visaOf(lines);
    if (visa.visaAllowed.length) set('visaAllowed', visa.visaAllowed);
    if (visa.visaNotAllowed.length) set('visaNotAllowed', visa.visaNotAllowed);
    if (visa.visaNote) { out.visaNote = visa.visaNote; }
    const duration = durationOf(lines);
    if (duration) set('duration', duration);
    const dl = deadlineOf(lines, now);
    if (dl) {
      if (dl.deadline) set('deadline', dl.deadline);
      if (dl.deadlineText) out.deadlineText = dl.deadlineText;
    }
    if (client && client.unknown) out.endClientHidden = true;   // the post says the client is confidential
    if (Object.keys(sources).length) out.sources = sources;
    return out;
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  // What the service worker keeps of these fields on a lead (and a drawer patch): valid values only, short strings.
  const VISA_CODES = ['USC', 'GC', 'GC-EAD', 'H1B', 'H4-EAD', 'L2-EAD', 'OPT', 'STEM OPT', 'CPT', 'TN', 'EAD'];
  const RATE_UNITS = ['hr', 'day', 'week', 'month', 'year', ''];
  const str = (v, max) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
  const numOrNull = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 1e7 ? Number(v) : null);

  function sanitizeRequirementFields(lead) {
    const l = lead || {};
    const out = {};
    if (l.endClient !== undefined) out.endClient = str(l.endClient, 60);
    if (l.jobId !== undefined) { const j = str(l.jobId, 24); out.jobId = /^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(j) ? j : ''; }
    if (l.rate !== undefined) {
      const r = l.rate;
      out.rate = r && typeof r === 'object' && !Array.isArray(r)
        ? { min: numOrNull(r.min), max: numOrNull(r.max), unit: RATE_UNITS.includes(r.unit) ? r.unit : '', terms: str(r.terms, 30), text: str(r.text, 60) }
        : null;
    }
    for (const k of ['visaAllowed', 'visaNotAllowed']) {
      if (Array.isArray(l[k])) out[k] = VISA_CODES.filter(c => l[k].includes(c));
    }
    if (l.visaNote !== undefined) out.visaNote = str(l.visaNote, 100);
    if (l.duration !== undefined) out.duration = str(l.duration, 40);
    if (l.deadline !== undefined) out.deadline = /^\d{4}-\d{2}-\d{2}$/.test(str(l.deadline, 10)) ? str(l.deadline, 10) : '';
    if (l.deadlineText !== undefined) out.deadlineText = str(l.deadlineText, 60);
    if (l.endClientHidden !== undefined) out.endClientHidden = l.endClientHidden === true;
    if (l.fieldSources && typeof l.fieldSources === 'object' && !Array.isArray(l.fieldSources)) {
      const src = {};
      for (const k of ['endClient', 'jobId', 'rate', 'visaAllowed', 'visaNotAllowed', 'duration', 'deadline']) {
        if (l.fieldSources[k] === 'post' || l.fieldSources[k] === 'user') src[k] = l.fieldSources[k];
      }
      out.fieldSources = src;
    }
    return out;
  }

  Object.assign(BP, { parseRequirementFields, sanitizeRequirementFields, normalizeCompanyKey, stripCompanySuffix, isUnknownClientName, VISA_CODES });
})(typeof self !== 'undefined' ? self : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof self !== 'undefined' ? self : globalThis).BP;
}
