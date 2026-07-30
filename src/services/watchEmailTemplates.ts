import type {
  GrantResult,
  GrantWatch,
  GrantWatchNotificationType,
  SearchOutput,
} from "../domain/types.js";
import {
  WATCH_FREQUENCY,
  WATCH_NOTIFICATION_LABELS,
  WATCH_QUALITY,
} from "./watchPreferences.js";

const DEFAULT_COPILOT_URL = "https://m365.cloud.microsoft/chat";
const ALLOWED_COPILOT_HOSTS = new Set([
  "m365.cloud.microsoft",
  "www.microsoft365.com",
  "www.office.com",
  "teams.microsoft.com",
]);

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const safeCopilotUrl = (watch: GrantWatch) => {
  const candidate = watch.copilotReturnUrl
    ?? process.env.M365_COPILOT_RETURN_URL
    ?? DEFAULT_COPILOT_URL;
  try {
    const url = new URL(candidate);
    const allowed = url.protocol === "https:"
      && (ALLOWED_COPILOT_HOSTS.has(url.hostname) || url.hostname.endsWith(".teams.microsoft.com"));
    return allowed ? url.href : DEFAULT_COPILOT_URL;
  } catch {
    return DEFAULT_COPILOT_URL;
  }
};

const safePublicOrigin = () => {
  const candidate = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol)
      ? url.origin
      : "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
};

const unsubscribeUrl = (watch: GrantWatch) => {
  const url = new URL("/watches/unsubscribe", safePublicOrigin());
  url.searchParams.set("watchId", watch.id);
  url.searchParams.set("token", watch.unsubscribeToken ?? "");
  return url.href;
};

const money = (value?: number) => {
  if (value === undefined) return "Not stated";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
};

const awardRange = (grant: GrantResult) => {
  const minimum = grant.opportunity.awardMin;
  const maximum = grant.opportunity.awardMax;
  if (minimum === undefined && maximum === undefined) return "Not stated";
  if (minimum !== undefined && maximum !== undefined && minimum !== maximum) {
    return `${money(minimum)}–${money(maximum)}`;
  }
  return money(maximum ?? minimum);
};

const formatDeadline = (deadline?: string) => {
  if (!deadline) return "Not stated";
  const parsed = new Date(`${deadline.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return deadline;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};

const factRow = (label: string, value: string) => `
  <tr>
    <td class="fact-label" style="padding:11px 0;border-top:1px solid #deded8;color:#686762;font-size:12px;line-height:17px">${escapeHtml(label)}</td>
    <td class="fact-value" style="padding:11px 0;border-top:1px solid #deded8;color:#171715;font-size:12px;font-weight:700;line-height:17px;text-align:right">${escapeHtml(value)}</td>
  </tr>`;

const emailShell = ({
  preheader,
  eyebrow,
  title,
  subtitle,
  accent,
  content,
}: {
  preheader: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  accent: string;
  content: string;
}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light dark;supported-color-schemes:light dark}
    html,body{width:100%!important;margin:0!important;padding:0!important}
    body{background:#f4f4f1;color:#171715;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
    td{mso-line-height-rule:exactly}
    img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
    a{text-decoration:none}
    .email-wrap{width:100%!important;min-width:100%;background:#f4f4f1}
    .email-container{width:600px;max-width:600px;margin:0 auto}
    .surface{border-radius:12px}
    .button{display:block;border-radius:9px;padding:13px 18px;font-size:13px;font-weight:700;line-height:18px;text-align:center}
    .brand-icon{display:block!important;width:32px!important;height:32px!important;border:0!important;border-radius:9px!important;background:#000!important}
    @media(prefers-color-scheme:dark){
      body,.email-wrap{background:#10100f!important;color:#f2f2ef!important}
      .surface{background:#181817!important;border-color:#30302e!important;color:#f2f2ef!important}
      .brand-name,.email-title,.content-pad,.fact-value,.grant-title,.grant-link,.score-value,.evidence-copy{color:#f2f2ef!important}
      .email-subtitle,.body-copy,.muted,.fact-label,.info-copy{color:#aaa9a3!important}
      .faint,.email-footer{color:#7b7a75!important}
      .eyebrow,.chip,.info-box{background:#222220!important;border-color:#30302e!important}
      .rule,.facts-grid,.facts-cell,.evidence-grid,.digest-row{border-color:#30302e!important}
      .facts-grid{background:#10100f!important}
      .primary-button{background:#f2f2ef!important;border-color:#f2f2ef!important;color:#111!important;-webkit-text-fill-color:#111!important}
      .secondary-button{background:#181817!important;border-color:#454540!important;color:#f2f2ef!important;-webkit-text-fill-color:#f2f2ef!important}
      .manage-link{color:#aaa9a3!important;-webkit-text-fill-color:#aaa9a3!important}
      .source-pill.federal{background:#2b2b28!important;color:#f2f2ef!important}
      .source-pill.private{background:#2b241d!important}
      .eligibility-pill.positive{background:#1b2923!important;border-color:#315f4c!important}
      .eligibility-pill.verify{background:#211d19!important;border-color:#6f4e2f!important}
    }
    @media(max-width:600px){
      .outer-pad{padding:18px 12px!important}
      .email-container{width:100%!important;max-width:100%!important}
      .hero-pad,.content-pad{padding:22px 20px!important}
      .button-cell{display:block!important;width:100%!important;padding:5px 0!important}
      .fact-label,.fact-value{font-size:12px!important}
    }
  </style>
</head>
<body style="margin:0!important;background:#f4f4f1;color:#171715">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <center role="article" aria-roledescription="email" lang="en" style="width:100%;background:#f4f4f1">
  <table role="presentation" class="email-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f1" style="width:100%!important;min-width:100%;background:#f4f4f1">
    <tr>
      <td class="outer-pad" width="100%" align="center" valign="top" style="width:100%;padding:30px 16px 28px;text-align:center">
        <!--[if mso]>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
        <![endif]-->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;margin:0 auto;text-align:left">
          <tr>
            <td align="left" style="padding:0 2px 16px;text-align:left">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40" valign="middle">
                    <img class="brand-icon" src="cid:grantpilot-logo" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;border-radius:9px;background:#000">
                  </td>
                  <td class="brand-name" valign="middle" style="color:#171715;font-size:18px;font-weight:750;line-height:22px;letter-spacing:-.02em">GrantPilot</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="surface" bgcolor="#ffffff" style="overflow:hidden;background:#ffffff;border:1px solid #deded8;border-radius:14px;color:#171715">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="hero-pad" align="left" style="padding:25px 28px 22px;text-align:left">
                    <span class="eyebrow" style="display:inline-block;padding:5px 8px;border:1px solid #deded8;border-radius:999px;background:#f1f1ed;color:${accent};font-size:10px;font-weight:800;line-height:12px;letter-spacing:.09em;text-transform:uppercase">${escapeHtml(eyebrow)}</span>
                    <h1 class="email-title" style="margin:13px 0 6px;color:#171715;font-size:23px;font-weight:750;line-height:29px;letter-spacing:-.025em">${escapeHtml(title)}</h1>
                    <p class="email-subtitle" style="margin:0;color:#686762;font-size:13px;line-height:19px">${escapeHtml(subtitle)}</p>
                  </td>
                </tr>
                <tr>
                  <td class="rule" style="height:1px;background:#deded8;font-size:0;line-height:0">&nbsp;</td>
                </tr>
                <tr>
                  <td class="content-pad" align="left" style="padding:23px 28px 26px;color:#171715;text-align:left">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-footer" align="left" style="padding:13px 4px 0;color:#8b8a84;font-size:10px;line-height:15px;text-align:left">
              GrantPilot ranks evidence to support funding decisions. Confirm eligibility, deadlines, and application requirements at the original source.
            </td>
          </tr>
        </table>
        <!--[if mso]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
  </center>
</body>
</html>`;

const copilotButton = (url: string) => `
  <a class="button primary-button" href="${escapeHtml(url)}" style="display:block;border:1px solid #171715;background:#171715;color:#fff;-webkit-text-fill-color:#fff;border-radius:9px;padding:13px 18px;font-size:13px;font-weight:700;line-height:18px;text-align:center">
    Open in Copilot&nbsp; →
  </a>`;

const manageWatchLink = (watch: GrantWatch) => `
  <div style="margin-top:15px;text-align:center">
    <a class="manage-link" href="${escapeHtml(unsubscribeUrl(watch))}" style="color:#686762;-webkit-text-fill-color:#686762;font-size:11px;font-weight:650;line-height:16px;text-decoration:underline">
      Manage or cancel updates
    </a>
  </div>`;

export function buildWatchConfirmationEmail(
  watch: GrantWatch,
  search: SearchOutput,
  selected?: GrantResult,
) {
  const quality = WATCH_QUALITY[watch.matchQuality];
  const frequency = WATCH_FREQUENCY[watch.frequency];
  const scope = watch.scope === "selected-grant" && selected
    ? `Selected opportunity: ${selected.opportunity.title}`
    : `Saved search: ${search.project.title}`;
  const alerts = watch.notificationTypes.map((type) => WATCH_NOTIFICATION_LABELS[type]);
  const copilotUrl = safeCopilotUrl(watch);
  const manageUrl = unsubscribeUrl(watch);
  const subject = `GrantPilot watch active · ${search.project.title}`;
  const plainText = [
    "Your GrantPilot watch is active.",
    "",
    scope,
    `Match threshold: ${quality.label}`,
    `Delivery: ${frequency.label}`,
    `Notifications: ${alerts.join(", ")}`,
    watch.notificationTypes.includes("opportunity-closing")
      ? `Deadline reminder: ${watch.deadlineLeadDays} days before`
      : "",
    "",
    `Open in Copilot: ${copilotUrl}`,
    `Manage or cancel updates: ${manageUrl}`,
    "",
    "GrantPilot ranks evidence to support decisions. Verify eligibility and deadlines at the original source.",
  ].filter(Boolean).join("\n");
  const alertItems = alerts
    .map((label) => `<span class="chip muted" style="display:inline-block;margin:0 6px 7px 0;padding:6px 9px;border:1px solid #deded8;border-radius:999px;background:#f1f1ed;color:#686762;font-size:11px">${escapeHtml(label)}</span>`)
    .join("");
  const content = `
    <p class="evidence-copy" style="margin:0 0 18px;color:#171715;font-size:13px;line-height:1.6">GrantPilot will monitor the saved criteria and send focused updates when something changes.</p>
    <table role="presentation" width="100%">
      ${factRow("Watch", scope)}
      ${factRow("Match threshold", quality.label)}
      ${factRow("Delivery", frequency.label)}
      ${watch.notificationTypes.includes("opportunity-closing") ? factRow("Deadline reminder", `${watch.deadlineLeadDays} days before`) : ""}
    </table>
    <div style="margin-top:20px">
      <div class="faint" style="margin-bottom:9px;color:#8b8a84;font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase">Notifications</div>
      ${alertItems}
    </div>
    <div style="margin-top:18px">${copilotButton(copilotUrl)}</div>
    ${manageWatchLink(watch)}`;
  const html = emailShell({
    preheader: `${frequency.label} GrantPilot alerts are now active.`,
    eyebrow: "Watch created",
    title: "Your grant watch is active",
    subtitle: `${frequency.label} updates for ${scope.toLowerCase()}.`,
    accent: "#62d6a5",
    content,
  });
  return { subject, plainText, html, unsubscribeUrl: manageUrl };
}

type AlertContext = {
  notificationType: GrantWatchNotificationType;
  daysRemaining?: number;
};

const alertPresentation = (
  type: GrantWatchNotificationType,
  grant: GrantResult,
  daysRemaining?: number,
) => {
  const title = grant.opportunity.title;
  switch (type) {
    case "opportunity-closing":
      return {
        subject: `Deadline approaching · ${title}`,
        eyebrow: "Approaching deadline",
        headline: daysRemaining === 0 ? "Deadline is today" : daysRemaining === 1 ? "Deadline is tomorrow" : `${daysRemaining ?? "Several"} days until deadline`,
        intro: `The indexed deadline for ${title} is approaching. Review the official notice and confirm submission requirements now.`,
        accent: "#e69a3a",
      };
    case "deadline-change":
      return {
        subject: `Deadline updated · ${title}`,
        eyebrow: "Deadline change",
        headline: "An indexed deadline changed",
        intro: "GrantPilot detected a newer source record for this opportunity. Confirm the current deadline and revise your application plan if needed.",
        accent: "#78a8ff",
      };
    case "opportunity-closed":
      return {
        subject: `Opportunity closed · ${title}`,
        eyebrow: "Status change",
        headline: "This opportunity closed or was archived",
        intro: "GrantPilot verified a closed or archived status at the source. Stop application work until the official record confirms another valid submission path.",
        accent: "#e69a3a",
      };
    case "opportunity-removed":
      return {
        subject: `Opportunity removed · ${title}`,
        eyebrow: "Source change",
        headline: "This watched opportunity is no longer available",
        intro: "The exact source record could no longer be retrieved. Review the official source to determine whether it was removed, replaced, or assigned a new identifier.",
        accent: "#e69a3a",
      };
    case "no-longer-matching":
      return {
        subject: `GrantPilot match changed · ${title}`,
        eyebrow: "Match change",
        headline: "This candidate no longer matches the saved criteria",
        intro: "A fresh search or rescore no longer places this candidate above the watch threshold. Review the updated evidence before continuing pursuit.",
        accent: "#a8a8a2",
      };
    case "opportunity-amended":
      return {
        subject: `Opportunity updated · ${title}`,
        eyebrow: "Official record update",
        headline: "The opportunity record was amended",
        intro: "The indexed official record changed after this watch was created. Review the latest notice for updated requirements, dates, or award information.",
        accent: "#b999ff",
      };
    case "score-increased":
      return {
        subject: `Stronger GrantPilot match · ${title}`,
        eyebrow: "Match strengthened",
        headline: "This opportunity is now a stronger fit",
        intro: "New or updated evidence moved this opportunity into a stronger match category for your saved search.",
        accent: "#62d6a5",
      };
    default:
      return {
        subject: `New GrantPilot match · ${title}`,
        eyebrow: "New matching opportunity",
        headline: "A new candidate matched your watch",
        intro: "GrantPilot found a newly indexed candidate that meets the match threshold and saved criteria for this watch.",
        accent: "#62d6a5",
      };
  }
};

export function buildWatchAlertEmail(
  watch: GrantWatch,
  grant: GrantResult,
  context: AlertContext,
) {
  const quality = WATCH_QUALITY[watch.matchQuality];
  const presentation = alertPresentation(
    context.notificationType,
    grant,
    context.daysRemaining,
  );
  const missionReason = grant.score.components.missionAlignment.reasons[0]
    ?? "This candidate overlaps the mission and criteria saved in your GrantPilot watch.";
  const deadline = formatDeadline(grant.opportunity.deadline);
  const copilotUrl = safeCopilotUrl(watch);
  const manageUrl = unsubscribeUrl(watch);
  const historical = grant.opportunity.source === "irs-990pf";
  const sourceLabel = historical ? "IRS 990-PF evidence" : "Grants.gov";
  const sourceAction = historical ? "View IRS evidence" : "View official source";
  const eligibility = grant.score.eligibilityStatus ?? "needs-verification";
  const eligibilityPositive = eligibility === "confirmed" || eligibility === "likely";
  const eligibilityText = eligibility === "confirmed"
    ? "Eligible"
    : eligibility === "likely"
      ? "Likely eligible"
      : eligibility === "likely-ineligible"
        ? "Likely ineligible"
        : "Verify eligibility";
  const overallScore = Math.round(grant.score.overallScore ?? 0);
  const applicationEffort = Math.round(grant.chart?.applicationEffort ?? 0);
  const description = grant.opportunity.summary
    ?? "Review the indexed source record for the complete program description.";
  const evidenceNote = historical
    ? "Evidence-backed potential private donor/funder candidate worth researching and possibly contacting."
    : grant.opportunity.sourceDisclaimer
      ?? "Verify eligibility, deadline, and submission requirements in the official notice.";
  const plainText = [
    presentation.headline,
    grant.opportunity.title,
    grant.opportunity.funderName,
    "",
    presentation.intro,
    `Why GrantPilot surfaced it: ${missionReason}`,
    `Match threshold: ${quality.label}`,
    `Source: ${sourceLabel}`,
    `Award: ${awardRange(grant)}`,
    `Deadline: ${deadline}`,
    "",
    `Open in Copilot: ${copilotUrl}`,
    `Manage or cancel updates: ${manageUrl}`,
    `${sourceAction}: ${grant.opportunity.sourceUrl}`,
  ].join("\n");
  const content = `
    <p class="body-copy" style="margin:0 0 18px;color:#686762;font-size:12px;line-height:1.55">${escapeHtml(presentation.intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td valign="top">
          <span class="source-pill ${historical ? "private" : "federal"}" style="display:inline-block;margin:0 5px 5px 0;padding:5px 8px;border-radius:999px;background:${historical ? "#f7eee4" : "#ededeb"};color:${historical ? "#b86d20" : "#171715"};font-size:9px;font-weight:700;line-height:11px">${escapeHtml(sourceLabel)}</span>
          <span class="eligibility-pill ${eligibilityPositive ? "positive" : "verify"}" style="display:inline-block;margin:0 0 5px;padding:5px 8px;border:1px ${eligibilityPositive ? "solid #a8d5c0" : "dashed #dfbd91"};border-radius:999px;background:${eligibilityPositive ? "#eaf6f0" : "#fbf3e9"};color:${eligibilityPositive ? "#247653" : "#a96218"};font-size:9px;font-weight:700;line-height:11px">${escapeHtml(eligibilityText)}</span>
        </td>
        <td width="58" valign="top" align="right">
          <div class="score-value" style="color:#171715;font-size:19px;font-weight:750;line-height:20px">${overallScore}</div>
          <div class="faint" style="margin-top:2px;color:#8b8a84;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">match</div>
        </td>
      </tr>
    </table>
    <h2 class="grant-title" style="margin:8px 0 5px;color:#171715;font-size:20px;line-height:1.25;letter-spacing:-.02em">${escapeHtml(grant.opportunity.title)}</h2>
    <p class="muted" style="margin:0;color:#686762;font-size:11px;line-height:1.4">${escapeHtml(grant.opportunity.funderName)}</p>
    <table role="presentation" class="facts-grid" width="100%" cellpadding="0" cellspacing="0" style="margin-top:19px;border:1px solid #deded8;border-radius:9px;background:#f8f8f5">
      <tr>
        <td class="facts-cell" width="50%" valign="top" style="padding:12px 14px;border-right:1px solid #deded8;border-bottom:1px solid #deded8">
          <div class="faint" style="color:#8b8a84;font-size:8px;line-height:11px">Award range</div>
          <div class="fact-value" style="margin-top:4px;color:#171715;font-size:11px;font-weight:700;line-height:15px">${escapeHtml(awardRange(grant))}</div>
        </td>
        <td class="facts-cell" width="50%" valign="top" style="padding:12px 14px;border-bottom:1px solid #deded8">
          <div class="faint" style="color:#8b8a84;font-size:8px;line-height:11px">${historical ? "Status" : "Deadline"}</div>
          <div class="fact-value" style="margin-top:4px;color:#171715;font-size:11px;font-weight:700;line-height:15px">${escapeHtml(deadline)}</div>
        </td>
      </tr>
      <tr>
        <td class="facts-cell" width="50%" valign="top" style="padding:12px 14px;border-right:1px solid #deded8">
          <div class="faint" style="color:#8b8a84;font-size:8px;line-height:11px">Watch threshold</div>
          <div class="fact-value" style="margin-top:4px;color:#171715;font-size:11px;font-weight:700;line-height:15px">${escapeHtml(quality.label)}</div>
        </td>
        <td class="facts-cell" width="50%" valign="top" style="padding:12px 14px">
          <div class="faint" style="color:#8b8a84;font-size:8px;line-height:11px">Pursuit effort</div>
          <div class="fact-value" style="margin-top:4px;color:#171715;font-size:11px;font-weight:700;line-height:15px">${applicationEffort}/100</div>
        </td>
      </tr>
    </table>`;
  const evidence = `
    <table role="presentation" class="evidence-grid" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #deded8">
      <tr>
        <td class="button-cell" width="50%" valign="top" style="padding:16px 10px 0 0">
          <div class="muted" style="color:#686762;font-size:9px;font-weight:700;letter-spacing:.055em;text-transform:uppercase">Description</div>
          <p class="evidence-copy" style="margin:6px 0 0;color:#171715;font-size:11px;line-height:1.55">${escapeHtml(description)}</p>
        </td>
        <td class="button-cell" width="50%" valign="top" style="padding:16px 0 0 10px">
          <div class="muted" style="color:#686762;font-size:9px;font-weight:700;letter-spacing:.055em;text-transform:uppercase">Why it matches</div>
          <p class="evidence-copy" style="margin:6px 0 0;color:#171715;font-size:11px;line-height:1.55">${escapeHtml(missionReason)}</p>
        </td>
      </tr>
    </table>
    <div class="info-box" style="margin-top:18px;padding:11px 12px;border:1px solid #deded8;background:#f1f1ed;border-radius:10px">
      <div class="muted" style="color:#686762;font-size:9px;font-weight:800;letter-spacing:.055em;text-transform:uppercase">ⓘ&nbsp; Info</div>
      <p class="info-copy" style="margin:6px 0 0;color:#686762;font-size:10px;font-weight:600;line-height:1.45">${escapeHtml(evidenceNote)}</p>
    </div>
    <div class="rule" style="height:1px;margin-top:18px;background:#deded8;font-size:0;line-height:0">&nbsp;</div>
    <div style="margin-top:16px">${copilotButton(copilotUrl)}</div>
    <div style="margin-top:8px">
      <a class="button secondary-button" href="${escapeHtml(grant.opportunity.sourceUrl)}" style="display:block;border:1px solid #c7c7c1;background:#ffffff;color:#171715;-webkit-text-fill-color:#171715;border-radius:9px;padding:12px 18px;font-size:12px;font-weight:700;line-height:18px;text-align:center">${sourceAction}</a>
    </div>
    ${manageWatchLink(watch)}`;
  const html = emailShell({
    preheader: `${presentation.eyebrow}: ${grant.opportunity.title}`,
    eyebrow: presentation.eyebrow,
    title: presentation.headline,
    subtitle: grant.opportunity.funderName,
    accent: presentation.accent,
    content: `${content}${evidence}`,
  });
  return { subject: presentation.subject, plainText, html, unsubscribeUrl: manageUrl };
}

export type GrantWatchDigestItem = {
  grant: GrantResult;
  notificationTypes: GrantWatchNotificationType[];
};

export function buildWatchDigestEmail(
  watch: GrantWatch,
  items: GrantWatchDigestItem[],
) {
  const frequency = WATCH_FREQUENCY[watch.frequency];
  const copilotUrl = safeCopilotUrl(watch);
  const manageUrl = unsubscribeUrl(watch);
  const updateCount = items.reduce(
    (total, item) => total + item.notificationTypes.length,
    0,
  );
  const subject = `${items.length} GrantPilot update${items.length === 1 ? "" : "s"} · ${frequency.label}`;
  const plainText = [
    `${frequency.label}: ${updateCount} update${updateCount === 1 ? "" : "s"} across ${items.length} grant${items.length === 1 ? "" : "s"}.`,
    "",
    ...items.flatMap(({ grant, notificationTypes }) => [
      grant.opportunity.title,
      grant.opportunity.funderName,
      `Updates: ${notificationTypes.map((type) => WATCH_NOTIFICATION_LABELS[type]).join(", ")}`,
      `Match: ${Math.round(grant.score.overallScore)}/100`,
      `Award: ${awardRange(grant)}`,
      `Deadline: ${formatDeadline(grant.opportunity.deadline)}`,
      `Source: ${grant.opportunity.sourceUrl}`,
      "",
    ]),
    `Open in Copilot: ${copilotUrl}`,
    `Manage or cancel updates: ${manageUrl}`,
  ].join("\n");
  const rows = items.map(({ grant, notificationTypes }) => {
    const historical = grant.opportunity.source === "irs-990pf";
    const badges = notificationTypes.map((type) =>
      `<span class="chip muted" style="display:inline-block;margin:0 5px 5px 0;padding:4px 7px;border:1px solid #deded8;border-radius:999px;background:#f1f1ed;color:#686762;font-size:8px;font-weight:700;line-height:10px">${escapeHtml(WATCH_NOTIFICATION_LABELS[type])}</span>`
    ).join("");
    return `
      <tr>
        <td class="digest-row" style="padding:15px 0;border-top:1px solid #deded8">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" style="padding-right:12px">
                <div>${badges}</div>
                <a class="grant-link" href="${escapeHtml(grant.opportunity.sourceUrl)}" style="display:block;margin-top:4px;color:#171715;font-size:13px;font-weight:700;line-height:1.35">${escapeHtml(grant.opportunity.title)}</a>
                <div class="muted" style="margin-top:3px;color:#686762;font-size:10px;line-height:1.4">${escapeHtml(grant.opportunity.funderName)}</div>
                <div class="faint" style="margin-top:8px;color:#8b8a84;font-size:9px;line-height:1.4">
                  <span class="${historical ? "" : "grant-link"}" style="color:${historical ? "#b86d20" : "#171715"}">${historical ? "IRS prospect" : "Grants.gov"}</span>
                  &nbsp;·&nbsp; ${escapeHtml(awardRange(grant))}
                  &nbsp;·&nbsp; ${escapeHtml(formatDeadline(grant.opportunity.deadline))}
                </div>
              </td>
              <td width="44" valign="top" align="right">
                <div class="score-value" style="color:#171715;font-size:17px;font-weight:750;line-height:18px">${Math.round(grant.score.overallScore)}</div>
                <div class="faint" style="margin-top:2px;color:#8b8a84;font-size:7px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">match</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join("");
  const content = `
    <p class="body-copy" style="margin:0 0 17px;color:#686762;font-size:12px;line-height:1.55">${updateCount} update${updateCount === 1 ? "" : "s"} detected across ${items.length} grant${items.length === 1 ? "" : "s"} in this saved search.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${rows}
    </table>
    <div class="rule" style="height:1px;margin-top:3px;background:#deded8;font-size:0;line-height:0">&nbsp;</div>
    <div style="margin-top:16px">${copilotButton(copilotUrl)}</div>
    ${manageWatchLink(watch)}`;
  const html = emailShell({
    preheader: `${updateCount} GrantPilot watch updates are ready.`,
    eyebrow: frequency.label,
    title: "Your grant watch digest",
    subtitle: `${items.length} grant${items.length === 1 ? "" : "s"} changed since the last successful check.`,
    accent: "#55b88a",
    content,
  });
  return { subject, plainText, html, unsubscribeUrl: manageUrl };
}
