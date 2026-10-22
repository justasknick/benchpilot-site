// lib/roles.js - role families for the Today view and Leads filter (v1.6.0).
//
//   BP.ROLE_FAMILIES            display order
//   BP.roleFamily(lead)         -> one of ROLE_FAMILIES (never throws; 'Other' when nothing matches)
//   BP.roleFamilyOfText(text)   -> same rules on a bare title / text, or '' when no rule fires
//
// Rule-based and explainable. The requirement TITLE decides first, using an ordered list in which the
// first matching family wins ("Java Full Stack" -> Java, "Azure Data Engineer" -> Data engineer,
// "Data Scientist / ML" -> AI / ML). Only when the title says nothing (e.g. "Software Engineer") the
// technologies and notes vote, and the family with the most distinct hits wins.
// Pure: no DOM, no storage.

(function (root) {
  'use strict';
  const BP = root.BP = root.BP || {};

  const ROLE_FAMILIES = ['Java / J2EE', 'Data engineer', 'Data analyst / BI', 'AI / ML', 'DevOps / Cloud', 'Security / Cyber',
    'Network / Infra', '.NET', 'QA / SDET', 'BA / PM', 'Salesforce', 'SAP', 'ServiceNow', 'Workday', 'Oracle / PeopleSoft',
    'Pega', 'Guidewire', 'Mainframe', 'Full stack / Front end', 'Mobile', 'Python', 'Other'];

  // Ordered: first match wins on a title. `strong` words are decisive role words; `weak` are technology
  // names that only decide when no earlier family claimed the title. Token lists are regex sources.
  const RULES = [
    { family: 'Salesforce', re: /\b(?:salesforce|sfdc|apex\s+(?:developer|class\w*|trigger\w*)|lwc|vlocity|service\s?cloud|sales\s?cloud|marketing\s?cloud|cpq|omnistudio)\b/i },
    { family: 'SAP', re: /\b(?:sap|abap|s\/?4\s?hana|hana|fico|ariba|successfactors|basis\s+consultant)\b/i },
    // Enterprise platforms: a title that names the platform wins over the language ("ServiceNow Developer (JavaScript)",
    // "Java Developer with Guidewire") and over BA / QA words, the same way Salesforce and SAP already do.
    { family: 'ServiceNow', re: /\b(?:service\s?now|snow\s+(?:developer|admin\w*|architect)|itsm|itom|hrsd)\b/i },
    { family: 'Workday', re: /\bworkday\b/i },
    // Oracle APPLICATIONS only. Oracle DBA / Oracle Database / PL-SQL are not here: they stay in Data engineer (databases).
    // "Oracle Apps DBA" names Apps, so it lands here. Bare "EBS" is not a token (AWS EBS is storage); "Oracle EBS" / "R12" are.
    { family: 'Oracle / PeopleSoft', re: /\b(?:oracle\s+(?:e-?business|ebs|fusion|apps?|applications?|cloud\s+(?:erp|hcm|scm|epm|financials|fusion)|erp|hcm|scm|epm|financials|hyperion|forms|reports|soa|integration(?:\s+cloud)?|oic|bpm|apex|cx|r12)|e-?business\s+suite|ebs\s+(?:r12|developer|consultant|functional|technical|finance|financials)|peoplesoft|people\s?soft|oic|jd\s?edwards)\b/i },
    { family: 'Pega', re: /\b(?:pega|pegasystems|prpc)\b/i },
    { family: 'Guidewire', re: /\b(?:guidewire|policy\s?center|claim\s?center|billing\s?center|gosu)\b/i },
    { family: 'BA / PM', re: /\b(?:business\s+(?:data\s+|systems?\s+|process\s+|functional\s+)?analyst|systems?\s+analyst|functional\s+analyst|ba|product\s+(?:owner|manager)|scrum\s+master|agile\s+coach|project\s+manager|program\s+manager|programme\s+manager|delivery\s+manager|technical\s+program|pmo|pm|release\s+manager|requirements?\s+analyst|process\s+analyst)\b/i },
    // Security words are specific ("security engineer", SOC analyst, Okta); "DevSecOps" stays DevOps and "security clearance"
    // is not a role. Pen-test titles must beat the QA "testing engineer" words, so this sits before QA.
    { family: 'Security / Cyber', re: /\b(?:cyber(?:\s?security)?|info(?:rmation)?\s?sec(?:urity)?|(?:application|app|cloud|network|product|data|endpoint|platform|it|software)?\s?security\s+(?:engineer\w*|analyst\w*|architect\w*|consultant|specialist|administrator|admin|developer|operations|lead|officer|compliance)|soc\s+(?:analyst|engineer|lead|architect)|iam\s+(?:engineer|analyst|developer|architect|consultant|admin\w*|lead|specialist|manager)|identity\s+(?:and|&)\s+access|identity\s+governance|okta|cyber\s?ark|sailpoint|saviynt|forgerock|ping\s?identity|siem|qradar|crowdstrike|splunk\s+(?:security|es|enterprise\s+security|soar)|soar|pen[\s-]?test\w*|penetration|ethical\s+hack\w*|vulnerability|threat\s+(?:hunt\w*|intel\w*|detection|analyst)|appsec|grc|red\s+team|incident\s+response)\b/i },
    { family: 'QA / SDET', re: /\b(?:qa|sdet|quality\s+(?:assurance|engineer|analyst)|test(?:ing)?\s+(?:engineer|analyst|lead|automation|manager|consultant)|tester|automation\s+(?:test|qa|engineer)|selenium|cypress|playwright|uat|performance\s+test(?:er|ing)?|manual\s+test(?:er|ing)?)\b/i },
    // Network / infrastructure operations. Vendor-name-only words (Cisco, F5, VMware...) are in the weak rule near the end.
    { family: 'Network / Infra', re: /\b(?:network\s+(?:engineer\w*|architect\w*|administrator|admin|analyst|operations|specialist|technician|consultant)|noc\s+(?:engineer|analyst)|(?:sd-?)?wan\s+(?:engineer|architect)|routing\s+(?:and|&)\s+switching|ccn[ap]|ccie|wireless\s+engineer|voip|(?:cisco|juniper|arista|aruba|f5|palo\s+alto|fortinet|fortigate|check\s?point|meraki)\s+(?:network\s+|firewall\s+|security\s+)?(?:engineer|architect|admin\w*|specialist|consultant|ltm)|firewall\s+(?:engineer|administrator|admin|analyst)|load\s+balancer|(?:windows|linux|unix|vmware|citrix|active\s+directory|exchange|o365|office\s?365)\s+(?:system\s+|systems\s+)?(?:administrator|admin|engineer|architect|specialist|sysadmin)|systems?\s+(?:administrator|admin|engineer)|sysadmin|storage\s+(?:engineer|administrator|admin|architect)|san\s+storage|netapp|backup\s+(?:engineer|administrator|admin))\b/i },
    // Mainframe (z/OS) wins over Java / DevOps / database words: "DB2 on z/OS" and "Mainframe Modernization" are Mainframe.
    { family: 'Mainframe', re: /(?:\b(?:mainframe|cobol|jcl|cics|vsam|zos|rexx|ims\s+(?:db|dc))\b|\bz\/os\b)/i },
    { family: 'AI / ML', re: /\b(?:machine\s+learning|ml|ai|a\.i\.|artificial\s+intelligence|data\s+scien\w*|llm|gen\s?ai|generative|nlp|computer\s+vision|deep\s+learning|mlops|prompt\s+engineer\w*|ai\/ml|agentic)\b/i },
    { family: 'Mobile', re: /\b(?:ios|android|mobile|swift|swiftui|kotlin|flutter|react\s+native|xamarin|objective[\s-]c)\b/i },
    // Data analyst / BI = reporting and dashboards (Power BI, Tableau, Looker, "data analyst"). The `not` guard hands the title
    // to Data engineer when it also names an engineering word, so "Data Engineer (Power BI)" and "ETL / Tableau" stay Data engineer.
    // A bare platform name ("Snowflake Developer") is not an engineering word, so "Snowflake Data Analyst" is BI.
    { family: 'Data analyst / BI', re: /\b(?:data\s+(?:analyst\w*|analytics|visuali[sz]ation)|power\s?bi|tableau|looker|qlik\w*|microstrategy|cognos|ssrs|ssas|bi\s+(?:developer|engineer|analyst|architect|consultant|lead|report\w*)|business\s+intelligence|reporting\s+(?:analyst|developer)|analytics\s+(?:analyst|developer)|dashboard\w*\s+developer|sisense|thoughtspot|domo)\b/i,
      not: /\b(?:data\s+(?:engineer\w*|architect\w*|platform|pipeline\w*|warehouse|warehousing|modeler|modeller|integration)|etl|elt|big\s+data|databricks|spark|pyspark|hadoop|dwh|informatica|talend|ssis|dbt|airflow|dba)\b/i },
    { family: 'Data engineer', re: /\b(?:data\s+(?:engineer\w*|architect\w*|platform|pipeline\w*|warehouse|warehousing|modeler|modeller|developer|governance|integration|steward)|etl|elt|big\s+data|databricks|snowflake|spark|pyspark|hadoop|dwh|informatica|talend|dbt|redshift|bigquery|synapse|dba|database\s+(?:administrator|developer|engineer)|sql\s+(?:developer|server\s+developer|dba)|pl\/?sql|ssis|dataiku|palantir|foundry|airflow)\b/i },
    // Decisive cloud / ops role words come before the language families ("Java DevOps Engineer" is DevOps).
    { family: 'DevOps / Cloud', re: /\b(?:devops|devsecops|sre|site\s+reliability|cloud\s+(?:engineer\w*|architect\w*|developer|consultant|infrastructure|migration|operations|ops|native)|platform\s+engineer\w*|infrastructure\s+(?:engineer|architect|analyst)|release\s+engineer|build\s+(?:and|&)\s+release|cicd|ci\/cd|finops|observability|kubernetes\s+(?:engineer|admin)|aws\s+(?:engineer|architect|admin\w*|solutions?\s+architect)|azure\s+(?:engineer|architect|admin\w*|solutions?\s+architect)|gcp\s+(?:engineer|architect))\b/i },
    { family: 'Java / J2EE', re: /\b(?:java(?!\s?script)|j2ee|jee|jsp|servlets?|spring(?:\s?boot)?|hibernate|jvm|struts)\b/i },
    { family: '.NET', re: /(?:(?:^|[^a-z0-9])\.net\b|\bdotnet\b|\basp\.net\b|\bc#|\bc\s?sharp\b|\bblazor\b|\bwpf\b|\bvb\.net\b|\bwinforms\b|\bmaui\b)/i },
    { family: 'Python', re: /\b(?:python|django|flask|fastapi|pandas|pyramid)\b/i },
    { family: 'Full stack / Front end', re: /\b(?:full[\s-]?stack|front[\s-]?end|ui\s+(?:developer|engineer|architect)|ui\/ux|ux\s+(?:developer|engineer|designer)|react(?:\.?js)?|angular(?:\.?js)?|vue(?:\.?js)?|javascript|typescript|node(?:\.?js)?|mern|mean\s+stack|next\.?js|web\s+developer|html5?|jquery|svelte|web\s+application\s+developer)\b/i },
    // Technology names only: decide when nothing above claimed the title.
    { family: 'Network / Infra', re: /\b(?:cisco|juniper|arista|f5|palo\s+alto|fortinet|fortigate|check\s?point|meraki|vmware|vsphere|nsx|firewalls?|routers?|switches|tcp\/?ip|dns|dhcp)\b/i },
    { family: 'DevOps / Cloud', re: /\b(?:aws|azure|gcp|google\s+cloud|kubernetes|k8s|docker|terraform|ansible|jenkins|linux|cloud|openshift|puppet|chef|gitlab\s+ci|github\s+actions|nagios|splunk|datadog)\b/i }
  ];

  // Global versions for counting distinct hits in free text (technologies / notes).
  const GLOBAL_RULES = RULES.map(r => ({ family: r.family, re: new RegExp(r.re.source, 'gi') }));

  function norm(text) {
    return String(text == null ? '' : text).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // First matching family on a short title, '' when none.
  function roleFamilyOfTitle(title) {
    const t = norm(title);
    if (!t) return '';
    for (const r of RULES) if (r.re.test(t) && !(r.not && r.not.test(t))) return r.family;
    return '';
  }

  // Free text (technologies, notes): the family with the most distinct hits; ties go to rule order.
  function roleFamilyOfBody(text) {
    const t = norm(text);
    if (!t) return '';
    const counts = new Map();
    for (const r of GLOBAL_RULES) {
      r.re.lastIndex = 0;
      const seen = new Set();
      let m;
      while ((m = r.re.exec(t))) { seen.add(m[0].toLowerCase()); if (m[0] === '') r.re.lastIndex++; }
      if (seen.size) counts.set(r.family, (counts.get(r.family) || 0) + seen.size);
    }
    let best = '', bestN = 0;
    // Keep rule order for ties, but let ROLE_FAMILIES-less duplicates (DevOps appears twice) merge.
    for (const r of RULES) {
      const n = counts.get(r.family) || 0;
      if (n > bestN) { best = r.family; bestN = n; }
    }
    return best;
  }

  function roleFamilyOfText(text) {
    return roleFamilyOfTitle(text) || roleFamilyOfBody(text);
  }

  // Notes look like "Hiring: Sr Java Developer | Dallas, TX | Skills: Java, Spring". Keep the skills part,
  // drop the generic prefix so "Hiring" cannot vote.
  function notesBody(notes) {
    return norm(notes).replace(/^Hiring:\s*[^|]*\|?/i, ' ').replace(/Auto-extracted from LinkedIn post|Found on \S+/i, ' ');
  }

  function roleFamily(lead) {
    if (!lead) return 'Other';
    const byTitle = roleFamilyOfTitle(lead.requirement);
    if (byTitle) return byTitle;
    const body = roleFamilyOfBody((lead.technologies || '') + ' ' + notesBody(lead.notes));
    return body || 'Other';
  }

  Object.assign(BP, { ROLE_FAMILIES, roleFamily, roleFamilyOfText });
})(typeof self !== 'undefined' ? self : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof self !== 'undefined' ? self : globalThis).BP;
}
