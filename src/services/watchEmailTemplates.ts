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
    <td class="fact-label" style="padding:11px 0;border-top:1px solid #30302e;color:#aaa9a3;font-size:12px;line-height:17px">${escapeHtml(label)}</td>
    <td class="fact-value" style="padding:11px 0;border-top:1px solid #30302e;color:#f2f2ef;font-size:12px;font-weight:700;line-height:17px;text-align:right">${escapeHtml(value)}</td>
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
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:dark;supported-color-schemes:dark}
    body{margin:0!important;background:#10100f;color:#f2f2ef;font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}
    table{border-collapse:collapse}
    a{text-decoration:none}
    .email-wrap{width:100%;background:#10100f}
    .email-card{width:100%;max-width:640px}
    .surface{border-radius:14px}
    .button{display:block;border-radius:9px;padding:13px 18px;font-size:13px;font-weight:700;line-height:18px;text-align:center}
    @media(max-width:600px){
      .outer-pad{padding:20px 10px!important}
      .hero-pad,.content-pad{padding:22px 18px!important}
      .button-cell{display:block!important;width:100%!important;padding:5px 0!important}
      .fact-label,.fact-value{font-size:12px!important}
    }
  </style>
</head>
<body style="margin:0!important;background:#10100f;color:#f2f2ef">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <table role="presentation" class="email-wrap" width="100%" cellpadding="0" cellspacing="0" bgcolor="#10100f" style="width:100%;background:#10100f">
    <tr>
      <td class="outer-pad" align="center" style="padding:34px 16px 30px">
        <table role="presentation" class="email-card" width="640" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:0 2px 18px">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="44" valign="middle">
                    <div style="width:36px;height:36px;border-radius:10px;background:#000;color:#fff;font-size:22px;line-height:36px;text-align:center">✦</div>
                  </td>
                  <td valign="middle" style="color:#f2f2ef;font-size:20px;font-weight:750;letter-spacing:-.02em">GrantPilot</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="surface" bgcolor="#181817" style="overflow:hidden;background:#181817;border:1px solid #30302e;border-radius:14px;color:#f2f2ef">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="hero-pad" style="padding:27px 28px 24px">
                    <span style="display:inline-block;padding:5px 8px;border:1px solid #30302e;border-radius:999px;background:#222220;color:${accent};font-size:10px;font-weight:800;line-height:12px;letter-spacing:.09em;text-transform:uppercase">${escapeHtml(eyebrow)}</span>
                    <h1 style="margin:14px 0 7px;color:#f2f2ef;font-size:22px;line-height:1.18;letter-spacing:-.025em">${escapeHtml(title)}</h1>
                    <p style="margin:0;color:#aaa9a3;font-size:14px;line-height:1.5">${escapeHtml(subtitle)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="height:1px;background:#30302e;font-size:0;line-height:0">&nbsp;</td>
                </tr>
                <tr>
                  <td class="content-pad" style="padding:24px 28px 27px;color:#f2f2ef">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 4px 0;color:#7b7a75;font-size:10px;line-height:1.5">
              GrantPilot ranks evidence to support funding decisions. Confirm eligibility, deadlines, and application requirements at the original source.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const copilotButton = (url: string) => `
  <a class="button" href="${escapeHtml(url)}" style="display:block;border:1px solid #f2f2ef;background:#f2f2ef;color:#111;border-radius:9px;padding:13px 18px;font-size:13px;font-weight:700;line-height:18px;text-align:center">
    Open in Copilot&nbsp; →
  </a>`;

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
    "",
    "GrantPilot ranks evidence to support decisions. Verify eligibility and deadlines at the original source.",
  ].filter(Boolean).join("\n");
  const alertItems = alerts
    .map((label) => `<span style="display:inline-block;margin:0 6px 7px 0;padding:6px 9px;border:1px solid #30302e;border-radius:999px;background:#222220;color:#aaa9a3;font-size:11px">${escapeHtml(label)}</span>`)
    .join("");
  const content = `
    <p style="margin:0 0 18px;color:#f2f2ef;font-size:13px;line-height:1.6">GrantPilot will monitor the saved criteria and send focused updates when something changes.</p>
    <table role="presentation" width="100%">
      ${factRow("Watch", scope)}
      ${factRow("Match threshold", quality.label)}
      ${factRow("Delivery", frequency.label)}
      ${watch.notificationTypes.includes("opportunity-closing") ? factRow("Deadline reminder", `${watch.deadlineLeadDays} days before`) : ""}
    </table>
    <div style="margin-top:20px">
      <div style="margin-bottom:9px;color:#7b7a75;font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase">Notifications</div>
      ${alertItems}
    </div>
    <div style="margin-top:18px">${copilotButton(copilotUrl)}</div>`;
  const html = emailShell({
    preheader: `${frequency.label} GrantPilot alerts are now active.`,
    eyebrow: "Watch created",
    title: "Your grant watch is active",
    subtitle: `${frequency.label} updates for ${scope.toLowerCase()}.`,
    accent: "#62d6a5",
    content,
  });
  return { subject, plainText, html };
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
    `${sourceAction}: ${grant.opportunity.sourceUrl}`,
  ].join("\n");
  const content = `
    <p style="margin:0 0 18px;color:#aaa9a3;font-size:12px;line-height:1.55">${escapeHtml(presentation.intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td valign="top">
          <span style="display:inline-block;margin:0 5px 5px 0;padding:5px 8px;border-radius:999px;background:${historical ? "#2b241d" : "#2b2b28"};color:${historical ? "#d99145" : "#f2f2ef"};font-size:9px;font-weight:700;line-height:11px">${escapeHtml(sourceLabel)}</span>
          <span style="display:inline-block;margin:0 0 5px;padding:5px 8px;border:1px ${eligibilityPositive ? "solid #315f4c" : "dashed #6f4e2f"};border-radius:999px;background:${eligibilityPositive ? "#1b2923" : "#211d19"};color:${eligibilityPositive ? "#55b88a" : "#d99145"};font-size:9px;font-weight:700;line-height:11px">${escapeHtml(eligibilityText)}</span>
        </td>
        <td width="58" valign="top" align="right">
          <div style="color:#f2f2ef;font-size:19px;font-weight:750;line-height:20px">${overallScore}</div>
          <div style="margin-top:2px;color:#7b7a75;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">match</div>
        </td>
      </tr>
    </table>
    <h2 style="margin:8px 0 5px;color:#f2f2ef;font-size:20px;line-height:1.25;letter-spacing:-.02em">${escapeHtml(grant.opportunity.title)}</h2>
    <p style="margin:0;color:#aaa9a3;font-size:11px;line-height:1.4">${escapeHtml(grant.opportunity.funderName)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:19px;border:1px solid #30302e;border-radius:9px;background:#10100f">
      <tr>
        <td width="50%" valign="top" style="padding:12px 14px;border-right:1px solid #30302e;border-bottom:1px solid #30302e">
          <div style="color:#7b7a75;font-size:8px;line-height:11px">Award range</div>
          <div style="margin-top:4px;color:#f2f2ef;font-size:11px;font-weight:700;line-height:15px">${escapeHtml(awardRange(grant))}</div>
        </td>
        <td width="50%" valign="top" style="padding:12px 14px;border-bottom:1px solid #30302e">
          <div style="color:#7b7a75;font-size:8px;line-height:11px">${historical ? "Status" : "Deadline"}</div>
          <div style="margin-top:4px;color:#f2f2ef;font-size:11px;font-weight:700;line-height:15px">${escapeHtml(deadline)}</div>
        </td>
      </tr>
      <tr>
        <td width="50%" valign="top" style="padding:12px 14px;border-right:1px solid #30302e">
          <div style="color:#7b7a75;font-size:8px;line-height:11px">Watch threshold</div>
          <div style="margin-top:4px;color:#f2f2ef;font-size:11px;font-weight:700;line-height:15px">${escapeHtml(quality.label)}</div>
        </td>
        <td width="50%" valign="top" style="padding:12px 14px">
          <div style="color:#7b7a75;font-size:8px;line-height:11px">Pursuit effort</div>
          <div style="margin-top:4px;color:#f2f2ef;font-size:11px;font-weight:700;line-height:15px">${applicationEffort}/100</div>
        </td>
      </tr>
    </table>`;
  const evidence = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #30302e">
      <tr>
        <td class="button-cell" width="50%" valign="top" style="padding:16px 10px 0 0">
          <div style="color:#aaa9a3;font-size:9px;font-weight:700;letter-spacing:.055em;text-transform:uppercase">Description</div>
          <p style="margin:6px 0 0;color:#f2f2ef;font-size:11px;line-height:1.55">${escapeHtml(description)}</p>
        </td>
        <td class="button-cell" width="50%" valign="top" style="padding:16px 0 0 10px">
          <div style="color:#aaa9a3;font-size:9px;font-weight:700;letter-spacing:.055em;text-transform:uppercase">Why it matches</div>
          <p style="margin:6px 0 0;color:#f2f2ef;font-size:11px;line-height:1.55">${escapeHtml(missionReason)}</p>
        </td>
      </tr>
    </table>
    <div style="margin-top:18px;padding:11px 12px;border:1px solid #30302e;background:#222220;border-radius:10px">
      <div style="color:#aaa9a3;font-size:9px;font-weight:800;letter-spacing:.055em;text-transform:uppercase">ⓘ&nbsp; Info</div>
      <p style="margin:6px 0 0;color:#aaa9a3;font-size:10px;font-weight:600;line-height:1.45">${escapeHtml(evidenceNote)}</p>
    </div>
    <div style="height:1px;margin-top:18px;background:#30302e;font-size:0;line-height:0">&nbsp;</div>
    <div style="margin-top:16px">${copilotButton(copilotUrl)}</div>
    <div style="margin-top:8px">
      <a class="button" href="${escapeHtml(grant.opportunity.sourceUrl)}" style="display:block;border:1px solid #454540;background:#181817;color:#f2f2ef;border-radius:9px;padding:12px 18px;font-size:12px;font-weight:700;line-height:18px;text-align:center">${sourceAction}</a>
    </div>`;
  const html = emailShell({
    preheader: `${presentation.eyebrow}: ${grant.opportunity.title}`,
    eyebrow: presentation.eyebrow,
    title: presentation.headline,
    subtitle: grant.opportunity.funderName,
    accent: presentation.accent,
    content: `${content}${evidence}`,
  });
  return { subject: presentation.subject, plainText, html };
}
