// utils/mergeTemplate.js
import { BRAND } from "../config/brandConfig.js";

// ─────────────────────────────────────────────────────────────
// Shared responsive rules, injected via {{RESPONSIVE_STYLES}}.
// ─────────────────────────────────────────────────────────────
const RESPONSIVE_STYLES = `
<style>
  @media only screen and (max-width: 600px) {
    .ec-outer { padding: 20px 12px !important; }
    .ec-inner-pad { padding: 24px 18px !important; }
    .ec-service-cell { display: block !important; width: 100% !important; padding: 8px 0 !important; }
  }
</style>`;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[\s_-]+/g, '');
}

// ─────────────────────────────────────────────────────────────
// Schema-aware field resolution.
//
// Lets a template reference ANY Customer field — or a CustomerFields.*
// key — with one generic token: {{FieldName}} or [FieldName]. No manual
// per-field wiring needed when the schema changes.
//
// Resolution order:
//   1. Friendly alias → the real Prisma column (handles names like
//      "Business Name" / "Phone" / "Address" that don't match the column
//      name literally)
//   2. Exact Prisma column on the customer object, case/spacing-insensitive
//      (covers any schema field not in the alias map, including new ones
//      added later)
//   3. A matching key inside the dynamic CustomerFields JSON blob — this is
//      how campaign-specific data (audit scores, notes, anything without
//      its own column) gets in, WITHOUT dumping the whole JSON blob
//   4. Not found → null (caller renders blank rather than leaking a token)
// ─────────────────────────────────────────────────────────────
const SCHEMA_FIELD_ALIASES = {
  name: 'customerName',
  customername: 'customerName',
  // No dedicated "business name" column exists on Customer — this reuses
  // customerName. If you ever add a real BusinessName column or a
  // CustomerFields.BusinessName key, delete this line and it'll resolve
  // through step 2/3 instead.
  businessname: 'customerName',
  business: 'customerName',
  clientname: 'customerName',
  leadname: 'customerName',

  email: 'Email',
  emailid: 'Email',
  emailaddress: 'Email',

  phone: 'ContactNumber',
  contact: 'ContactNumber',
  mobile: 'ContactNumber',
  contactnumber: 'ContactNumber',
  phonenumber: 'ContactNumber',

  city: 'City',
  location: 'Location',
  sublocation: 'SubLocation',
  area: 'Area',
  address: 'Adderess',   // matches the schema's existing spelling
  adderess: 'Adderess',

  campaign: 'Campaign',
  customertype: 'CustomerType',
  type: 'CustomerType',
  customersubtype: 'CustomerSubType',
  subtype: 'CustomerSubType',
  leadtype: 'LeadType',
  leadtemperature: 'LeadTemperature',

  facilities: 'Facillities',
  facillities: 'Facillities',
  referenceid: 'ReferenceId',
  customerid: 'CustomerId',
  clientid: 'ClientId',

  date: 'CustomerDate',
  customerdate: 'CustomerDate',
  year: 'CustomerYear',
  customeryear: 'CustomerYear',

  description: 'Description',
  video: 'Video',
  verified: 'Verified',
  googlemap: 'GoogleMap',
  map: 'GoogleMap',

  url: 'URL',
  website: 'URL',
  price: 'Price',
  pricenumber: 'PriceNumber',
  other: 'Other',
};

export function resolveFieldValue(rawKey, customer) {
  if (!customer) return null;
  const norm = normalizeKey(rawKey);

  // 1. friendly alias → real column
  const aliasCol = SCHEMA_FIELD_ALIASES[norm];
  if (aliasCol && customer[aliasCol] !== undefined && customer[aliasCol] !== null && customer[aliasCol] !== '') {
    return String(customer[aliasCol]);
  }

  // 2. exact Prisma column, case/spacing-insensitive
  const directKey = Object.keys(customer).find(
    (k) => normalizeKey(k) === norm && typeof customer[k] !== 'object'
  );
  if (directKey && customer[directKey] !== undefined && customer[directKey] !== null && customer[directKey] !== '') {
    return String(customer[directKey]);
  }

  // 3. dynamic CustomerFields JSON — e.g. audit scores, campaign-specific
  //    notes that don't have a fixed column of their own
  if (customer.CustomerFields && typeof customer.CustomerFields === 'object') {
    const cfKey = Object.keys(customer.CustomerFields).find((k) => normalizeKey(k) === norm);
    if (cfKey) {
      const val = customer.CustomerFields[cfKey];
      if (val !== undefined && val !== null && val !== '') return String(val);
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Brand tokens — {{BRAND.fieldName}} — resolved from config/brandConfig.js.
// ─────────────────────────────────────────────────────────────
export function applyBrandTokens(str) {
  if (!str) return str;
  return str.replace(/\{\{\s*BRAND\.(\w+)\s*\}\}/g, (_match, key) => {
    const val = BRAND[key];
    return val !== undefined ? escapeHtml(val) : '';
  });
}

// ─────────────────────────────────────────────────────────────
// Main merge entry point. Supports two customer-token syntaxes through the
// SAME resolver, so both AI-authored copy and hand-built templates work:
//   {{Name}}, {{CustomerFields.domain}}     — legacy curly syntax
//   [Customer Name], [OverallWebsiteScore]  — bracket syntax (spaces ok)
// Anything that doesn't resolve is dropped rather than left as a raw
// token in a sent email.
// ─────────────────────────────────────────────────────────────
export function replacePlaceholders(str, customer) {
  if (!str) return str;
  let out = applyBrandTokens(str);

  // {{...}} tokens
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, rawKey) => {
    if (rawKey.startsWith('CustomerFields.')) {
      const cfKey = rawKey.slice('CustomerFields.'.length);
      const val = customer?.CustomerFields?.[cfKey];
      return val !== undefined && val !== null && val !== '' ? escapeHtml(String(val)) : '';
    }
    const val = resolveFieldValue(rawKey, customer);
    return val !== null ? escapeHtml(val) : '';
  });

  // [...] tokens — letters, numbers, spaces, underscores, hyphens
  out = out.replace(/\[([A-Za-z][A-Za-z0-9 _-]{0,60})\]/g, (match, rawKey) => {
    const val = resolveFieldValue(rawKey, customer);
    return val !== null ? escapeHtml(val) : '';
  });

  out = out.replaceAll('{{RESPONSIVE_STYLES}}', RESPONSIVE_STYLES);

  return out;
}

// Pulls the template's own max-width so the appended section lines up
// with the card above it instead of spanning full email width.
function detectTemplateWidth(templateHtml, fallback = 600) {
  const match = templateHtml.match(/max-width:\s*(\d{3,4})px/i);
  return match ? parseInt(match[1], 10) : fallback;
}

// Pulls the body/page background so the appended section's outer strip
// blends with the template instead of showing a mismatched color band.
function detectPageBackground(templateHtml, fallback = '#f4f7fb') {
  const match = templateHtml.match(/body[^>]*style=["'][^"']*background(?:-color)?:\s*([^;"']+)/i);
  return match ? match[1].trim() : fallback;
}

// Boxes AI-written content so it visually reads as a closing section of
// the template — same width, padded, boxed — rather than a bare <p> that
// spans full width with no styling once it lands outside the card.
function wrapAppendedContent(aiBody, templateHtml) {
  const width = detectTemplateWidth(templateHtml);
  const pageBg = detectPageBackground(templateHtml);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${pageBg};">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${width}px; background-color:#ffffff; border-top:1px solid #e2e8f0; border-radius:0 0 10px 10px; box-shadow:0 6px 18px rgba(0,0,0,0.06);">
        <tr>
          <td style="padding:22px 32px; font-size:14.5px; line-height:1.7; color:#334155; font-family:Arial, 'Segoe UI', sans-serif;">
            ${aiBody}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function mergeAiContentIntoTemplate(templateHtml, aiBody, customer) {
  let merged;

  if (templateHtml.includes('{{AI_CONTENT}}')) {
    // Best case — template has a dedicated slot, content lands inline
    // inside the existing design. No wrapping needed.
    merged = templateHtml.replace('{{AI_CONTENT}}', aiBody);
  } else {
    const wrapped = wrapAppendedContent(aiBody, templateHtml);
    merged = templateHtml.includes('</body>')
      ? templateHtml.replace('</body>', `${wrapped}</body>`)
      : `${templateHtml}\n${wrapped}`;
  }

  return replacePlaceholders(merged, customer);
}

// ─────────────────────────────────────────────────────────────
// Fallback template — used ONLY when the "AI Generate" tab sends with no
// template selected. Brand header/footer come from BRAND config. No
// services grid, no CustomerFields dump — just the AI-written message.
// ─────────────────────────────────────────────────────────────
export const DEFAULT_TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{Campaign}}</title>
  {{RESPONSIVE_STYLES}}
</head>
<body style="margin:0; padding:0; background-color:#ffffff; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" class="ec-outer" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="padding-bottom:8px;">
              <p style="margin:0; font-size:12px; font-weight:700; letter-spacing:0.5px; color:{{BRAND.primaryColor}};">{{BRAND.companyName}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:20px;">
              <p style="margin:0; font-size:14px; color:#64748b;">Hi {{Name}},</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:24px; color:#1e293b; font-size:15px; line-height:1.7;">
              <p style="margin:0 0 16px 0;">{{AI_CONTENT}}</p>
              <p style="margin:0;">Best,<br>{{BRAND.signOffName}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:20px; border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px 0; font-size:12px; color:#94a3b8;">{{BRAND.phoneDisplay}} · {{BRAND.email}} · {{BRAND.websiteDisplay}}</p>
              <p style="margin:0; font-size:11px; color:#cbd5e1;">{{BRAND.tagline}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export function collectAvailablePlaceholders(customers, maxDynamicKeys = 25) {
  const staticKeys = ['Name', 'City', 'Campaign', 'ContactNumber', 'Email'];
  const dynamicKeys = new Set();
  for (const c of customers) {
    if (c.CustomerFields && typeof c.CustomerFields === 'object') {
      for (const k of Object.keys(c.CustomerFields)) dynamicKeys.add(k);
    }
  }
  return [
    ...staticKeys.map((k) => `{{${k}}}`),
    ...[...dynamicKeys].slice(0, maxDynamicKeys).map((k) => `{{CustomerFields.${k}}}`),
  ];
}

export function extractTemplateContext(html, maxLength = 3000) {
  if (!html) return '';
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\[[A-Za-z][A-Za-z0-9 _-]{0,60}\]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  if (text.length > maxLength) text = text.slice(0, maxLength) + '…';
  return text;
}

export function getTemplateInsertionMode(html) {
  if (!html) return 'none';
  return html.includes('{{AI_CONTENT}}') ? 'placeholder' : 'append';
}