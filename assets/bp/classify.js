// lib/classify.js - Is this LinkedIn post a REQUIREMENT (someone hiring for one role) or a HOTLIST
// (another bench sales person advertising their available consultants)?
//
// Bench sales recruiters want requirements. A hotlist poster is a seller like them, not a lead.
// The decision is a plain sum of weighted signals so it stays explainable: every signal that fires
// adds a short human reason, and the top reasons are returned for the drawer tooltip.
//
//   BP.classifyPost({ text, headline }) -> { type, score, reasons, tags, jobTitle }
//     score  -100..100, positive = hotlist, negative = requirement
//     type   score >= 30 -> 'hotlist', score <= -20 -> 'requirement', otherwise 'unclear'
//            'recruiter-job' (score 0) = a company hiring a recruiter / bench sales / TA person for its OWN team:
//            a job for the user, not a consultant requirement (issue #44)
//     tags   { localOnly, localArea, localState, workMode, engagement } for every post
//     jobTitle  the recruiting role for 'recruiter-job', else null
//
// Pure and deterministic: no DOM, no storage, no clock.

(function (root) {
  'use strict';

  // Node tests load this file directly; the browser has shared.js loaded before it.
  if (!root.BP && typeof require === 'function') require('./shared.js');
  const BP = root.BP;

  const POST_TYPES = ['requirement', 'hotlist', 'recruiter-job', 'unclear'];
  const ENGAGEMENTS = ['c2c', 'w2', '1099', 'contract', 'fulltime', 'c2h'];
  const WORK_MODES = ['remote', 'hybrid', 'onsite'];
  const HOTLIST_AT = 30;
  const REQUIREMENT_AT = -20;

  // ── Role families ─────────────────────────────────────────────────────────
  // A hotlist lists consultants from many unrelated role families; a requirement is one role.
  // Order matters: a line gets the FIRST family that matches ("Java Full Stack" is Java, once).
  const FAMILIES = [
    ['Salesforce', /salesforce|\bsfdc\b|\bapex\b/i],
    ['SAP', /\bsap\b/i],
    ['ServiceNow', /service\s*now/i],
    ['Workday', /workday/i],
    ['Oracle/PeopleSoft', /\boracle\s*(?:ebs|apps|fusion|cloud|dba|developer)|peoplesoft/i],
    ['Mainframe', /mainframe|cobol|\bjcl\b/i],
    ['Data Engineer', /data\s*engineer|\betl\b|databricks|snowflake|pyspark|\bspark\b|big\s*data|informatica|hadoop|data\s*warehouse|\bdbt\b/i],
    ['AI/ML', /data\s*scien|machine\s*learning|\bml\b|\bai\b|gen\s*ai|generative|\bllm\b|\bnlp\b/i],
    ['BI', /power\s*bi|tableau|\bbi\s+(?:developer|analyst)/i],
    ['DevOps/SRE', /devops|\bsre\b|site\s*reliability|kubernetes|terraform|ci\s*\/\s*cd|platform\s*engineer/i],
    ['QA', /\bqa\b|tester|test\s*automation|\bsdet\b|selenium|quality\s*assurance/i],
    ['Business Analyst', /business\s*analyst|systems?\s*analyst|data\s*analyst|product\s*owner|\bba\b/i],
    ['Project/Scrum', /scrum\s*master|project\s*manager|program\s*manager|\bpmo\b/i],
    ['Security', /cyber|security\s*(?:engineer|analyst|architect)|\biam\b|\bsoc\b/i],
    ['Network', /network\s*(?:engineer|admin)|\bcisco\b|\bccna\b|\bccnp\b/i],
    ['DBA', /\bdba\b|database\s*admin/i],
    ['Mobile', /\bios\b|android|mobile\s*(?:developer|engineer)|flutter|react\s*native/i],
    ['.NET', /\.net\b|dot\s*net|\bc#|asp\.net/i],
    ['Python', /\bpython\b|django|flask/i],
    ['Java', /\bjava\b(?!\s*script)|j2ee|spring\s*boot|\bspring\b/i],
    ['Frontend/Node', /\breact(?:js)?\b|angular|\bvue\b|node\.?js|javascript|front\s*-?\s*end|\bui\s+developer|full\s*stack/i],
    ['Cloud', /\baws\b|azure|\bgcp\b|cloud\s*(?:engineer|architect|developer)/i]
  ];

  const ROLE_NOUN = /\b(?:developer|engineer|architect|analyst|administrator|admin|tester|qa|lead|manager|consultant|scientist|specialist|programmer|sdet|dba|devops|sre|designer|full\s*stack|master)\b/i;
  const EXP_TOKEN = /\b\d{1,2}\s*\+?\s*(?:yrs?|years?)\b/i;
  const VISA_TOKEN = /\b(?:h1b|h-1b|h4|gc|gc[-\s]?ead|green\s*card|usc|us\s*citizen|opt|cpt|tn|l2|ead)\b/i;
  const ENTRY_PREFIX = /^\s*(?:\d{1,2}\s*[).:\-]|[•*▪◦●➤➢✅✔►→\-–]|[\p{Extended_Pictographic}])/u;

  function familyOf(line) {
    for (const [name, re] of FAMILIES) if (re.test(line)) return name;
    return '';
  }

  // Lines that read like one consultant: short, a numbered/bulleted/piped line that names a role,
  // plus an experience, visa or "|" column structure.
  function entryLines(lines) {
    const out = [];
    for (const l of lines) {
      if (l.length > 170 || l.length < 6) continue;
      const pipes = (l.match(/\|/g) || []).length;
      const prefixed = ENTRY_PREFIX.test(l);
      const structured = pipes >= 1 || EXP_TOKEN.test(l) || VISA_TOKEN.test(l);
      const names = ROLE_NOUN.test(l) || familyOf(l);
      if ((prefixed || pipes >= 2) && structured && names) out.push(l);
    }
    return out;
  }

  // ── Phrase signals ────────────────────────────────────────────────────────
  // [regex, weight, reason]. Positive = hotlist, negative = requirement. Each fires at most once.
  const HOT_PHRASES = [
    [/\bhot\s*-?\s*list\b/i, 45, "says 'hotlist'"],
    [/\bavailable\s+(?:consultants?|candidates?|resources?|bench)\b|\bconsultants?\s+(?:are\s+)?available\b|\bbench\s+(?:consultants?|candidates?|resources?)\b|\bour\s+(?:\w+\s+)?bench\b/i, 40, "says 'available consultants'"],
    [/\b(?:(?:our|my)\s+(?:current\s+|top\s+|best\s+)?|we\s+have\s+(?:\w+\s+){0,2})(?:consultants?|candidates?)\b/i, 30, "says 'our consultants'"],
    [/\bi\s+have\s+(?:an?|one|two|three)\b[^.\n]{0,70}\b(?:available|consultant|candidate)\b/i, 30, 'offers one of their own consultants'],
    [/\b(?:share|send|forward|drop|email)\s+(?:me\s+)?(?:your\s+|the\s+|any\s+|all\s+|suitable\s+|relevant\s+|matching\s+|current\s+|open\s+)*(?:requirements?|reqs?|jds?|job\s+descriptions?|openings?)\b/i, 30, "asks to 'share your requirements'"],
    [/\blooking\s+for\s+(?:c2c\s+|w2\s+|new\s+|contract\s+)*(?:projects?|requirements?|opportunit(?:y|ies)|assignments?)\b/i, 30, "'looking for projects'"],
    [/\b(?:available|availability)\s+(?:for|on)\s+(?:new\s+)?(?:projects?|assignments?|c2c|w2|contract)\b|\bavailable\s+(?:immediately|now)\b|\bimmediately\s+available\b|\bavailable\s+for\s+immediate\b/i, 20, "'available for new projects'"],
    [/\bopen\s+to\s+(?:relocat\w+)|\bready\s+to\s+relocat\w+|\bwilling\s+to\s+relocat\w+/i, 15, "'open to relocate'"],
    [/\bmarketing\s+(?:my|our|the)\s+(?:consultants?|candidates?|bench)\b|\bbench\s+sales\b|\bbench\s+marketing\b/i, 25, 'mentions bench sales'],
    [/\bconsultants?\s+(?:profiles?|resumes?)\s+(?:are\s+)?(?:available|ready|attached)\b|\bresumes?\s+(?:available|on\s+request)\b/i, 20, 'consultant resumes on request']
  ];

  const REQ_PHRASES = [
    [/^\W*(?:urgent(?:ly)?\s+)?(?:we\s+are\s+)?hiring\s*[:!\-–]/im, -22, "starts 'Hiring:'"],
    [/\b(?:we\s+are\s+hiring|now\s+hiring|urgent(?:ly)?\s+(?:hiring|requirement|need)|immediate\s+(?:requirement|need)|new\s+requirement|open\s+position)\b/i, -14, 'says it is hiring'],
    [/\b(?:job\s+title|position\s+title|job\s+role|role|position|title)\s*[:\-–]\s*\S/i, -14, 'has a role/title line'],
    [/\b(?:send|share|submit|forward|email)\s+(?:me\s+)?(?:your\s+|the\s+|updated\s+|suitable\s+|relevant\s+|matching\s+)*(?:resumes?|profiles?|cvs?|candidates?)\b/i, -22, "asks to 'send resumes'"],
    [/\bsubmit\s+(?:the\s+)?(?:profiles?|candidates?)\b|\bsubmissions?\s+(?:to|at)\b/i, -10, 'asks for submissions'],
    [/\b(?:must\s+have|required\s+skills?|mandatory\s+skills?|key\s+skills?|responsibilities|qualifications|nice\s+to\s+have|good\s+to\s+have|primary\s+skills?)\b/i, -14, "lists 'must have' skills"],
    [/\bjob\s+description\b|\bJD\b(?!s)/, -8, 'has a job description'],
    [/\b(?:client|end\s+client)\s*[:\-–]\s*\S|\bour\s+client\b|\bdirect\s+client\s+(?:requirement|role|position)\b/i, -10, 'names a client'],
    [/\b(?:duration|contract\s+length|project\s+length)\s*[:\-–]\s*\S|\b\d+\s*\+?\s*months?\s+(?:contract|project)\b|\blong[\s-]*term\s+(?:contract|project)\b/i, -10, 'gives a contract duration'],
    [/\brate\s*[:\-–]?\s*\$?\s*\d|\$\s*\d{2,3}\s*(?:\/|per\s*)\s*h(?:ou)?r\b|\bpay\s*rate\b/i, -10, 'gives a pay rate'],
    [/\b(?:only|strictly)\s+(?:h1b|h-1b|gc|usc|us\s*citizens?|citizens?|w2|c2c)\b|\b(?:h1b|gc|usc)\s*(?:\/|,|or|and)\s*(?:gc|usc|h1b|ead|citizens?)\s+only\b|\blocal\s+(?:candidates?|to)\b|\bw2\s+only\b|\bno\s+(?:opt|cpt)\b|\bmust\s+be\s+(?:based|local)\b/i, -10, 'restricts who can apply'],
    [/\b\d{1,2}\s*\+?\s*(?:[-–]\s*\d{1,2}\s*)?years?\s+of\s+(?:relevant\s+)?experience\b|\bexperience\s*[:\-–]\s*\d/i, -10, 'asks for years of experience'],
    [/\b(?:location|work\s+location)\s*[:\-–]\s*\S/i, -8, 'has a location line'],
    [/\bwork\s+(?:authorization|authorisation)\b|\bnot\s+(?:accepting|considering)\b/i, -6, 'states work authorization rules']
  ];

  // Headline of the poster.
  const BENCH_HEADLINE = /bench\s*(?:sales|marketing|recruit\w*)|marketing\s+recruiter|bench\s+recruiter|\bbench\s+(?:sales|marketing)\b/i;
  const RECRUITER_HEADLINE = /\b(?:recruiter|talent\s+acquisition|sourcer|sourcing|staffing|account\s+manager)\b/i;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // ── Tags: local-only, work mode, engagement (issue #44) ───────────────────
  // "Local only" = a real requirement that needs a consultant already in that area.
  const LOCAL_STRONG = [
    /\blocal(?:s|\s+(?:candidates?|consultants?|resources?|profiles?|applicants?))?\s+only\b/i,
    /\bonly\s+(?:the\s+)?local(?:s|\s+(?:candidates?|consultants?|resources?|profiles?|applicants?))?\b/i,
    /\b(?:must|should|has\s+to|have\s+to|need\s+to)\s+be\s+(?:a\s+)?local\b/i,
    /\bno\s+relo(?:cation)?\b(?!\s+(?:assistance|support|package|bonus|benefits?|budget|expenses?))/i,
    /\brelocation\s+(?:is\s+)?not\s+(?:allowed|provided|possible|considered|accepted)\b/i
  ];
  const LOCAL_WEAK = [
    /\bneeds?\s+local(?:s|\s+(?:candidates?|consultants?|resources?|profiles?|applicants?))?\b/i,
    /\blocal\s+(?:candidates?|consultants?|resources?|profiles?)\s+(?:required|needed)\b/i,
    /\(\s*locals?\s*\)/i,
    /\blooking\s+for\s+locals?\b(?!\s+(?:time|language|market|culture))/i,
    /(?<!non[-\s]?)\blocal\s+(?:candidates?|consultants?|resources?|profiles?|applicants?)\b/i
  ];
  // A location line that ends with a bare "Locals" / "Local" ("Location: Chicago, IL (Hybrid) Locals").
  const LOCATION_LINE_LOCALS = /^[^A-Za-z0-9]*(?:(?:work|job|office|project|onsite|client)\s+)?location\s*(?:[:–—-]|is)\s*.*\blocals?\s*[.!)]*\s*$/i;
  const RELOCATION_OK = /\brelocation\s+(?:is\s+)?(?:ok|okay|allowed|possible|considered|provided|assistance)\b|\bopen\s+to\s+(?:non[-\s]?locals?|relocat\w+)|\bnon[-\s]?locals?\s+(?:are\s+)?(?:also\s+)?(?:welcome|ok|okay|considered|accepted)\b|\bno\s+need\s+to\s+be\s+local\b|\blocal\s+(?:is\s+)?not\s+(?:required|mandatory|a\s+must)\b|\bnot\s+(?:required|mandatory)\s+to\s+be\s+local\b|\bwilling\s+to\s+relocat\w+/i;

  const PLACE_WORD = "[A-Z][a-z][A-Za-z.'-]*";
  const NOT_A_PLACE = /^(?:remote|hybrid|onsite|on-site|location|role|client|duration|rate|contract|experience|position|mandatory|required|usa|us|united|states|work|job|title|salary|pay|visa|skills?|local|candidates?|please|note|mode)$/i;
  const CITY_COMMA_ST = new RegExp('(' + PLACE_WORD + '(?:\\s+' + PLACE_WORD + '){0,2}),\\s*([A-Z]{2})\\b(?![a-z])', 'g');
  const CITY_SPACE_ST = new RegExp('(' + PLACE_WORD + '(?:\\s+' + PLACE_WORD + '){0,2})\\s+([A-Z]{2})(?=[\\s,.;)\\u2013\\u2014-]|$)', 'g');

  function isStateCode(c) { return BP.US_STATE_CODES.includes(c); }
  function placeIsReal(city) {
    const words = city.split(/\s+/);
    if (words.some(w => NOT_A_PLACE.test(w))) return false;
    return !(typeof BP.extractSkills === 'function' && BP.extractSkills(city).length);
  }

  // First "City, ST" (or, when `loose`, "City ST") in a piece of text -> { area, state } | null.
  function cityStateIn(str, loose) {
    for (const re of loose ? [CITY_COMMA_ST, CITY_SPACE_ST] : [CITY_COMMA_ST]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(str))) {
        if (isStateCode(m[2]) && placeIsReal(m[1])) return { area: `${m[1]}, ${m[2]}`, state: m[2] };
      }
    }
    return null;
  }

  // A location value ("Mechanicsville, VA (Hybrid)", "Texas", "Dallas") -> { area, state } | null.
  function placeOf(value) {
    const v = String(value || '').replace(/[*_#]/g, '').trim();
    if (!v || /^(?:remote|hybrid|onsite|on-site|usa|us|united states)\b/i.test(v)) return null;
    const exact = cityStateIn(v, true);
    if (exact) return exact;
    const cleaned = v.replace(/\([^)]*\)/g, ' ').split(/\s*(?:[|;/\u2013\u2014]|\s-\s|\bor\b)\s*/i)[0].replace(/\s+(?:area|metro|region)$/i, '').replace(/\s+/g, ' ').trim();
    const st = BP.usStateOf(cleaned);
    if (!st || !cleaned || cleaned.length > 40) return null;
    if (Object.prototype.hasOwnProperty.call(BP.US_STATE_BY_NAME, cleaned.toLowerCase())) return { area: cleaned, state: st };
    const city = cleaned.replace(/,.*$/, '').trim();
    return { area: `${city}, ${st}`, state: st };
  }

  // "local to Bellevue, WA" -> { area, state } | null (the place must start with a capital letter).
  function localToPlace(text) {
    const m = /\blocal\s+to\s+(?:the\s+)?/i.exec(text);
    if (!m) return null;
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const pm = new RegExp('^(' + PLACE_WORD + '(?:\\s+' + PLACE_WORD + '){0,2})(?:,?\\s+(?:area\\s+)?\\(?([A-Z]{2})\\b(?![a-z]))?').exec(rest);
    if (!pm) return null;
    const city = pm[1].replace(/\s+(?:Area|Metro|Region|Office)$/, '');
    if (NOT_A_PLACE.test(city)) return null;
    if (pm[2] && isStateCode(pm[2])) return { area: `${city}, ${pm[2]}`, state: pm[2] };
    return placeOf(city) || { area: city, state: BP.usStateOf(city) || null };
  }

  function localTag(text, lines) {
    const target = localToPlace(text);
    const strong = LOCAL_STRONG.some(re => re.test(text));
    const weak = !strong && !RELOCATION_OK.test(text) && (Boolean(target) || LOCAL_WEAK.some(re => re.test(text)) || lines.some(l => LOCATION_LINE_LOCALS.test(l)));
    const localOnly = strong || weak;
    // Where: "local to X", else the Location line, else the first "City, ST" in the post.
    let place = target;
    if (!place) {
      for (const l of lines) {
        const m = /^[^A-Za-z0-9]*(?:(?:work|job|office|project|onsite|client)\s+)?location\s*(?:[:\u2013\u2014-]|is)\s*(.+)$/i.exec(l);
        if (m && (place = placeOf(m[1]))) break;
      }
    }
    if (!place) place = cityStateIn(text, false);
    return {
      localOnly,
      localArea: place ? place.area : null,
      localState: place && place.state ? place.state : null
    };
  }

  const MODE_DEFS = [
    ['hybrid', /\bhybrid\b/gi],
    ['remote', /\b(?:100\s*%\s*)?remote(?:ly)?(?!\s+interviews?)\b|\bwork\s+from\s+home\b|\bwfh\b/gi],
    ['onsite', /\bon[-\s]?site(?!\s+interviews?)\b|\bin[-\s]?office\b|\bin[-\s]?person(?!\s+interviews?)\b/gi]
  ];
  const NEG_BEFORE = /\b(?:no|not|non|isn'?t|without|never)\W+(?:(?:a|an|the|fully|100\s*%|really|strictly)\W+)?$/i;
  const NEG_AFTER = /^\W*(?:is\s+not|isn'?t|not\s+(?:an?\s+)?(?:option|allowed|available|possible|accepted|offered|permitted)|only\s+for)\b/i;
  const MODE_LABEL = /^[^A-Za-z0-9]*(?:work\s*(?:mode|model|type|arrangement|setup)|mode|location|job\s+type)\s*[:\u2013\u2014-]/i;

  function workModeOf(text, lines) {
    const hits = [];
    for (const [mode, re] of MODE_DEFS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const before = text.slice(Math.max(0, m.index - 24), m.index);
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
        if (NEG_BEFORE.test(before) || NEG_AFTER.test(after)) continue;
        hits.push({ mode, idx: m.index });
      }
    }
    if (!hits.length) return null;
    if (hits.some(h => h.mode === 'hybrid')) return 'hybrid';
    for (const l of lines) {
      if (!MODE_LABEL.test(l)) continue;
      for (const [mode, re] of MODE_DEFS) { re.lastIndex = 0; if (re.test(l)) return mode; }
    }
    hits.sort((a, b) => a.idx - b.idx);
    return hits[0].mode;
  }

  const ENGAGEMENT_DEFS = [
    ['c2c', /\bc2c\b|\bcorp[\s-]*(?:to|2)[\s-]*corp\b/gi],
    ['w2', /\bw-?2\b/gi],
    ['1099', /\b1099\b/gi],
    ['contract', /\bcontract\b|\bcontractor\b/gi],
    ['fulltime', /\bfull[\s-]*time\b|\bfte\b|\bperm(?:anent)?\b/gi],
    ['c2h', /\bc2h\b|\bcontract[\s-]*to[\s-]*(?:hire|perm(?:anent)?)\b/gi]
  ];
  const C2H_RE = /\bc2h\b|\bcontract[\s-]*to[\s-]*(?:hire|perm(?:anent)?)\b/gi;
  const NEG_ENG_BEFORE = /\b(?:no|not|non|without|except)\W+(?:(?:a|an|the|any)\W+)?$/i;
  const NEG_ENG_AFTER = /^\W*(?:is\s+not|isn'?t|not\s+(?:allowed|accepted|considered|available|open)|are\s+not)\b/i;

  function engagementOf(text) {
    const found = [];
    for (const [key, re] of ENGAGEMENT_DEFS) {
      // "contract-to-hire / contract-to-perm" is C2H only, not also a contract and a permanent role
      const src = key === 'c2h' ? text : text.replace(C2H_RE, ' ');
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const before = src.slice(Math.max(0, m.index - 14), m.index);
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 24);
        if (NEG_ENG_BEFORE.test(before) || NEG_ENG_AFTER.test(after)) continue;
        found.push(key);
        break;
      }
    }
    return ENGAGEMENTS.filter(k => found.includes(k));
  }

  function extractPostTags(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n');
    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    const local = localTag(t, lines);
    return Object.assign(local, { workMode: workModeOf(t, lines), engagement: engagementOf(t) });
  }

  // Saved or freshly scanned lead + tag name -> boolean. Leads saved before issue #44 have no tags,
  // so those fall back to the old text heuristics the drawer used.
  const OLD_C2C = /\bc2c\b|corp[\s-]*(?:to|2)[\s-]*corp/i;
  const OLD_W2 = /\bw2\b/i;
  function leadHasTag(lead, tag) {
    const l = lead || {};
    const blob = [l.directClientVms, l.notes, l.requirement].join(' ');
    switch (tag) {
      case 'local': return l.localOnly === true;
      case 'remote': return typeof l.workMode === 'string' ? l.workMode === 'remote' : /remote/i.test(l.location || '');
      case 'c2c': return Array.isArray(l.engagement) ? l.engagement.includes('c2c') : OLD_C2C.test(blob);
      case 'w2': return Array.isArray(l.engagement) ? l.engagement.includes('w2') : OLD_W2.test(blob);
      default: return false;
    }
  }

  // ── Recruiter jobs: a company hiring a recruiting-side person for ITS OWN team ──
  const TITLE_MODS = '(?:sr\\.?|senior|jr\\.?|junior|lead|principal|associate|entry[-\\s]level|us|u\\.s\\.|usa|it|non[-\\s]?it|technical|healthcare|full[-\\s]?cycle|corporate|staffing|offshore|night[-\\s]shift|contract|permanent|sales|bench\\s+sales|bench|marketing)';
  const TITLE_CORE_SAFE = '(?:recruiters?|recruiting\\s+(?:coordinators?|executives?|specialists?|managers?|leads?|associates?|partners?|analysts?)|recruitment\\s+(?:executives?|leads?|managers?|consultants?|specialists?|associates?|partners?|coordinators?|analysts?|officers?)|talent\\s+acquisition(?:\\s+(?:specialists?|partners?|executives?|managers?|leads?|associates?|coordinators?|consultants?|recruiters?|analysts?))?|(?:talent\\s+|technical\\s+)?sourcers?|sourcing\\s+(?:specialists?|executives?|recruiters?)|bench\\s+sales(?:\\s+(?:recruiters?|executives?|managers?|specialists?|representatives?|consultants?|leads?))?|bench\\s+marketing(?:\\s+(?:recruiters?|executives?))?)';
  // Roles that only count as recruiting when the post is about staffing (an "Account Manager" at a retailer is not).
  const TITLE_CORE_AMBIGUOUS = '(?:account\\s+(?:managers?|executives?)|business\\s+development(?:\\s+(?:managers?|executives?|representatives?|associates?))?|bdms?|bdes?|delivery\\s+(?:managers?|leads?)|onboarding\\s+(?:coordinators?|specialists?|executives?|managers?)|hr\\s+(?:coordinators?|executives?|generalists?|recruiters?|managers?|associates?)|resource\\s+(?:managers?|coordinators?))';
  const TITLE_RE_G = new RegExp('\\b((?:' + TITLE_MODS + '\\s+){0,4})(' + TITLE_CORE_SAFE + '|' + TITLE_CORE_AMBIGUOUS + ')(?![A-Za-z])', 'gi');
  const AMBIGUOUS_RE = new RegExp('^' + TITLE_CORE_AMBIGUOUS + '$', 'i');
  const STAFFING_CONTEXT = /\b(?:staffing|recruit\w*|talent|bench|placements?|c2c|w2|h1b|us\s+it|vendors?|consultants?|sourcing)\b/i;
  // "Workday Recruiting Lead" is a Workday consultant, not a recruiter.
  const SYSTEM_BEFORE = /(?:workday|taleo|icims|greenhouse|successfactors|oracle|\bsap|salesforce|peoplesoft|ukg|bullhorn|lever|\bats|\bcrm|\berp|system|platform|module|cloud)\s*$/i;

  // The words that introduce the role being hired.
  const SLOT_PREFIX = '(?:we(?:\'|\u2019)?re\\s+hiring|we\\s+are\\s+hiring|(?:now\\s+|urgently\\s+|urgent\\s+)?hiring(?:\\s+for)?|is\\s+looking\\s+for|are\\s+looking\\s+for|looking\\s+(?:for|to\\s+hire)|seeking|searching\\s+for|openings?\\s+for|vacanc(?:y|ies)\\s+for|requirements?\\s+for|needs?|needed|wanted|role|position|job\\s+title|job\\s+role|title|designation|apply\\s+for|opportunity\\s+for|join\\s+(?:us|our\\s+team)\\s+as)';
  const SLOT_FILLER = '(?:(?:an?|the|multiple|several|few|\\d+|immediate|urgent|experienced|dynamic|passionate|motivated|smart|energetic|talented|driven|proactive|fresh|skilled)\\s+)*';
  const SLOT_RE = new RegExp('\\b' + SLOT_PREFIX + '\\b[\\s:\\-\\u2013\\u2014|]*' + SLOT_FILLER + '$', 'i');
  const HEADING_PREFIX = /^[^A-Za-z0-9]*(?:(?:urgent(?:ly)?|immediate(?:ly)?|now|we(?:'|\u2019)?re|we\s+are|job\s+alert|job\s+opening|hiring|opening|vacancy|walk[-\s]?in|multiple)\b[\s:!\-\u2013\u2014|]*)*/i;

  const OWN_TEAM = /\bhiring\b|\bwe(?:'|\u2019)?re\s+looking\b|\bwe\s+are\s+looking\b|\bis\s+looking\s+for\b|\blooking\s+to\s+(?:hire|add|grow)\b|\bjoin\s+(?:our|us|the)\b|\bcome\s+join\b|\bour\s+(?:growing\s+)?team\b|\bposition\s*[:\-\u2013\u2014]|\brole\s*[:\-\u2013\u2014]|\bjob\s+title\b|\bopenings?\b|\bvacanc(?:y|ies)\b|\bapply\b|\b(?:send|share|email|mail|forward|submit|drop)\s+(?:your\s+|an?\s+|updated\s+)?(?:resume|cv|r\u00e9sum\u00e9)\b|\binterested\s+candidates\b|\bwalk[-\s]?in\b|\bimmediate\s+joiners?\b|\bwe(?:'|\u2019)?d\s+love\b/i;
  const SEND_RESUME = /\b(?:send|share|email|mail|forward|submit|drop)\s+(?:your\s+|an?\s+|updated\s+)?(?:resume|cv|r\u00e9sum\u00e9)\b|\bresumes?\s+(?:to|at)\b/i;
  // Evidence the post is a consultant requirement that happens to name a recruiting role.
  const CONSULTANT_REQ = [
    /\b(?:end\s+)?client\s*[:\u2013\u2014-]/i,
    /\brate\s*[:\u2013\u2014-]?\s*\$?\s*\d|\$\s*\d{2,3}\s*(?:\/|per\s*)\s*h(?:ou)?r\b|\bpay\s*rate\b/i,
    /\b(?:duration|contract\s+length)\s*[:\u2013\u2014-]/i,
    /\bc2c\b|\bcorp[\s-]*(?:to|2)[\s-]*corp\b|\b1099\b/i,
    /\bsubmit\s+(?:the\s+)?(?:profiles?|candidates?)\b|\bsubmissions?\b/i
  ];

  const ACRONYMS = { us: 'US', usa: 'USA', 'u.s.': 'U.S.', it: 'IT', 'non-it': 'Non-IT', hr: 'HR', bdm: 'BDM', bde: 'BDE', bdms: 'BDM', bdes: 'BDE' };
  function tidyTitle(s) {
    let t = s.replace(/\s+/g, ' ').trim();
    t = t.replace(/\b(recruiter|coordinator|executive|specialist|manager|lead|associate|partner|analyst|officer|consultant|sourcer|representative|generalist)s$/i, '$1');
    if (t === t.toLowerCase() || t === t.toUpperCase()) {
      t = t.toLowerCase().split(' ').map(w => ACRONYMS[w] || (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
    }
    return t.slice(0, 60);
  }

  // -> { jobTitle, resume } | null
  function findRecruiterRole(text) {
    const hasStaffing = STAFFING_CONTEXT.test(text);
    const accept = (m) => {
      const core = m[2];
      if (AMBIGUOUS_RE.test(core) && !hasStaffing) return false;
      if (/^recruit/i.test(core) && SYSTEM_BEFORE.test(text.slice(Math.max(0, m.index - 30), m.index))) return false;
      return true;
    };
    // 1. After a "hiring / looking for / position:" lead-in.
    TITLE_RE_G.lastIndex = 0;
    let m;
    while ((m = TITLE_RE_G.exec(text))) {
      if (!accept(m)) continue;
      const lead = text.slice(Math.max(0, m.index - 90), m.index);
      if (SLOT_RE.test(lead)) return { jobTitle: tidyTitle(m[0]) };
    }
    // 2. A heading that is the title itself: "US IT Recruiter (Remote)", "Urgent: Bench Sales Recruiters Required".
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3);
    for (const line of lines) {
      if (line.length > 100) continue;
      const rest = line.replace(HEADING_PREFIX, '');
      TITLE_RE_G.lastIndex = 0;
      const hm = TITLE_RE_G.exec(rest);
      if (hm && hm.index === 0 && accept({ 2: hm[2], index: 0 })) return { jobTitle: tidyTitle(hm[0]) };
    }
    return null;
  }

  function detectRecruiterJob(text, strongHot) {
    if (strongHot) return null;   // a table of consultants stays a hotlist whatever else it says
    if (!OWN_TEAM.test(text)) return null;
    if (CONSULTANT_REQ.filter(re => re.test(text)).length >= 2) return null;
    const role = findRecruiterRole(text);
    if (!role) return null;
    return { jobTitle: role.jobTitle, sendsResume: SEND_RESUME.test(text) };
  }

  function classifyPost(input) {
    const text = String((input && input.text) || '').replace(/\r\n?/g, '\n');
    const headline = String((input && input.headline) || '');
    const signals = [];   // { w, reason }
    const add = (w, reason) => { if (w) signals.push({ w, reason }); };

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const tags = extractPostTags(text);

    // 1. Structure: many consultants / many unrelated role families.
    const entries = entryLines(lines);
    const families = new Set();
    entries.forEach(l => { const f = familyOf(l); if (f) families.add(f); });
    // Role-noun phrases outside list entries ("Data Engineer ... DevOps Engineer ...") also count.
    for (const l of lines) {
      if (entries.includes(l) || l.length > 200) continue;
      const re = new RegExp(ROLE_NOUN.source, 'gi');
      let m;
      while ((m = re.exec(l))) {
        const before = l.slice(Math.max(0, m.index - 28), m.index + m[0].length);
        const f = familyOf(before);
        if (f && f !== 'Cloud') families.add(f);
      }
    }
    const nFam = families.size;
    // Strong hotlist evidence: a recruiter-job wording never overrides these (a hotlist stays a hotlist).
    let strongHot = nFam >= 3 || entries.length >= 3;
    if (nFam >= 5) add(48, `${nFam} different roles listed`);
    else if (nFam === 4) add(42, '4 different roles listed');
    else if (nFam === 3) add(34, '3 different roles listed');
    else if (nFam === 2 && entries.length >= 2) add(10, '2 different roles listed');

    if (entries.length >= 3) add(entries.length >= 5 ? 28 : 22, `${entries.length} consultant-style lines`);
    const pipeLines = lines.filter(l => (l.match(/\|/g) || []).length >= 2 && l.length < 200).length;
    if (pipeLines >= 3) add(14, 'rows separated by "|"');
    if (/\bname\s*[|\t]\s*(?:technology|skill|role|title)/i.test(text) || /\b(?:technology|skills?|role)\s*[|\t]\s*exp\w*\s*[|\t]\s*(?:visa|location)/i.test(text)) {
      add(35, 'has a consultant table header');
      strongHot = true;
    }
    const visaLines = lines.filter(l => VISA_TOKEN.test(l) && EXP_TOKEN.test(l) && l.length < 200).length;
    if (visaLines >= 2) { add(16, 'visa and experience listed per consultant'); strongHot = true; }

    // 2. Phrases.
    HOT_PHRASES.forEach(([re, w, reason], i) => {
      if (!re.test(text)) return;
      add(w, reason);
      // Only the word "hotlist" counts here: a bench sales job ad says "market our bench / consultants" too.
      if (i === 0) strongHot = true;
    });
    for (const [re, w, reason] of REQ_PHRASES) if (re.test(text)) add(w, reason);

    // 3. Poster headline.
    if (BENCH_HEADLINE.test(headline)) add(40, 'headline mentions bench sales');
    else if (BENCH_HEADLINE.test(text) && /(?:bench|marketing)\s+(?:sales\s+)?recruiter|bench\s+sales/i.test(text)) add(15, 'signature says bench sales');
    if (RECRUITER_HEADLINE.test(headline) && !BENCH_HEADLINE.test(headline)) add(-6, '');   // nudges toward requirement; too weak to show as a reason

    const hot = signals.filter(s => s.w > 0).reduce((a, s) => a + s.w, 0);
    const req = signals.filter(s => s.w < 0).reduce((a, s) => a + s.w, 0);
    // Requirement evidence is capped so a long JD cannot outvote a clear table of consultants,
    // and vice versa; the cap is high enough that either side alone passes its threshold.
    const score = clamp(Math.round(clamp(hot, 0, 100) + clamp(req, -100, 0)), -100, 100);
    const type = score >= HOTLIST_AT ? 'hotlist' : score <= REQUIREMENT_AT ? 'requirement' : 'unclear';

    // Reasons: the strongest signals on the side that won; unclear shows both sides.
    let pool = signals.slice();
    if (type === 'hotlist') pool = pool.filter(s => s.w > 0);
    else if (type === 'requirement') pool = pool.filter(s => s.w < 0);
    pool.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    const reasons = pool.filter(s => s.reason).slice(0, 5).map(s => s.reason);
    if (!reasons.length) reasons.push('no clear hotlist or requirement wording');

    // A company hiring a recruiter for its own team is a job for the user. Checked once the hotlist
    // evidence is known: it beats a requirement or a headline-only "bench sales" nudge, never a hotlist.
    const job = detectRecruiterJob(text, strongHot);
    if (job) {
      const jobReasons = [`hiring a ${job.jobTitle.slice(0, 28)} for their own team`];
      if (job.sendsResume) jobReasons.push('applicants send a résumé');
      return { type: 'recruiter-job', score: 0, reasons: jobReasons, tags, jobTitle: job.jobTitle };
    }
    return { type, score, reasons, tags, jobTitle: null };
  }

  // ── Post parsing helpers used by content.js (pure, so they are unit-tested) ──
  // Section headings and form labels that look like a name ("Ideal Candidate Profile") but are not one.
  const HEADING_WORDS = /^(?:ideal|candidate|candidates|profile|profiles|job|description|key|responsibilities|responsibility|required|requirements?|skills?|must|have|nice|to|about|the|role|roles|summary|qualifications?|preferred|primary|secondary|mandatory|good|details?|overview|benefits?|position|title|location|duration|experience|client|visa|status|rate|work|mode|note|notes|please|regards|thanks|hello|hi|hiring|urgent|opening|openings|apply|interested|contact|email|phone|reach|me|us|technical|technology|tech|stack|domain|project|company|education|certifications?|duties|tools|team|immediate|need|needs|looking|for)$/i;
  const NAME_WORD = /^(?:[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?|[A-Z]\.?|Mc[A-Z][a-z]+)$/;

  // True for a 2-4 word capitalised line that could be a person's name (initials allowed:
  // "Krishna Nayak V"). Rejects headings, labels, and anything with ':' or digits.
  function looksLikePersonName(line) {
    const s = String(line || '').replace(/^[•\-\s]+/, '').trim();
    if (!s || s.length > 40 || /[:;,@\d]/.test(s)) return false;
    const words = s.split(/\s+/);
    if (words.length < 2 || words.length > 4) return false;
    if (!words.every(w => NAME_WORD.test(w))) return false;
    if (words.filter(w => w.replace('.', '').length > 1).length < 2) return false;
    return !words.some(w => HEADING_WORDS.test(w));
  }

  // "Experience: 18-20 Years" -> "18-20 Years". A label with no value on its line, or a partial
  // word such as the "Exp" inside "Experience", yields ''.
  function labelledValue(text, labelRe) {
    const re = new RegExp('(?:^|[^A-Za-z])(?:' + labelRe + ')\\b\\.?[ \\t]*([:\\-\\u2013])?[ \\t]*([^\\n\\r,\\u2022|]*)', 'gi');
    const src = String(text || '');
    let m;
    while ((m = re.exec(src))) {
      const value = m[2].replace(/^[\s:\-\u2013]+/, '').trim();
      if (!value || !/[A-Za-z0-9]/.test(value)) continue;
      if (!m[1] && !/^\d/.test(value)) continue;   // "Experience with Python" is prose, not a field
      return value;
    }
    return '';
  }
  function extractExperienceText(text) { return labelledValue(text, 'Experience|Exp'); }
  function extractDurationText(text) { return labelledValue(text, 'Duration|Project\\s+Length'); }

  Object.assign(BP, { POST_TYPES, classifyPost, extractPostTags, leadHasTag, looksLikePersonName, extractExperienceText, extractDurationText });
})(typeof self !== 'undefined' ? self : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof self !== 'undefined' ? self : globalThis).BP;
}
