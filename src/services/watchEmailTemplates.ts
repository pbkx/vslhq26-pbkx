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
    <td class="fact-label" style="padding:12px 0;border-top:1px solid #30302d;color:#a8a8a1;font-size:13px">${escapeHtml(label)}</td>
    <td class="fact-value" style="padding:12px 0;border-top:1px solid #30302d;color:#f5f5f1;font-size:13px;font-weight:700;text-align:right">${escapeHtml(value)}</td>
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
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0!important;background:#ecece7;color:#171715;font-family:Inter,Segoe UI,Arial,sans-serif}
    table{border-collapse:collapse}
    a{text-decoration:none}
    .email-wrap{width:100%;background:#ecece7}
    .email-card{width:100%;max-width:640px}
    .content-card{border-radius:18px}
    .button{display:inline-block;border-radius:10px;padding:13px 18px;font-size:14px;font-weight:700;line-height:18px}
    @media(max-width:600px){
      .outer-pad{padding:14px 10px!important}
      .hero-pad,.content-pad{padding:22px 18px!important}
      .button{display:block!important;margin:8px 0 0!important;text-align:center!important}
      .button-cell{display:block!important;width:100%!important}
      .fact-label,.fact-value{font-size:12px!important}
    }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <table role="presentation" class="email-wrap" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td class="outer-pad" align="center" style="padding:30px 16px">
        <table role="presentation" class="email-card" width="640" cellpadding="0" cellspacing="0">
          <tr>
            <td class="hero-pad" style="background:#0d0d0c;border-radius:18px 18px 0 0;padding:24px 28px;border-bottom:3px solid ${accent}">
              <table role="presentation" width="100%">
                <tr>
                  <td width="42" valign="middle">
                    <div style="width:36px;height:36px;border-radius:9px;background:#000;color:#fff;font-size:23px;line-height:36px;text-align:center">✦</div>
                  </td>
                  <td valign="middle" style="color:#f5f5f1;font-size:18px;font-weight:750">GrantPilot</td>
                </tr>
              </table>
              <div style="margin-top:24px;color:${accent};font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(eyebrow)}</div>
              <h1 style="margin:8px 0 7px;color:#f5f5f1;font-size:28px;line-height:1.18;letter-spacing:-.02em">${escapeHtml(title)}</h1>
              <p style="margin:0;color:#a8a8a1;font-size:15px;line-height:1.5">${escapeHtml(subtitle)}</p>
            </td>
          </tr>
          <tr>
            <td class="content-pad content-card" style="background:#171715;border:1px solid #30302d;border-top:0;border-radius:0 0 18px 18px;padding:26px 28px;color:#f5f5f1">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:15px 6px 0;color:#70706b;font-size:11px;line-height:1.5">
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
  <a class="button" href="${escapeHtml(url)}" style="display:inline-block;border:1px solid #f5f5f1;background:#f5f5f1;color:#11110f;border-radius:10px;padding:13px 18px;font-size:14px;font-weight:700;line-height:18px">
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
    .map((label) => `<span style="display:inline-block;margin:0 6px 7px 0;padding:6px 9px;border:1px solid #3b3b37;border-radius:999px;color:#d7d7d1;font-size:12px">${escapeHtml(label)}</span>`)
    .join("");
  const content = `
    <p style="margin:0 0 18px;color:#d7d7d1;font-size:14px;line-height:1.6">GrantPilot will monitor the saved criteria and send focused updates when something changes.</p>
    <table role="presentation" width="100%">
      ${factRow("Watch", scope)}
      ${factRow("Match threshold", quality.label)}
      ${factRow("Delivery", frequency.label)}
      ${watch.notificationTypes.includes("opportunity-closing") ? factRow("Deadline reminder", `${watch.deadlineLeadDays} days before`) : ""}
    </table>
    <div style="margin-top:20px">
      <div style="margin-bottom:9px;color:#8e8e88;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">Notifications</div>
      ${alertItems}
    </div>
    <div style="margin-top:21px">${copilotButton(copilotUrl)}</div>`;
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
    <p style="margin:0 0 18px;color:#d7d7d1;font-size:14px;line-height:1.6">${escapeHtml(presentation.intro)}</p>
    <div style="padding:16px;border:1px solid #30302d;border-radius:12px;background:#11110f">
      <div style="color:#8e8e88;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">Opportunity</div>
      <h2 style="margin:7px 0 5px;color:#f5f5f1;font-size:20px;line-height:1.28">${escapeHtml(grant.opportunity.title)}</h2>
      <p style="margin:0;color:#a8a8a1;font-size:13px">${escapeHtml(grant.opportunity.funderName)}</p>
    </div>
    <table role="presentation" width="100%" style="margin-top:12px">
      ${factRow("Match level", quality.label)}
      ${factRow("Source", sourceLabel)}
      ${factRow("Award", awardRange(grant))}
      ${factRow("Deadline", deadline)}
    </table>
    <div style="margin-top:20px;padding:15px 16px;border-left:3px solid ${presentation.accent};background:#20201d;border-radius:4px 10px 10px 4px">
      <div style="color:#8e8e88;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">Why it surfaced</div>
      <p style="margin:7px 0 0;color:#e5e5df;font-size:13px;line-height:1.55">${escapeHtml(missionReason)}</p>
    </div>
    <table role="presentation" width="100%" style="margin-top:22px">
      <tr>
        <td class="button-cell" style="padding-right:7px">${copilotButton(copilotUrl)}</td>
        <td class="button-cell" style="padding-left:7px">
          <a class="button" href="${escapeHtml(grant.opportunity.sourceUrl)}" style="display:inline-block;border:1px solid #4a4a45;background:transparent;color:#f5f5f1;border-radius:10px;padding:13px 18px;font-size:14px;font-weight:700;line-height:18px">${sourceAction}</a>
        </td>
      </tr>
    </table>`;
  const html = emailShell({
    preheader: `${presentation.eyebrow}: ${grant.opportunity.title}`,
    eyebrow: presentation.eyebrow,
    title: presentation.headline,
    subtitle: grant.opportunity.funderName,
    accent: presentation.accent,
    content,
  });
  return { subject: presentation.subject, plainText, html };
}
