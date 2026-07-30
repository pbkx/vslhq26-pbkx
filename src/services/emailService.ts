import {
  EmailClient,
  KnownEmailSendStatus,
} from "@azure/communication-email";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type EmailMessage = {
  to: string;
  subject: string;
  plainText: string;
  html: string;
  unsubscribeUrl?: string;
};

export type EmailDelivery = {
  provider: "azure-communication-services";
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
};

export interface EmailService {
  send(message: EmailMessage): Promise<EmailDelivery>;
}

export class AzureCommunicationEmailService implements EmailService {
  async send(message: EmailMessage): Promise<EmailDelivery> {
    const connection =
      process.env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING?.trim();
    const sender = process.env.EMAIL_SENDER_ADDRESS?.trim();
    if (!connection || !sender) {
      return {
        provider: "azure-communication-services",
        status: "failed",
        error: "Azure Communication Services email delivery is not configured.",
      };
    }

    const client = new EmailClient(connection);
    const logo = await readFile(
      process.env.EMAIL_LOGO_PATH
        ?? resolve("appPackage/grantpilot-color-v2.png"),
    );
    const poller = await client.beginSend({
      senderAddress: sender,
      headers: message.unsubscribeUrl ? {
        "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      } : undefined,
      content: {
        subject: message.subject,
        plainText: message.plainText,
        html: message.html,
      },
      recipients: {
        to: [{ address: message.to }],
      },
      attachments: [{
        name: "grantpilot-logo.png",
        contentType: "image/png",
        contentInBase64: logo.toString("base64"),
        contentId: "grantpilot-logo",
      }],
    });
    const result = await poller.pollUntilDone();
    if (result.status !== KnownEmailSendStatus.Succeeded) {
      return {
        provider: "azure-communication-services",
        status: "failed",
        messageId: result.id,
        error: result.error?.message
          ?? `Azure Communication Services returned ${result.status}.`,
      };
    }
    return {
      provider: "azure-communication-services",
      status: "sent",
      messageId: result.id,
    };
  }
}

export const emailService: EmailService =
  new AzureCommunicationEmailService();
