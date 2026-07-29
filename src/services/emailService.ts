import {
  EmailClient,
  KnownEmailSendStatus,
} from "@azure/communication-email";

export type EmailMessage = {
  to: string;
  subject: string;
  plainText: string;
  html: string;
};

export type EmailDelivery = {
  provider: "azure-communication-services";
  status: "sent" | "preview-only" | "failed";
  messageId?: string;
  error?: string;
};

export interface EmailService {
  send(message: EmailMessage): Promise<EmailDelivery>;
}

export class AzureCommunicationEmailService implements EmailService {
  async send(message: EmailMessage): Promise<EmailDelivery> {
    const connection =
      process.env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING;
    const sender = process.env.EMAIL_SENDER_ADDRESS;
    if (!connection || !sender) {
      return {
        provider: "azure-communication-services",
        status: "preview-only",
      };
    }

    const client = new EmailClient(connection);
    const poller = await client.beginSend({
      senderAddress: sender,
      content: {
        subject: message.subject,
        plainText: message.plainText,
        html: message.html,
      },
      recipients: {
        to: [{ address: message.to }],
      },
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
