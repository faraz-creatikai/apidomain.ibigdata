// config/brandConfig.js
//
// Single source of truth for company identity across every email template.
// Change a value here and it updates on every template at send time —
// no template HTML needs to be touched.
//
// Referenced in template HTML as {{BRAND.fieldName}}, resolved by
// applyBrandTokens() in utils/mergeTemplate.js before customer tokens run.

export const BRAND = {
  companyName: "CreatikAi",
  displayName: "Creatik Ai",
  shortTagline: "AI • Web • Digital Growth • Automation",
  tagline: "Turning Digital Presence into Measurable Growth",
  website: "https://creatikai.com",
  websiteDisplay: "www.creatikai.com",
  phone: "+919649902000",
  phoneDisplay: "+91 9649902000",
  email: "contact@creatikai.com",       // TODO: set the real reply-to inbox
  logoUrl: "https://creatikai.com/assets/creatikai-logo.png", // TODO: host the real logo, update this
  primaryColor: "#0b2f6b",
  accentColor: "#1663d6",
  signOffName: "Creatikai Team",
  closingLine: "Let's Build. Automate. Grow Together.",
};

export default BRAND;